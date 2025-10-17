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

app.use("/webhook", bodyParser.raw({ type: "application/json" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const log = {
  info: (msg) => console.log(chalk.blue(`[ℹ️] ${msg}`)),
  success: (msg) => console.log(chalk.green(`[✅] ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[⚠️] ${msg}`)),
  error: (msg) => console.log(chalk.red(`[❌] ${msg}`)),
};

// 🔒 التحقق من توقيع Shopify
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

const SYNC_FILE = path.join("./sync.json");
let syncData = {};
if (fs.existsSync(SYNC_FILE)) {
  syncData = JSON.parse(fs.readFileSync(SYNC_FILE));
} else {
  fs.writeFileSync(SYNC_FILE, JSON.stringify({}));
}

// 🧹 تنظيف النص من الرموز الزائدة
function cleanText(text) {
  return text
    ?.replace(/\*\*/g, "")
    ?.replace(/\*/g, "")
    ?.replace(/\_/g, "")
    ?.replace(/\#/g, "")
    ?.replace(/\[/g, "")
    ?.replace(/\]/g, "")
    ?.trim();
}

// 🧠 توليد وصف إنستجرام مع رابط المنتج
async function generateCaption(title, desc, handle) {
  try {
    const prompt = `
اكتب وصفًا احترافيًا لمنشور إنستجرام لمنتج بعنوان "${title}"
مع 10 هاشتاقات مناسبة، ثم أضف عبارة ختامية "احصل عليه الآن عبر متجر إي سيلكت"
والوصف التالي:
${desc}
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
    const caption = cleanText(data.choices[0]?.message?.content || title);
    return `${caption}\n\n🔗 رابط المنتج:\nhttps://eselect.store/products/${handle}`;
  } catch (err) {
    log.error("فشل توليد الوصف التلقائي: " + err.message);
    return `${title}\n\nhttps://eselect.store/products/${handle}`;
  }
}

// 📸 نشر كألبوم Carousel
async function publishCarouselToInstagram(product) {
  try {
    const { title, body_html, images, handle } = product;
    if (!images?.length) {
      log.warn(`🚫 لا توجد صور للمنتج ${title}`);
      return;
    }

    const caption = await generateCaption(title, body_html, handle);
    const imageUrls = images.slice(0, 10).map((img) => img.src);
    const accessToken = process.env.META_LONG_LIVED_TOKEN;
    const igId = process.env.META_IG_BUSINESS_ID;

    const childIds = [];
    for (const imageUrl of imageUrls) {
      const uploadRes = await fetch(
        `https://graph.facebook.com/v20.0/${igId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: imageUrl,
            is_carousel_item: true,
            access_token: accessToken,
          }),
        }
      );
      const uploadData = await uploadRes.json();
      if (uploadData.id) childIds.push(uploadData.id);
    }

    if (childIds.length === 0) {
      log.error(`❌ فشل رفع الصور لألبوم المنتج ${title}`);
      return;
    }

    // ✅ تأخير 8 ثوانٍ للسماح للوسائط بالجهوزية
    await new Promise((resolve) => setTimeout(resolve, 8000));

    const containerRes = await fetch(
      `https://graph.facebook.com/v20.0/${igId}/media`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_type: "CAROUSEL",
          caption,
          children: childIds,
          access_token: accessToken,
        }),
      }
    );
    const containerData = await containerRes.json();

    if (!containerData.id) {
      log.error(`❌ فشل إنشاء ألبوم المنتج ${title}`);
      return;
    }

    // ✅ تأخير إضافي بسيط قبل النشر النهائي
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const publishRes = await fetch(
      `https://graph.facebook.com/v20.0/${igId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerData.id,
          access_token: accessToken,
        }),
      }
    );

    const publishData = await publishRes.json();
    if (publishData.id) {
      syncData[product.id] = { ig_post_id: publishData.id };
      fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData, null, 2));
      log.success(`📸 تم نشر المنتج على إنستجرام: ${title}`);
    } else {
      log.error(`❌ فشل نشر المنتج ${title}: ${JSON.stringify(publishData)}`);
    }
  } catch (err) {
    log.error(`خطأ أثناء النشر: ${err.message}`);
  }
}

// 🔁 معالجة المنتج (إضافة/تحديث/حذف)
async function handleProduct(data, type) {
  const title = data.title || "منتج بدون اسم";
  if (type === "create" || type === "update") {
    log.info(`🆕 مزامنة المنتج: ${title}`);
    await publishCarouselToInstagram(data);
  } else if (type === "delete") {
    log.warn(`🗑️ حذف المنتج: ${title}`);
    const post = syncData[data.id];
    if (post?.ig_post_id) {
      await fetch(
        `https://graph.facebook.com/v20.0/${post.ig_post_id}?access_token=${process.env.META_LONG_LIVED_TOKEN}`,
        { method: "DELETE" }
      );
      delete syncData[data.id];
      fs.writeFileSync(SYNC_FILE, JSON.stringify(syncData, null, 2));
      log.warn(`🚮 تم حذف منشور إنستجرام للمنتج ${title}`);
    }
  }
}

// ✅ Webhooks
app.post("/webhook/product-create", async (req, res) => {
  log.info("📦 Received webhook: product-create");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "create");
  res.send("ok");
});

app.post("/webhook/product-update", async (req, res) => {
  log.info("📦 Received webhook: product-update");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "update");
  res.send("ok");
});

app.post("/webhook/product-delete", async (req, res) => {
  log.info("📦 Received webhook: product-delete");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "delete");
  res.send("ok");
});

// ✳️ مزامنة فورية
app.get("/sync-now", async (req, res) => {
  log.info("🔁 تنفيذ مزامنة فورية الآن...");
  res.send("✅ تم بدء المزامنة اليدوية الآن، راقب اللوج...");
  await periodicSync();
});

// 🔄 مراجعة دورية كل 6 ساعات
async function periodicSync() {
  try {
    log.info("🔄 بدء المراجعة الدورية مع Shopify...");
    const shopifyUrl = `${process.env.SHOP_URL}/admin/api/2024-07/products.json?limit=250`;
    const res = await fetch(shopifyUrl, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    if (!data.products) {
      log.warn("⚠️ لم يتم العثور على منتجات.");
      return;
    }
    for (const product of data.products) {
      if (!syncData[product.id]) {
        log.info(`🆕 منتج جديد غير متزامن: ${product.title}`);
        await publishCarouselToInstagram(product);
      }
    }
    log.success("✅ تمت المزامنة الدورية بنجاح.");
  } catch (err) {
    log.error(`❌ فشل المزامنة الدورية: ${err.message}`);
  }
}

setTimeout(periodicSync, 5 * 60 * 1000);
setInterval(periodicSync, 6 * 60 * 60 * 1000);

app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Sync v4.2 — Carousel Publishing Fixed");
});

app.listen(PORT, () => {
  log.success(`✅ Server running on port ${PORT}`);
  log.info(`🌐 Primary URL: https://eselect-meta-sync.onrender.com`);
});
