/**
 * eSelect Meta Sync v5.2.0
 * - Smart Draft Handling
 * - Smart Post Update
 * - Smart Delay Control
 * - Sync Persistence (sync.json)
 */

import express from "express";
import axios from "axios";
import crypto from "crypto";
import fs from "fs-extra";
import dotenv from "dotenv";

dotenv.config();
const app = express();

// ⚙️ إعداد body الخام للتحقق من HMAC
app.use(
  express.json({
    limit: "15mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ==================== المتغيرات ====================
const PORT = process.env.PORT || 3000;
const SHOP_URL = process.env.SHOP_URL;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

const META_GRAPH_URL = process.env.META_GRAPH_URL || "https://graph.facebook.com/v20.0";
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const SYNC_TO_FACEBOOK = process.env.SYNC_TO_FACEBOOK === "true";

const SYNC_FILE = "./sync.json";
if (!fs.existsSync(SYNC_FILE)) fs.writeJSONSync(SYNC_FILE, {});
let syncData = fs.readJSONSync(SYNC_FILE);

// ==================== أدوات مساعدة ====================
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// تنظيف الوصف لتجنب تجاوز الحد
function cleanText(html) {
  return html?.replace(/<[^>]*>/g, "").replace(/\*/g, "").substring(0, 1900);
}

// ==================== Meta Operations ====================

// 🔁 Smart Update أو Create
async function smartPublish(product) {
  const caption = `${product.title}\n\n${cleanText(product.body_html)}\n\n🔗 احصل عليه الآن من متجر eSelect:\n${product.online_store_url}\n\n#eSelect #عمان #الكترونيات #تسوق_الكتروني`;

  if (!product.images?.length) {
    log("[⚠️]", `🚫 لا توجد صور للمنتج ${product.title}`, "\x1b[33m");
    return;
  }

  const imageUrls = [...new Set(product.images.map((i) => i.src))].slice(0, 10);
  const existing = syncData[product.id];

  try {
    // إذا كان هناك منشور سابق، نقوم بتحديثه بدل النشر من جديد
    if (existing?.ig_post_id) {
      log("[♻️]", `تحديث المنشور السابق للمنتج: ${product.title}`, "\x1b[33m");
      await updateMetaPost(existing.ig_post_id, caption);
      if (existing.fb_post_id && SYNC_TO_FACEBOOK) await updateMetaPost(existing.fb_post_id, caption);
      syncData[product.id].updated_at = new Date().toISOString();
      await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
      return;
    }

    // انتظار ذكي لتجنب رفض API
    await wait(5000);

    log("[📸]", `نشر منتج جديد: ${product.title}`, "\x1b[34m");
    const mediaIds = [];

    for (const img of imageUrls) {
      const media = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
        image_url: img,
        caption,
        access_token: META_ACCESS_TOKEN,
      });
      mediaIds.push(media.data.id);
      await wait(2000);
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

    await wait(4000);

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
      log("[🌍]", `✅ تم النشر أيضًا على فيسبوك (${product.title})`, "\x1b[32m");
    }

    syncData[product.id] = {
      ig_post_id: igPublish.data.id,
      fb_post_id: fbPublish?.data?.id || null,
      updated_at: new Date().toISOString(),
    };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });

    log("[✅]", `تم النشر على إنستجرام: ${product.title}`, "\x1b[32m");
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.message;
    log("[❌]", `فشل النشر أو التحديث (${product.title}): ${msg} (HTTP ${status || "?"})`, "\x1b[31m");
  }
}

// ✏️ تحديث منشور على Meta
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

// 🗑️ حذف المنشور من Meta عند المسودة
async function deleteFromMeta(productId) {
  const data = syncData[productId];
  if (!data) return;

  for (const key of ["ig_post_id", "fb_post_id"]) {
    if (data[key]) {
      try {
        await axios.delete(`${META_GRAPH_URL}/${data[key]}?access_token=${META_ACCESS_TOKEN}`);
        log("[🗑️]", `تم حذف ${key.includes("ig") ? "إنستجرام" : "فيسبوك"} (${productId})`, "\x1b[31m");
      } catch {
        log("[⚠️]", `فشل حذف ${key} (${productId})`, "\x1b[33m");
      }
    }
  }

  delete syncData[productId];
  await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
}

// ==================== Webhooks ====================
app.post("/webhook/products/create", async (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).send("Invalid HMAC");
  const product = req.body;

  if (product.status !== "active") {
    log("[⏸️]", `تخطي المنتج (draft أو archived): ${product.title}`, "\x1b[33m");
    return res.sendStatus(200);
  }

  log("[🆕]", `منتج جديد: ${product.title}`, "\x1b[32m");
  await smartPublish(product);
  res.sendStatus(200);
});

app.post("/webhook/products/update", async (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).send("Invalid HMAC");
  const product = req.body;

  if (["draft", "archived"].includes(product.status)) {
    await deleteFromMeta(product.id);
    return res.sendStatus(200);
  }

  log("[♻️]", `تحديث منتج: ${product.title}`, "\x1b[33m");
  await smartPublish(product);
  res.sendStatus(200);
});

app.post("/webhook/products/delete", async (req, res) => {
  if (!verifyShopifyHmac(req)) return res.status(401).send("Invalid HMAC");
  const product = req.body;
  log("[🗑️]", `تم حذف المنتج: ${product.title}`, "\x1b[31m");
  await deleteFromMeta(product.id);
  res.sendStatus(200);
});

// ==================== Running ====================
app.get("/", (_, res) => {
  res.send("🚀 eSelect Meta Sync v5.2.0 Smart Draft + Smart Update Running...");
});

app.listen(PORT, () => {
  log("[✅]", `Server running on port ${PORT}`, "\x1b[32m");
  log("[🌐]", `eSelect Meta Sync v5.2.0 initialized successfully`, "\x1b[36m");
});
