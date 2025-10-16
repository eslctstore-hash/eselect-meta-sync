import express from "express";
import crypto from "crypto";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import dayjs from "dayjs";
import chalk from "chalk";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// ========================================
// إعداد قراءة body الخام لمسار /webhook
// ========================================
app.use("/webhook", bodyParser.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================================
// دالة الطباعة بالألوان
// ========================================
const log = {
  info: (msg) => console.log(chalk.blue(`[ℹ️] ${msg}`)),
  success: (msg) => console.log(chalk.green(`[✅] ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[⚠️] ${msg}`)),
  error: (msg) => console.log(chalk.red(`[❌] ${msg}`)),
};

// ========================================
// تحقق من توقيع Shopify HMAC
// ========================================
function verifyShopify(req) {
  try {
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const body = req.body;
    const digest = crypto
      .createHmac("sha256", process.env.SHOPIFY_SECRET)
      .update(body, "utf8")
      .digest("base64");

    const verified = crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );
    if (verified) log.success("✅ Shopify HMAC verified successfully");
    else log.error("❌ Invalid Shopify signature");

    return verified;
  } catch (err) {
    log.error("HMAC verification error: " + err.message);
    return false;
  }
}

// ========================================
// تحميل ملف sync.json
// ========================================
const SYNC_FILE = path.join("./sync.json");
let syncData = {};
if (fs.existsSync(SYNC_FILE)) {
  syncData = JSON.parse(fs.readFileSync(SYNC_FILE));
} else {
  fs.writeFileSync(SYNC_FILE, JSON.stringify({}));
}

// ========================================
// إنشاء منشور في إنستجرام
// ========================================
async function publishToInstagram(product) {
  try {
    const { title, body_html, images, handle } = product;
    if (!images || images.length === 0) {
      log.warn(`🚫 لا توجد صور للمنتج ${title}`);
      return;
    }

    const imageUrls = images.slice(0, 10).map((img) => img.src);
    const caption = await generateCaption(title, body_html, handle);

    const publishUrl = `https://graph.facebook.com/v20.0/${process.env.META_IG_BUSINESS_ID}/media_publish`;
    const uploadUrl = `https://graph.facebook.com/v20.0/${process.env.META_IG_BUSINESS_ID}/media`;

    let creationIds = [];
    for (const imageUrl of imageUrls) {
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          caption,
          access_token: process.env.META_LONG_LIVED_TOKEN,
        }),
      });
      const uploadData = await uploadRes.json();
      if (uploadData.id) {
        creationIds.push(uploadData.id);
      }
    }

    if (creationIds.length > 0) {
      const res = await fetch(publishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: creationIds[0],
          access_token: process.env.META_LONG_LIVED_TOKEN,
        }),
      });
      const data = await res.json();
      if (data.id) {
        syncData[product.id] = { ig_post_id: data.id };
        fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData, null, 2));
        log.success(`📸 تم نشر المنتج على إنستجرام: ${title}`);
      } else {
        log.error(`فشل نشر المنتج ${title}: ${JSON.stringify(data)}`);
      }
    }
  } catch (err) {
    log.error(`خطأ أثناء النشر على إنستجرام: ${err.message}`);
  }
}

// ========================================
// توليد وصف وهاشتاقات تلقائيًا
// ========================================
async function generateCaption(title, desc, handle) {
  try {
    const prompt = `
اكتب منشورًا قصيرًا لمنتج بعنوان "${title}"، 
ثم أضف 10 هاشتاقات مناسبة بناءً على الاسم والوصف، 
وفي النهاية ضع رابط المنتج: https://eselect.store/products/${handle}
الوصف: ${desc}
    `;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();
    return data.choices[0]?.message?.content || `${title}\nhttps://eselect.store/products/${handle}`;
  } catch (err) {
    log.error("فشل توليد الوصف التلقائي: " + err.message);
    return `${title}\nhttps://eselect.store/products/${handle}`;
  }
}

// ========================================
// معالجة المنتج
// ========================================
async function handleProduct(data, type) {
  const title = data.title || "منتج بدون اسم";
  if (type === "create") {
    log.success(`🆕 تم إنشاء منتج جديد: ${title}`);
    await publishToInstagram(data);
  } else if (type === "update") {
    log.info(`♻️ تم تحديث المنتج: ${title}`);
    await publishToInstagram(data);
  } else if (type === "delete") {
    log.warn(`🗑️ تم حذف المنتج: ${title}`);
    const post = syncData[data.id];
    if (post?.ig_post_id) {
      await fetch(`https://graph.facebook.com/v20.0/${post.ig_post_id}?access_token=${process.env.META_LONG_LIVED_TOKEN}`, {
        method: "DELETE",
      });
      delete syncData[data.id];
      fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData, null, 2));
      log.warn(`🚮 تم حذف منشور الإنستجرام المتعلق بالمنتج ${title}`);
    }
  }
}

// ========================================
// Webhooks Shopify
// ========================================
app.post("/webhook/product-created", async (req, res) => {
  log.info("📦 Received webhook: product-created");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "create");
  res.send("ok");
});

app.post("/webhook/product-updated", async (req, res) => {
  log.info("📦 Received webhook: product-updated");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "update");
  res.send("ok");
});

app.post("/webhook/product-deleted", async (req, res) => {
  log.info("📦 Received webhook: product-deleted");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "delete");
  res.send("ok");
});

// ========================================
// نقطة فحص التشغيل
// ========================================
app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Sync v3 running (Instagram Publisher)");
  log.success(`🚀 eSelect Meta Sync v3 running at ${dayjs().format("HH:mm:ss")}`);
});

// ========================================
// تشغيل السيرفر
// ========================================
app.listen(PORT, () => {
  log.success(`✅ Server running on port ${PORT}`);
  log.info(`🌐 Primary URL: https://eselect-meta-sync.onrender.com`);
});
