import express from "express";
import axios from "axios";
import crypto from "crypto";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// ⚙️ نستخدم raw body بدلاً من JSON فقط
app.use(
  express.json({
    limit: "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf; // حفظ النسخة الخام للتحقق من HMAC
    },
  })
);

// ==================== إعداد المتغيرات ====================
const PORT = process.env.PORT || 3000;
const SHOP_URL = process.env.SHOP_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

const META_GRAPH_URL = process.env.META_GRAPH_URL || "https://graph.facebook.com/v20.0";
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const SYNC_TO_FACEBOOK = process.env.SYNC_TO_FACEBOOK === "true";

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
  const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch {
    return false;
  }
}

// ==================== النشر على Meta ====================
async function publishToMeta(product) {
  try {
    const caption = `${product.title}\n\n${product.body_html
      ?.replace(/<[^>]*>/g, "")
      .replace(/\*/g, "")}\n\n🔗 احصل عليه الآن من متجر eSelect:\n${product.online_store_url}\n\n#eSelect #عمان #الكترونيات #تسوق_الكتروني #منتجات_مميزة #عروض`;

    if (!product.images?.length) {
      log("[⚠️]", `🚫 لا توجد صور للمنتج ${product.title}`, "\x1b[33m");
      return;
    }

    const uniqueImages = [...new Set(product.images.map(i => i.src))].slice(0, 10);

    log("[⌛]", "⏳ انتظار 10 ثوانٍ قبل النشر...");
    await new Promise(r => setTimeout(r, 10000));

    const mediaIds = [];
    for (const img of uniqueImages) {
      const createMedia = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
        image_url: img,
        caption,
        access_token: META_ACCESS_TOKEN
      });
      mediaIds.push(createMedia.data.id);
      log("[📸]", `تم تجهيز الصورة: ${img}`, "\x1b[34m");
    }

    const containerId =
      mediaIds.length === 1
        ? mediaIds[0]
        : (
            await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
              media_type: "CAROUSEL",
              children: mediaIds,
              caption,
              access_token: META_ACCESS_TOKEN
            })
          ).data.id;

    await new Promise(r => setTimeout(r, 5000));

    const publish = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, {
      creation_id: containerId,
      access_token: META_ACCESS_TOKEN
    });

    let fbPublish = null;
    if (SYNC_TO_FACEBOOK) {
      fbPublish = await axios.post(`${META_GRAPH_URL}/${META_PAGE_ID}/feed`, {
        message: caption,
        attached_media: mediaIds.map(id => ({ media_fbid: id })),
        access_token: META_ACCESS_TOKEN
      });
      log("[🌍]", `✅ تم النشر أيضًا على فيسبوك (${product.title})`, "\x1b[32m");
    }

    syncData[product.id] = {
      ig_post_id: publish.data.id,
      fb_post_id: fbPublish?.data?.id || null,
      updated_at: new Date().toISOString()
    };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });

    log("[✅]", `تم النشر بنجاح على إنستجرام: ${product.title}`, "\x1b[32m");
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.error || err.message;
    log("[❌]", `❌ فشل نشر المنتج ${product.title}: (HTTP ${status || "?"})`, "\x1b[31m");
    console.error(detail);
  }
}

async function deleteFromMeta(productId) {
  const data = syncData[productId];
  if (!data) return;

  for (const key of ["ig_post_id", "fb_post_id"]) {
    if (data[key]) {
      try {
        await axios.delete(`${META_GRAPH_URL}/${data[key]}?access_token=${META_ACCESS_TOKEN}`);
        log("[🗑️]", `تم حذف المنشور من ${key.includes("ig") ? "إنستجرام" : "فيسبوك"} (${productId})`, "\x1b[31m");
      } catch {
        log("[⚠️]", `فشل حذف ${key} (${productId})`, "\x1b[33m");
      }
    }
  }

  delete syncData[productId];
  await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
}

// ==================== Webhooks من Shopify ====================
app.post("/webhook/products/create", async (req, res) => {
  const valid = verifyShopifyHmac(req);
  if (!valid) {
    log("[⛔]", "HMAC غير صالح (create)", "\x1b[31m");
    return res.status(401).send("Invalid HMAC");
  }
  const product = req.body;
  log("[🆕]", `تم إنشاء المنتج: ${product.title}`, "\x1b[32m");
  if (product.status === "active") await publishToMeta(product);
  res.sendStatus(200);
});

app.post("/webhook/products/update", async (req, res) => {
  const valid = verifyShopifyHmac(req);
  if (!valid) {
    log("[⛔]", "HMAC غير صالح (update)", "\x1b[31m");
    return res.status(401).send("Invalid HMAC");
  }
  const product = req.body;
  log("[♻️]", `تم تحديث المنتج: ${product.title}`, "\x1b[33m");
  if (product.status === "active") await publishToMeta(product);
  else if (["draft", "archived"].includes(product.status)) await deleteFromMeta(product.id);
  res.sendStatus(200);
});

app.post("/webhook/products/delete", async (req, res) => {
  const valid = verifyShopifyHmac(req);
  if (!valid) {
    log("[⛔]", "HMAC غير صالح (delete)", "\x1b[31m");
    return res.status(401).send("Invalid HMAC");
  }
  const product = req.body;
  log("[🗑️]", `تم حذف المنتج: ${product.title}`, "\x1b[31m");
  await deleteFromMeta(product.id);
  res.sendStatus(200);
});

// ==================== تشغيل السيرفر ====================
app.get("/", (_, res) => res.send("🚀 eSelect Meta Sync v4.8.2 Stable (Raw Body Fix) Running..."));
app.listen(PORT, () => {
  log("[✅]", `Server running on port ${PORT}`, "\x1b[32m");
  log("[🌐]", `Primary URL: https://eselect-meta-sync.onrender.com`, "\x1b[36m");
});
