/**
 * eSelect Meta Sync v5.3.0
 * Smart AutoSpeed + Smart Diff Detection
 * Optimized for large product volumes (1000+)
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
const SYNC_TO_FACEBOOK = process.env.SYNC_TO_FACEBOOK === "true";

const SYNC_FILE = "./sync.json";
if (!fs.existsSync(SYNC_FILE)) fs.writeJSONSync(SYNC_FILE, {});
let syncData = fs.readJSONSync(SYNC_FILE);

// ==================== HELPERS ====================
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
let publishInterval = 90000; // start at 90 sec
const RETRY_BACKOFF = 5 * 60 * 1000; // 5 min

function log(prefix, message, color = "\x1b[36m") {
  const reset = "\x1b[0m";
  console.log(`${color}${prefix}${reset} ${message}`);
}

function verifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!hmac) return false;
  const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch {
    return false;
  }
}

function cleanText(html) {
  return html?.replace(/<[^>]*>/g, "").replace(/\*/g, "").substring(0, 1900);
}

async function waitForImages(product) {
  if (!product.images?.length) return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = product.images[0].src;
      await axios.head(url);
      log("[🖼️]", `الصور جاهزة (${product.title})`);
      return true;
    } catch {
      const delay = attempt * 30000;
      log("[⏳]", `محاولة (${attempt}) - الصور غير جاهزة (${product.title})، الانتظار ${delay / 1000} ثانية`, "\x1b[33m");
      await wait(delay);
    }
  }
  log("[⚠️]", `فشل فحص الصور (${product.title}) — تأجيل النشر.`, "\x1b[33m");
  return false;
}

// ==================== QUEUE SYSTEM ====================
const publishQueue = [];
let isPublishing = false;
let successCount = 0;
let failCount = 0;

async function queueProcessor() {
  if (isPublishing || publishQueue.length === 0) return;
  isPublishing = true;

  const { product, source } = publishQueue.shift();
  log("[🚀]", `بدء معالجة المنتج من ${source}: ${product.title}`, "\x1b[36m");

  await publishOrUpdate(product);

  isPublishing = false;
  setTimeout(queueProcessor, publishInterval);
}

// ==================== META PUBLISH ====================
async function publishOrUpdate(product) {
  const caption = `${product.title}\n\n${cleanText(product.body_html)}\n\n🔗 احصل عليه الآن من متجر eSelect:\n${product.online_store_url}\n\n#eSelect #عمان #الكترونيات #تسوق_الكتروني`;
  const existing = syncData[product.id];

  try {
    // skip if published and unchanged
    if (existing?.ig_post_id && existing?.hash === hashProduct(product)) {
      log("[⏩]", `المنتج لم يتغير (${product.title}) — تجاهل التحديث.`, "\x1b[33m");
      return;
    }

    // update if changed
    if (existing?.ig_post_id && existing?.hash !== hashProduct(product)) {
      log("[♻️]", `تم رصد تغييرات (${product.title}) — تحديث المنشور الحالي.`, "\x1b[33m");
      await updateMetaPost(existing.ig_post_id, caption);
      syncData[product.id] = { ...existing, hash: hashProduct(product), updated_at: now() };
      await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
      return;
    }

    // new publish
    const ready = await waitForImages(product);
    if (!ready) {
      syncData[product.id] = { status: "pending", title: product.title, updated_at: now() };
      await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
      return;
    }

    const images = [...new Set(product.images.map((i) => i.src))].slice(0, 10);
    const mediaIds = [];

    for (const img of images) {
      const media = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
        image_url: img,
        caption,
        access_token: META_ACCESS_TOKEN,
      });
      mediaIds.push(media.data.id);
      await wait(1000);
    }

    const containerId =
      mediaIds.length === 1
        ? mediaIds[0]
        : (
            await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
              media_type: "CAROUSEL",
              children: mediaIds,
              caption,
              access_token: META_ACCESS_TOKEN,
            })
          ).data.id;

    await wait(3000);
    const igPublish = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, {
      creation_id: containerId,
      access_token: META_ACCESS_TOKEN,
    });

    let fbPublish = null;
    if (SYNC_TO_FACEBOOK) {
      fbPublish = await axios.post(`${META_GRAPH_URL}/${META_PAGE_ID}/feed`, {
        message: caption,
        attached_media: mediaIds.map((id) => ({ media_fbid: id })),
        access_token: META_ACCESS_TOKEN,
      });
    }

    syncData[product.id] = {
      ig_post_id: igPublish.data.id,
      fb_post_id: fbPublish?.data?.id || null,
      hash: hashProduct(product),
      updated_at: now(),
      status: "success",
    };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
    successCount++;
    adjustSpeed(true);
    log("[✅]", `تم النشر (${product.title}) | سرعة حالية: ${(publishInterval / 1000).toFixed(0)} ثانية`, "\x1b[32m");
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    log("[❌]", `فشل النشر (${product.title}): ${msg}`, "\x1b[31m");
    failCount++;
    adjustSpeed(false);

    if (msg.includes("User is performing too many actions")) {
      log("[⚠️]", `Meta رفض النشر (${product.title}) — إعادة المحاولة بعد 5 دقائق.`, "\x1b[33m");
      setTimeout(() => publishQueue.push({ product, source: "RetryBackoff" }), RETRY_BACKOFF);
    }

    syncData[product.id] = { status: "failed", title: product.title, error: msg, updated_at: now() };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
  }
}

// ==================== SMART SPEED CONTROL ====================
function adjustSpeed(success) {
  if (successCount % 20 === 0 && success) {
    publishInterval = Math.max(60000, publishInterval - 15000); // faster
    log("[⚡]", `تسريع النشر تدريجيًا إلى ${(publishInterval / 1000).toFixed(0)} ثانية.`, "\x1b[36m");
  }
  if (!success && failCount > 3) {
    publishInterval = Math.min(180000, publishInterval + 30000); // slow down
    failCount = 0;
    log("[🐢]", `إبطاء النشر مؤقتًا إلى ${(publishInterval / 1000).toFixed(0)} ثانية.`, "\x1b[33m");
  }
}

// ==================== HASH ====================
function hashProduct(p) {
  const data = `${p.title}-${cleanText(p.body_html)}-${p.images?.map((i) => i.src).join(",")}`;
  return crypto.createHash("md5").update(data).digest("hex");
}

async function updateMetaPost(postId, caption) {
  try {
    await axios.post(`${META_GRAPH_URL}/${postId}`, {
      caption,
      access_token: META_ACCESS_TOKEN,
    });
    log("[🔁]", `تم تحديث المنشور (${postId})`, "\x1b[32m");
  } catch (err) {
    log("[⚠️]", `فشل تحديث المنشور (${postId}): ${err.message}`, "\x1b[33m");
  }
}

// ==================== DAILY SYNC ====================
async function dailyResync() {
  const pending = Object.entries(syncData).filter(
    ([, v]) => v.status === "failed" || v.status === "pending"
  );
  if (!pending.length) return;

  log("[🔁]", `بدء المزامنة اليومية (${pending.length} منتج)...`, "\x1b[36m");

  for (const [id, data] of pending) {
    try {
      const res = await axios.get(
        `https://${SHOP_URL}/admin/api/2024-10/products/${id}.json`,
        { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
      );
      const product = res.data.product;
      if (product.status === "active") {
        publishQueue.push({ product, source: "DailyResync" });
      }
    } catch (err) {
      log("[⚠️]", `فشل استرجاع المنتج ${id}: ${err.message}`, "\x1b[33m");
    }
  }
  queueProcessor();
}
setInterval(dailyResync, 24 * 60 * 60 * 1000);

// ==================== WEBHOOKS ====================
app.post("/webhook/products/create", async (req, res) => {
  if (!verifyHmac(req)) return res.status(401).send("Invalid HMAC");
  const product = req.body;
  if (product.status !== "active") return res.sendStatus(200);
  log("[🆕]", `استلام منتج جديد: ${product.title}`, "\x1b[32m");

  publishQueue.push({ product, source: "WebhookCreate" });
  queueProcessor();

  res.sendStatus(200);
});

app.post("/webhook/products/update", (req, res) => {
  log("[⚙️]", `تم تجاهل تحديث المنتج: ${req.body.title} (handled by translation server)`, "\x1b[33m");
  res.sendStatus(200);
});

// ==================== SERVER ====================
app.get("/", (_, res) => {
  res.send("🚀 eSelect Meta Sync v5.3.0 Smart AutoSpeed + Smart Diff Detection running...");
});

app.listen(PORT, () => {
  log("[✅]", `Server running on port ${PORT}`, "\x1b[32m");
  log("[⚙️]", "AutoSpeed range: 60–180s | Daily Sync active | Diff detection enabled", "\x1b[36m");
});
