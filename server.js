import express from "express";
import crypto from "crypto";
import chalk from "chalk";
import dayjs from "dayjs";
import axios from "axios";

const app = express();

// ====== المتغيرات من البيئة ======
const PORT = process.env.PORT || 3000;
const SHOP_URL = process.env.SHOP_URL;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;

// ====== دوال اللوج ======
const log = {
  info: (msg) => console.log(chalk.cyan(`[${dayjs().format("HH:mm:ss")}] ℹ️ ${msg}`)),
  success: (msg) => console.log(chalk.green(`[${dayjs().format("HH:mm:ss")}] ✅ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[${dayjs().format("HH:mm:ss")}] ⚠️ ${msg}`)),
  error: (msg) => console.log(chalk.red(`[${dayjs().format("HH:mm:ss")}] ❌ ${msg}`)),
};

// ====== إعداد الـ body الخام ======
app.use("/webhook", express.raw({ type: "application/json" }));

// ====== التحقق من توقيع Shopify ======
function verifyShopifyWebhook(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const digest = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(req.body, "utf8")
    .digest("base64");
  const verified = digest === hmacHeader;

  if (!verified) log.warn("⚠️ Invalid webhook signature — ignored");
  return verified;
}

// ====== دالة النشر في Instagram + Facebook ======
async function publishToMeta(product) {
  try {
    const caption = `${product.title}\n\n${product.body_html?.replace(/<[^>]*>/g, "") || ""}\n\n🛍️ تسوق الآن:\n${SHOP_URL}/products/${product.handle}`;
    const imageUrl = product.image?.src;

    // 1️⃣ إنشاء Media Container في Instagram
    const mediaResponse = await axios.post(
      `https://graph.facebook.com/v20.0/${META_IG_ID}/media`,
      {
        image_url: imageUrl,
        caption: caption,
        access_token: META_ACCESS_TOKEN,
      }
    );

    const creationId = mediaResponse.data.id;
    log.info(`📸 Instagram media created with ID: ${creationId}`);

    // 2️⃣ نشره فعلياً في Instagram
    await axios.post(
      `https://graph.facebook.com/v20.0/${META_IG_ID}/media_publish`,
      {
        creation_id: creationId,
        access_token: META_ACCESS_TOKEN,
      }
    );

    log.success(`🎉 Product posted to Instagram successfully: ${product.title}`);

    // 3️⃣ مشاركة نفس المنشور إلى صفحة فيسبوك
    await axios.post(
      `https://graph.facebook.com/v20.0/${META_PAGE_ID}/photos`,
      {
        url: imageUrl,
        caption: caption,
        access_token: META_ACCESS_TOKEN,
      }
    );

    log.success(`🌍 Product shared on Facebook page successfully`);

  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    log.error(`Failed to post to Meta: ${msg}`);
  }
}

// ====== Webhook: إنشاء منتج ======
app.post("/webhook/product-create", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");
  const product = JSON.parse(req.body.toString("utf8"));
  log.success(`🆕 New product created: ${product.title}`);
  await publishToMeta(product);
  res.status(200).send("OK");
});

// ====== Webhook: تحديث منتج ======
app.post("/webhook/product-update", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");
  const product = JSON.parse(req.body.toString("utf8"));
  log.info(`🔁 Product updated: ${product.title}`);
  await publishToMeta(product);
  res.status(200).send("OK");
});

// ====== Webhook: حذف منتج ======
app.post("/webhook/product-delete", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");
  const product = JSON.parse(req.body.toString("utf8"));
  log.warn(`🗑️ Product deleted: ${product.id}`);
  res.status(200).send("OK");
});

// ====== صفحة اختبار ======
app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Sync is running successfully!");
});

// ====== تشغيل السيرفر ======
app.listen(PORT, () => {
  log.success(`Server running on port ${PORT}`);
  log.info(`Primary URL: https://eselect-meta-sync.onrender.com`);
});
