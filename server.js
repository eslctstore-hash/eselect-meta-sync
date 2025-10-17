import express from "express";
import axios from "axios";
import crypto from "crypto";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json({ limit: "10mb" }));

// ==================== إعداد المتغيرات ====================
const PORT = process.env.PORT || 3000;
const SHOP_URL = process.env.SHOP_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

const META_GRAPH_URL = process.env.META_GRAPH_URL || "https://graph.facebook.com/v20.0";
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// ==================== بيانات المزامنة ====================
const SYNC_FILE = "./sync.json";
let syncData = {};
if (fs.existsSync(SYNC_FILE)) syncData = fs.readJSONSync(SYNC_FILE);

// ==================== أدوات مساعدة ====================
function log(prefix, message, color = "\x1b[36m") {
  const reset = "\x1b[0m";
  console.log(`${color}${prefix}${reset} ${message}`);
}

function verifyShopifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!hmac) return false;
  const body = JSON.stringify(req.body);
  const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// ==================== نشر إلى Instagram ====================
async function publishToInstagram(product) {
  try {
    const caption = `${product.title}\n\n${product.body_html
      ?.replace(/<[^>]*>/g, "")
      .replace(/\*/g, "")}\n\n🔗 ${product.online_store_url}`;

    if (!product.images?.length) {
      log("[⚠️]", `🚫 لا توجد صور للمنتج ${product.title}`, "\x1b[33m");
      return;
    }

    // تحميل جميع الصور
    const mediaIds = [];
    for (const img of product.images) {
      const createMedia = await axios.post(
        `${META_GRAPH_URL}/${META_IG_ID}/media`,
        {
          image_url: img.src,
          caption,
          access_token: META_ACCESS_TOKEN,
        }
      );
      mediaIds.push(createMedia.data.id);
      log("[📸]", `تم تجهيز الصورة: ${img.src}`, "\x1b[34m");
    }

    // إنشاء ألبوم إذا أكثر من صورة
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

    // الانتظار قبل النشر
    await new Promise((r) => setTimeout(r, 3000));

    // نشر الوسائط
    const publish = await axios.post(
      `${META_GRAPH_URL}/${META_IG_ID}/media_publish`,
      {
        creation_id: containerId,
        access_token: META_ACCESS_TOKEN,
      }
    );

    log("[✅]", `📸 تم نشر المنتج على إنستجرام: ${product.title}`, "\x1b[32m");
    syncData[product.id] = { ig_post_id: publish.data.id, updated_at: new Date().toISOString() };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.error || err.message;
    log("[❌]", `❌ فشل نشر المنتج ${product.title}: (HTTP ${status || "?"})`, "\x1b[31m");
    console.error(detail);
  }
}

// ==================== Webhook من Shopify ====================
app.post("/webhook", async (req, res) => {
  const verified = verifyShopifyHmac(req);
  if (!verified) return res.status(401).send("Invalid HMAC");
  const topic = req.headers["x-shopify-topic"];
  const product = req.body;

  log("[ℹ️]", `📦 Received webhook: ${topic}`, "\x1b[36m");

  if (topic === "products/create") {
    log("[🆕]", `إضافة منتج جديد: ${product.title}`, "\x1b[32m");
    await publishToInstagram(product);
  } else if (topic === "products/update") {
    log("[♻️]", `تم تحديث المنتج: ${product.title}`, "\x1b[33m");
    await publishToInstagram(product);
  } else if (topic === "products/delete") {
    log("[🗑️]", `تم حذف المنتج: ${product.title}`, "\x1b[31m");
    if (syncData[product.id]) {
      delete syncData[product.id];
      await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
    }
  }

  res.sendStatus(200);
});

// ==================== مزامنة يدوية ====================
app.get("/sync-now", async (req, res) => {
  log("[ℹ️]", "🔁 بدء المزامنة اليدوية...", "\x1b[36m");
  let successCount = 0;

  try {
    const shopifyRes = await axios.get(
      `${SHOP_URL}/admin/api/2025-10/products.json?limit=50`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const products = shopifyRes.data.products || [];
    if (products.length === 0) {
      log("[⚠️]", "⚠️ لم يتم العثور على منتجات.", "\x1b[33m");
      res.send("⚠️ لم يتم العثور على منتجات.");
      return;
    }

    for (const product of products) {
      await publishToInstagram(product);
      successCount++;
    }

    log("[✅]", `✅ تمت المزامنة اليدوية بنجاح (${successCount} منتجات).`, "\x1b[32m");
    res.send(`✅ تمت المزامنة اليدوية بنجاح (${successCount} منتجات).`);
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.errors || err.response?.data || err.message;
    log("[❌]", `فشل الوصول إلى Shopify (HTTP ${status || "?"}):`, "\x1b[31m");
    console.error(detail);
    res.status(500).send(`❌ خطأ: ${JSON.stringify(detail, null, 2)}`);
  }
});

// ==================== تشغيل السيرفر ====================
app.get("/", (_, res) => res.send("🚀 eSelect Meta Sync v4.4 running"));
app.listen(PORT, () => {
  log("[✅]", `✅ Server running on port ${PORT}`, "\x1b[32m");
  log("[ℹ️]", `🌐 Primary URL: https://eselect-meta-sync.onrender.com`, "\x1b[36m");
});
