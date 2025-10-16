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
// إعداد قراءة body الخام فقط لمسار /webhook
// ========================================
app.use(
  "/webhook",
  bodyParser.raw({ type: "application/json" })
);

// ========================================
// إعداد عام لبقية المسارات
// ========================================
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
    const body = req.body; // raw buffer
    const digest = crypto
      .createHmac("sha256", process.env.SHOPIFY_SECRET)
      .update(body, "utf8")
      .digest("base64");

    const verified = crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmacHeader, "utf8")
    );

    if (verified) log.success("Shopify HMAC verified successfully ✅");
    else log.error("Shopify HMAC verification failed ❌");

    return verified;
  } catch (err) {
    log.error("HMAC verification error: " + err.message);
    return false;
  }
}

// ========================================
// دالة التعامل مع المنتجات
// ========================================
async function handleProduct(data, type) {
  try {
    const id = data.id || data.admin_graphql_api_id;
    const title = data.title || "منتج بدون اسم";
    const updatedAt = data.updated_at || new Date();

    if (type === "create") {
      log.success(`🆕 تم إنشاء منتج جديد: ${title} (${id})`);
    } else if (type === "update") {
      log.info(`♻️ تم تحديث المنتج: ${title} (${id})`);
    } else if (type === "delete") {
      log.warn(`🗑️ تم حذف المنتج: ${title} (${id})`);
    }

    // سيتم لاحقًا هنا تنفيذ النشر على Instagram/Facebook
  } catch (err) {
    log.error(`حدث خطأ أثناء معالجة المنتج: ${err.message}`);
  }
}

// ========================================
// Webhook: إنشاء منتج
// ========================================
app.post("/webhook/product-created", async (req, res) => {
  log.info("📦 Received webhook: product-created");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");

  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "create");
  res.send("ok");
});

// Webhook: تحديث منتج
app.post("/webhook/product-updated", async (req, res) => {
  log.info("📦 Received webhook: product-updated");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");

  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "update");
  res.send("ok");
});

// Webhook: حذف منتج
app.post("/webhook/product-deleted", async (req, res) => {
  log.info("📦 Received webhook: product-deleted");
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");

  const data = JSON.parse(req.body.toString("utf8"));
  await handleProduct(data, "delete");
  res.send("ok");
});

// ========================================
// نقطة الفحص
// ========================================
app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Sync v2 running");
  log.success(`🚀 eSelect Meta Sync v2 running at ${dayjs().format("HH:mm:ss")}`);
});

// ========================================
// تشغيل السيرفر
// ========================================
app.listen(PORT, () => {
  log.success(`Server running on port ${PORT}`);
  log.info(`Primary URL: https://eselect-meta-sync.onrender.com`);
});
