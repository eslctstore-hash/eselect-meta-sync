/**
 * eSelect Meta Sync v5.2.3
 * - Smart Create Delay (wait 2 minutes before queue)
 * - Ignore Product Updates (handled by another server)
 * - Smart Queue + Retry Backoff + Daily Sync retained
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
    limit: "15mb",
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

// ==================== SMART IMAGE CHECK ====================
async function waitForImages(product) {
  if (!product.images?.length) return false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const url = product.images[0].src;
      await axios.head(url);
      log("[🖼️]", `الصور جاهزة (${product.title})`);
      return true;
    } catch {
      const delay = attempt * 30000; // 30, 60, 90 seconds
      log("[⏳]", `الصور غير جاهزة (${product.title}) - إعادة المحاولة بعد ${delay / 1000} ثانية...`, "\x1b[33m");
      await wait(delay);
    }
  }
  log("[⚠️]", `الصور لم تُصبح جاهزة بعد 3 محاولات (${product.title}) — سيتم نشرها لاحقًا.`, "\x1b[33m");
  return false;
}

// ==================== QUEUE SYSTEM ====================
const publishQueue = [];
let isPublishing = false;
const QUEUE_INTERVAL = 120000; // 2 minutes
const RETRY_BACKOFF = 5 * 60 * 1000; // 5 minutes

async function queueProcessor() {
  if (isPublishing || publishQueue.length === 0) return;
  isPublishing = true;
  const { product, source } = publishQueue.shift();

  log("[🚀]", `بدء نشر من ${source}: ${product.title}`, "\x1b[36m");
  await publishOrUpdate(product);

  isPublishing = false;
  setTimeout(queueProcessor, QUEUE_INTERVAL);
}

// ==================== META PUBLISH ====================
async function publishOrUpdate(product) {
  const caption = `${product.title}\n\n${cleanText(product.body_html)}\n\n🔗 احصل عليه الآن من متجر eSelect:\n${product.online_store_url}\n\n#eSelect #عمان #الكترونيات #تسوق_الكتروني`;
  const existing = syncData[product.id];

  try {
    if (existing?.ig_post_id) {
      log("[♻️]", `تم نشر المنتج مسبقًا (${product.title}) – تخطي التكرار.`, "\x1b[33m");
      return;
    }

    const ready = await waitForImages(product);
    if (!ready) {
      syncData[product.id] = { status: "pending", title: product.title, updated_at: now() };
      await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
      return;
    }

    const imageUrls = [...new Set(product.images.map((i) => i.src))].slice(0, 10);
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
    }

    syncData[product.id] = {
      ig_post_id: igPublish.data.id,
      fb_post_id: fbPublish?.data?.id || null,
      updated_at: now(),
      status: "success",
    };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
    log("[✅]", `تم النشر (${product.title})`, "\x1b[32m");
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    if (msg.includes("User is performing too many actions")) {
      log("[⚠️]", `Meta رفض النشر (${product.title}) — إعادة المحاولة بعد 5 دقائق.`, "\x1b[33m");
      setTimeout(() => publishQueue.push({ product, source: "RetryBackoff" }), RETRY_BACKOFF);
    } else {
      log("[❌]", `فشل النشر (${product.title}): ${msg}`, "\x1b[31m");
    }
    syncData[product.id] = { status: "failed", title: product.title, error: msg, updated_at: now() };
    await fs.writeJSON(SYNC_FILE, syncData, { spaces: 2 });
  }
}

// ==================== DAILY RESYNC ====================
async function dailyResync() {
  const failed = Object.entries(syncData).filter(
    ([, v]) => v.status === "failed" || v.status === "pending"
  );
  if (!failed.length) return;
  log("[🔁]", `بدء المزامنة اليومية (${failed.length} منتج)...`, "\x1b[36m");
  for (const [id, data] of failed) {
    try {
      const productRes = await axios.get(
        `https://${SHOP_URL}/admin/api/2024-10/products/${id}.json`,
        { headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN } }
      );
      const product = productRes.data.product;
      if (product.status === "active") {
        publishQueue.push({ product, source: "DailyResync" });
      }
    } catch (err) {
      log("[⚠️]", `فشل استرجاع المنتج ${id}: ${err.message}`, "\x1b[33m");
    }
  }
  log("[ℹ️]", "تمت إضافة المنتجات إلى الطابور اليومي.", "\x1b[36m");
  queueProcessor();
}
setInterval(dailyResync, 24 * 60 * 60 * 1000);

// ==================== WEBHOOKS ====================

// 🧠 Smart Create Delay — wait 2 min before queuing
app.post("/webhook/products/create", async (req, res) => {
  if (!verifyHmac(req)) return res.status(401).send("Invalid HMAC");
  const product = req.body;
  if (product.status !== "active") return res.sendStatus(200);
  log("[🆕]", `منتج جديد: ${product.title}`, "\x1b[32m");

  // انتظار دقيقتين قبل إضافته للطابور
  setTimeout(() => {
    publishQueue.push({ product, source: "WebhookCreate" });
    queueProcessor();
  }, 120000);

  res.sendStatus(200);
});

// ❌ Ignore updates completely
app.post("/webhook/products/update", async (req, res) => {
  if (!verifyHmac(req)) return res.status(401).send("Invalid HMAC");
  const product = req.body;
  log("[⚙️]", `تم تجاهل تحديث المنتج: ${product.title} (ت handled by translation server)`, "\x1b[33m");
  res.sendStatus(200);
});

// ==================== SERVER ====================
app.get("/", (_, res) => {
  res.send("🚀 eSelect Meta Sync v5.2.3 Smart Delay + Ignore Update running...");
});

app.listen(PORT, () => {
  log("[✅]", `Server running on port ${PORT}`, "\x1b[32m");
  log("[🕓]", "Create delay: 2 minutes | Queue interval: 2 minutes", "\x1b[36m");
  log("[🌐]", "Daily resync enabled (every 24h)", "\x1b[36m");
});
