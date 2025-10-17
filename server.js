/**
 * eSelect Meta Sync v6.0.0
 * Corrected by Gemini with Full Queue System, AI Captions, and Robust Publishing Logic
 */

import express from "express";
import axios from "axios";
import crypto from "crypto";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();
const app = express();

app.use(
  express.json({
    limit: "20mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const META_GRAPH_URL = process.env.META_GRAPH_URL || "https://graph.facebook.com/v20.0";
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const SHOP_URL = process.env.SHOP_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SYNC_TO_FACEBOOK = process.env.SYNC_TO_FACEBOOK === "true";

const SYNC_FILE = "./sync.json";
if (!fs.existsSync(SYNC_FILE)) fs.writeJSONSync(SYNC_FILE, {});
let syncData = fs.readJSONSync(SYNC_FILE);

// ==================== QUEUE & SPEED CONTROL ====================
let publishQueue = [];
let isProcessingQueue = false;
let publishInterval = 90000; // يبدأ بـ 90 ثانية
let successCount = 0;
let failCount = 0;
const RETRY_BACKOFF = 5 * 60 * 1000; // 5 دقائق

// ==================== HELPERS ====================
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

function log(prefix, message, color = "\x1b[36m") {
  const reset = "\x1b[0m";
  console.log(`${color}${prefix}${reset} ${message}`);
}

function verifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!hmac) {
    log("[⚠️]", "Webhook received without HMAC header.", "\x1b[33m");
    return false;
  }
  const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch (e) {
    log("[❌]", `Error during HMAC verification: ${e.message}`, "\x1b[31m");
    return false;
  }
}

function cleanText(html) {
  return html?.replace(/<[^>]*>/g, " ").replace(/\s+/g, ' ').trim() || "";
}

function hashProduct(p) {
  const data = `${p.title}-${cleanText(p.body_html)}-${p.images?.map((i) => i.src).join(",")}`;
  return crypto.createHash("md5").update(data).digest("hex");
}

function adjustSpeed(success) {
    if (success) {
        successCount++;
        // Speed up every 10 successes
        if (successCount % 10 === 0) {
            publishInterval = Math.max(60000, publishInterval - 10000); // Min 60s
            log("[⚡]", `تم تسريع النشر إلى فاصل ${(publishInterval / 1000).toFixed(0)} ثانية.`, "\x1b[36m");
        }
    } else {
        failCount++;
        // Slow down after 2 consecutive failures
        if (failCount > 2) {
            publishInterval = Math.min(180000, publishInterval + 30000); // Max 180s
            failCount = 0; // Reset counter after slowing down
            log("[🐢]", `تم إبطاء النشر مؤقتًا إلى ${(publishInterval / 1000).toFixed(0)} ثانية.`, "\x1b[33m");
        }
    }
}

// ==================== AI CAPTION GENERATION ====================
async function generateCaption(product) {
  if (!OPENAI_API_KEY) {
    log("[⚠️]", "OpenAI API key not found. Using default caption.", "\x1b[33m");
    const hashtags = `#eselect #اي_سيلكت #${product.vendor?.replace(/\s/g, "") || ''} #${product.product_type?.replace(/\s/g, "") || ''}`;
    return `${product.title}\n\n${cleanText(product.body_html)}\n\n${hashtags}`;
  }

  log("[🤖]", `توليد وصف للمنتج: ${product.title}...`);
  const prompt = `
    Create an engaging social media post in Arabic for a new product for an e-commerce store called "eselect".
    - Start with a catchy hook.
    - Briefly describe the product based on the title and description.
    - End with a call to action to visit the store.
    - Generate relevant hashtags including #eselect, #اي_سيلكت, the product type, brand, and other creative tags.
    - The entire response should be only the post text, ready to be published.

    Product Title: "${product.title}"
    Product Description: "${cleanText(product.body_html)}"
    `;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 400,
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      }
    );
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    log("[❌]", `فشل في توليد الوصف: ${errorMsg}`, "\x1b[31m");
    return `${product.title}\n\n${cleanText(product.body_html)}`; // Fallback to basic text
  }
}

// ==================== CORE PUBLISHING LOGIC ====================
async function publishProductToMeta(product) {
  const currentHash = hashProduct(product);
  if (syncData[product.id]?.hash === currentHash) {
    log("[🤷]", `المنتج ${product.title} لم يتغير. تم التخطي.`, "\x1b[33m");
    return;
  }
  
  if (!product.images || product.images.length === 0) {
    log("[⚠️]", `المنتج "${product.title}" لا يحتوي على صور. تم التخطي.`, "\x1b[33m");
    return;
  }

  try {
    log("[🔄]", `بدء معالجة النشر للمنتج: ${product.title}`);

    // 1. توليد الوصف
    const caption = await generateCaption(product);

    // 2. رفع الصور إلى Meta (كـ items)
    const mediaIds = [];
    const facebookMediaIds = []; // For Facebook publishing
    log("[📤]", `يتم رفع ${product.images.length} صورة...`);
    for (const image of product.images.slice(0, 10)) { // Instagram allows max 10 images
      const igUploadRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
        image_url: image.src,
        is_carousel_item: product.images.length > 1,
        access_token: META_ACCESS_TOKEN,
      });
      mediaIds.push(igUploadRes.data.id);
      
      if(SYNC_TO_FACEBOOK) {
          const fbUploadRes = await axios.post(`${META_GRAPH_URL}/${META_PAGE_ID}/photos`, {
              url: image.src,
              published: false, // Upload without publishing to use in a multi-photo post
              access_token: META_ACCESS_TOKEN
          });
          facebookMediaIds.push({ media_fbid: fbUploadRes.data.id });
      }

      await wait(3000); // ننتظر قليلاً بين كل صورة
    }

    // 3. إنشاء الحاوية (Container) للنشر على انستجرام
    let igContainerId;
    if (mediaIds.length === 1) {
        // For a single image, we re-upload with the caption directly to create the container
        const singleMediaRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
            image_url: product.images[0].src,
            caption: caption,
            access_token: META_ACCESS_TOKEN,
        });
        igContainerId = singleMediaRes.data.id;
    } else {
        const carouselRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
            media_type: "CAROUSEL",
            children: mediaIds,
            caption: caption,
            access_token: META_ACCESS_TOKEN,
        });
        igContainerId = carouselRes.data.id;
    }
    
    // 4. انتظار جهوزية الحاوية ثم النشر على انستجرام
    log("[⏳]", "انتظار معالجة الحاوية من Meta...");
    let igPublishRes = null;
    for (let i = 0; i < 15; i++) { // ننتظر حتى 75 ثانية
      const statusCheck = await axios.get(`${META_GRAPH_URL}/${igContainerId}?fields=status_code&access_token=${META_ACCESS_TOKEN}`);
      if (statusCheck.data.status_code === 'FINISHED') {
        igPublishRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, {
            creation_id: igContainerId,
            access_token: META_ACCESS_TOKEN,
        });
        break;
      }
      await wait(5000);
    }
    if (!igPublishRes) throw new Error("فشلت معالجة حاوية انستجرام في الوقت المحدد.");
    
    // 5. النشر على فيسبوك (إذا تم تفعيله)
    let fbPublishRes = null;
    if (SYNC_TO_FACEBOOK) {
      log("[🌐]", "يتم النشر على فيسبوك...");
      fbPublishRes = await axios.post(`${META_GRAPH_URL}/${META_PAGE_ID}/feed`, {
          message: caption,
          attached_media: facebookMediaIds,
          access_token: META_ACCESS_TOKEN,
      });
    }

    // 6. تحديث ملف المزامنة وتعديل السرعة
    syncData[product.id] = {
      ig_post_id: igPublishRes.data.id,
      fb_post_id: fbPublishRes?.data?.id || null,
      hash: currentHash,
      updated_at: now(),
      status: "success",
    };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
    adjustSpeed(true);
    log("[✅]", `تم نشر المنتج (${product.title}) بنجاح! | الفاصل الزمني الحالي ${(publishInterval / 1000).toFixed(0)} ثانية`, "\x1b[32m");

  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    log("[❌]", `فشل نشر المنتج (${product.title}): ${msg}`, "\x1b[31m");
    adjustSpeed(false);

    if (msg.includes("many actions") || msg.includes("rate limit")) {
      log("[⚠️]", `وصلنا للحد الأقصى للنشر من Meta. إعادة المحاولة بعد 5 دقائق.`, "\x1b[33m");
      setTimeout(() => publishQueue.unshift({ product }), RETRY_BACKOFF); // Add back to front of queue
    }

    syncData[product.id] = { status: "failed", title: product.title, error: msg, updated_at: now() };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
  }
}

// ==================== QUEUE PROCESSOR ====================
async function queueProcessor() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  log("[⚙️]", `بدء معالجة الطابور... عدد المنتجات: ${publishQueue.length}`);

  while (publishQueue.length > 0) {
    const { product } = publishQueue.shift();
    await publishProductToMeta(product);
    if(publishQueue.length > 0) {
      log("[⏳]", `انتظار لمدة ${(publishInterval / 1000).toFixed(0)} ثانية قبل المنتج التالي...`);
      await wait(publishInterval);
    }
  }

  isProcessingQueue = false;
  log("[✅]", "تم الانتهاء من معالجة الطابور.");
}

// ==================== WEBHOOKS ====================
app.post("/webhook/product-create", async (req, res) => {
  if (!verifyHmac(req)) return res.status(401).send("Invalid HMAC");
  res.sendStatus(200); // Respond immediately to Shopify

  const product = req.body;
  if (product.status !== "active") return;
  
  log("[🆕]", `استلام منتج جديد: ${product.title}`, "\x1b[32m");
  publishQueue.push({ product });
  queueProcessor();
});

app.post("/webhook/product-update", async (req, res) => {
    if (!verifyHmac(req)) return res.status(401).send("Invalid HMAC");
    res.sendStatus(200);
    
    const product = req.body;
    if (product.status !== "active") return;

    log("[🔄]", `استلام تحديث للمنتج: ${product.title}`);
    publishQueue.push({ product });
    queueProcessor();
});

app.post("/webhook/product-delete", (req, res) => {
    //  (اختياري) يمكنك إضافة منطق لحذف المنشورات هنا لاحقاً
    log("[🗑️]", `تم استلام طلب حذف للمنتج: ${req.body.title}. لم يتم اتخاذ إجراء.`);
    res.sendStatus(200);
});

// ==================== SERVER & RECOVERY ====================
app.get("/", (_, res) => {
  res.send(`🚀 eSelect Meta Sync v6.0.0 — Queue: ${publishQueue.length} | Status: ${isProcessingQueue ? 'Running' : 'Idle'}`);
});

async function startupRecovery() {
  const pending = Object.entries(syncData).filter(([, v]) => v.status === "failed");
  if (!pending.length) return;

  log("[🔁]", `تم العثور على ${pending.length} منتج فشل نشره سابقاً. تتم إضافتهم للطابور...`, "\x1b[36m");
  for (const [id] of pending) {
    try {
      const res = await axios.get(
        `https://${SHOP_URL}/admin/api/2024-10/products/${id}.json`,
        { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
      );
      if (res.data.product.status === "active") {
        publishQueue.push({ product: res.data.product });
      }
    } catch (err) {
      log("[⚠️]", `فشل استرجاع المنتج ${id} أثناء الاسترداد: ${err.message}`, "\x1b[33m");
    }
  }
  queueProcessor();
}

app.listen(PORT, () => {
  log("[✅]", `Server running on port ${PORT}`, "\x1b[32m");
  startupRecovery(); // Check for failed jobs on startup
});
