import express from "express";
import axios from "axios";
import crypto from "crypto";
import fs from "fs-extra";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const SHOP_URL = process.env.SHOP_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const META_GRAPH_URL = process.env.META_GRAPH_URL;
const META_IG_ID = process.env.META_IG_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const SYNC_FILE = "./sync.json";
if (!fs.existsSync(SYNC_FILE)) fs.writeJsonSync(SYNC_FILE, { posts: {} });

// 🧠 Helper — verify Shopify webhook
function verifyShopify(req) {
  const hmac = req.get("x-shopify-hmac-sha256");
  const body = JSON.stringify(req.body);
  const digest = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return digest === hmac;
}

// 🧠 Helper — post log to console + render UI
function logLine(line, res = null) {
  console.log(line);
  if (res) res.write(`${line}\n`);
}

// 📦 Publish to Instagram
async function publishToInstagram(product) {
  const desc = (product.body_html || "").replace(/(<([^>]+)>)/gi, "").trim();
  const caption = `✨ ${product.title}\n\n${desc}\n\n🔗 احصل عليه الآن عبر متجرنا:\n${SHOP_URL}/products/${product.handle}`;
  const images = product.images?.map((img) => img.src) || [];

  if (!images.length) {
    console.log(`[⚠️] 🚫 لا توجد صور للمنتج ${product.title}`);
    return false;
  }

  try {
    // 1️⃣ إنشاء الوسائط
    const creationIds = [];
    for (const url of images.slice(0, 10)) {
      const res = await axios.post(
        `${META_GRAPH_URL}/${META_IG_ID}/media`,
        {
          image_url: url,
          caption: caption,
          access_token: META_ACCESS_TOKEN,
        }
      );
      creationIds.push(res.data.id);
    }

    // 2️⃣ إنشاء ألبوم
    const album = await axios.post(
      `${META_GRAPH_URL}/${META_IG_ID}/media`,
      {
        children: creationIds,
        media_type: "CAROUSEL",
        caption: caption,
        access_token: META_ACCESS_TOKEN,
      }
    );

    // 3️⃣ نشر الألبوم
    await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, {
      creation_id: album.data.id,
      access_token: META_ACCESS_TOKEN,
    });

    console.log(`[✅] 📸 تم نشر المنتج على إنستجرام: ${product.title}`);
    return true;
  } catch (err) {
    console.error(`[❌] فشل نشر المنتج ${product.title}: ${err.response?.data?.error?.message}`);
    return false;
  }
}

// 🔁 Sync from Shopify
async function syncProducts(res = null) {
  const startTime = Date.now();
  logLine("[ℹ️] 🔁 بدء المزامنة اليدوية...", res);

  const syncData = await fs.readJson(SYNC_FILE);
  let newCount = 0;
  let skipped = 0;

  try {
    const shopifyRes = await axios.get(`${SHOP_URL}/admin/api/2025-10/products.json`, {
      headers: { "X-Shopify-Access-Token": SHOPIFY_ACCESS_TOKEN },
      params: { limit: 50 }
    });
    const products = shopifyRes.data.products || [];
    if (!products.length) {
      logLine("[⚠️] ⚠️ لم يتم العثور على منتجات.", res);
      return;
    }

    for (const product of products) {
      if (syncData.posts[product.id]) {
        skipped++;
        continue;
      }
      const ok = await publishToInstagram(product);
      if (ok) {
        newCount++;
        syncData.posts[product.id] = { title: product.title, time: new Date().toISOString() };
        await fs.writeJson(SYNC_FILE, syncData, { spaces: 2 });
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logLine(`\n[📊] تمت المزامنة بنجاح — تم نشر ${newCount} منتجات جديدة وتخطي ${skipped} منتجات.`, res);
    logLine(`[⏱] استغرقت المزامنة ${duration} ثانية.`, res);
    logLine(`[🧩] إجمالي المنتجات المفحوصة: ${products.length}`, res);
  } catch (err) {
    console.error("[❌] خطأ أثناء المزامنة:", err.message);
    if (res) res.write(`[❌] ${err.message}\n`);
  }

  if (res) res.end("\n✅ تمت المزامنة اليدوية بنجاح.\n");
}

// 🌐 Webhooks
app.post("/webhook/product-create", (req, res) => {
  if (!verifyShopify(req)) return res.status(401).send("HMAC failed");
  console.log("[🆕] 📦 منتج جديد تم إنشاؤه.");
  publishToInstagram(req.body);
  res.status(200).send("OK");
});

app.post("/webhook/product-update", (req, res) => {
  if (!verifyShopify(req)) return res.status(401).send("HMAC failed");
  console.log("[♻️] 🔄 تم تحديث المنتج.");
  publishToInstagram(req.body);
  res.status(200).send("OK");
});

// 🧹 Deletion hook
app.post("/webhook/product-delete", async (req, res) => {
  if (!verifyShopify(req)) return res.status(401).send("HMAC failed");
  const syncData = await fs.readJson(SYNC_FILE);
  delete syncData.posts[req.body.id];
  await fs.writeJson(SYNC_FILE, syncData, { spaces: 2 });
  console.log(`[🗑️] تم حذف المنتج: ${req.body.id}`);
  res.status(200).send("Deleted OK");
});

// 🌍 Manual sync via browser
app.get("/sync-now", async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  syncProducts(res);
});

// Root
app.get("/", (_, res) => {
  res.send("🚀 eSelect Meta Sync v4.3 running — manual sync at /sync-now");
});

// Start
app.listen(PORT, () => {
  console.log(`[✅] ✅ Server running on port ${PORT}`);
  console.log(`[🌐] Primary URL: https://eselect-meta-sync.onrender.com`);
});
