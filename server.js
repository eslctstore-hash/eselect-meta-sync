import express from "express";
import crypto from "crypto";
import chalk from "chalk"; // لإضافة ألوان للّوج
import dayjs from "dayjs"; // لعرض التوقيت بشكل جميل
import axios from "axios";

const app = express();

// ========== إعدادات عامة ==========
const PORT = process.env.PORT || 3000;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_IG_ID = process.env.META_IG_ID;
const SHOP_URL = process.env.SHOP_URL;

// ========== دوال مساعدة ==========
function logInfo(msg) {
  console.log(chalk.blue(`[${dayjs().format("HH:mm:ss")}] ℹ️ ${msg}`));
}

function logSuccess(msg) {
  console.log(chalk.green(`[${dayjs().format("HH:mm:ss")}] ✅ ${msg}`));
}

function logWarn(msg) {
  console.log(chalk.yellow(`[${dayjs().format("HH:mm:ss")}] ⚠️ ${msg}`));
}

function logError(msg) {
  console.log(chalk.red(`[${dayjs().format("HH:mm:ss")}] ❌ ${msg}`));
}

// ========== استقبال Body الخام للويبهوك ==========
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));

// ========== دالة التحقق من توقيع Shopify ==========
function verifyShopifyWebhook(req) {
  try {
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : req.body;
    const digest = crypto
      .createHmac("sha256", SHOPIFY_SECRET)
      .update(rawBody, "utf8")
      .digest("base64");

    const valid = digest === hmacHeader;

    if (!valid) {
      logWarn("Webhook signature mismatch!");
      console.log("Header:", hmacHeader);
      console.log("Digest:", digest);
      console.log("Secret (first 10):", SHOPIFY_SECRET.slice(0, 10) + "...");
    }

    return valid;
  } catch (err) {
    logError(`Error verifying webhook: ${err.message}`);
    return false;
  }
}

// ========== دالة النشر على Meta ==========
async function publishToMeta(product) {
  try {
    const caption = `${product.title}\n\n${product.body_html?.replace(/<[^>]+>/g, "") || ""}\n\n🛍️ تسوق الآن من ${SHOP_URL}/products/${product.handle}`;
    const image = product.image?.src;

    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${META_IG_ID}/media`,
      {
        image_url: image,
        caption: caption,
        access_token: META_ACCESS_TOKEN,
      }
    );

    logSuccess(`Posted to Instagram successfully! ID: ${response.data.id}`);
  } catch (err) {
    logError(`Failed to post to Meta: ${err.response?.data?.error?.message || err.message}`);
  }
}

// ========== Webhook: إنشاء منتج ==========
app.post("/webhook/product-create", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");
  const product = JSON.parse(req.body.toString("utf8"));
  logSuccess(`New product created: ${product.title}`);
  await publishToMeta(product);
  res.status(200).send("OK");
});

// ========== Webhook: تحديث منتج ==========
app.post("/webhook/product-update", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");
  const product = JSON.parse(req.body.toString("utf8"));
  logInfo(`Product updated: ${product.title}`);
  await publishToMeta(product);
  res.status(200).send("OK");
});

// ========== Webhook: حذف منتج ==========
app.post("/webhook/product-delete", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");
  const product = JSON.parse(req.body.toString("utf8"));
  logWarn(`Product deleted: ${product.id}`);
  res.status(200).send("OK");
});

// ========== التشغيل ==========
app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Sync running successfully!");
});

app.listen(PORT, () => {
  logSuccess(`Server running on port ${PORT}`);
  logInfo(`Primary URL: https://eselect-meta-sync.onrender.com`);
});
