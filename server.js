// ================== IMPORTS ==================
import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json({ limit: "10mb" }));

// ================== ENV VARS ==================
const PORT = process.env.PORT || 3000;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PAGE_ID = process.env.META_PAGE_ID || "717438604779206"; // Facebook Page ID
const META_IG_ID = process.env.META_IG_ID; // Instagram Business Account ID
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

// ================== STARTUP ==================
app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Sync Server is running successfully!");
});
console.log(`✅ Server running on port ${PORT}`);

// ================== VERIFY SHOPIFY WEBHOOK ==================
function verifyShopifyWebhook(req) {
  try {
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const body = JSON.stringify(req.body);
    const digest = crypto
      .createHmac("sha256", SHOPIFY_SECRET)
      .update(body, "utf8")
      .digest("base64");
    return digest === hmacHeader;
  } catch (err) {
    console.error("❌ Error verifying webhook:", err.message);
    return false;
  }
}

// ================== META HELPERS ==================
async function postToFacebook(message, imageUrl, productUrl) {
  try {
    const postUrl = `https://graph.facebook.com/v21.0/${META_PAGE_ID}/photos`;
    const res = await axios.post(
      postUrl,
      {
        caption: `${message}\n\n🔗 ${productUrl}`,
        url: imageUrl,
        access_token: META_ACCESS_TOKEN,
      },
      { headers: { "Content-Type": "application/json" } }
    );
    console.log("✅ [Meta] Posted to Facebook:", res.data.id);
  } catch (err) {
    console.error("❌ [Meta] Facebook Post Error:", err.response?.data || err.message);
  }
}

async function postToInstagram(caption, imageUrl) {
  try {
    // Step 1: Upload Image
    const mediaRes = await axios.post(
      `https://graph.facebook.com/v21.0/${META_IG_ID}/media`,
      {
        image_url: imageUrl,
        caption: caption,
        access_token: META_ACCESS_TOKEN,
      }
    );

    // Step 2: Publish it
    const publishRes = await axios.post(
      `https://graph.facebook.com/v21.0/${META_IG_ID}/media_publish`,
      {
        creation_id: mediaRes.data.id,
        access_token: META_ACCESS_TOKEN,
      }
    );

    console.log("✅ [Meta] Posted to Instagram:", publishRes.data.id);
  } catch (err) {
    console.error("❌ [Meta] Instagram Post Error:", err.response?.data || err.message);
  }
}

// ================== WEBHOOK: PRODUCT CREATE ==================
app.post("/webhook/product-create", async (req, res) => {
  if (!verifyShopifyWebhook(req)) {
    console.log("⚠️ [Webhook] Invalid signature, ignoring.");
    return res.status(401).send("Invalid signature");
  }

  const product = req.body;
  console.log("✅ [Webhook] Product created:", product.title);

  const title = product.title;
  const description = product.body_html?.replace(/<[^>]*>?/gm, "") || "";
  const imageUrl = product?.images?.[0]?.src || "";
  const productUrl = `https://eselect.store/products/${product.handle}`;

  const caption = `🛍️ ${title}\n\n${description.substring(0, 250)}...\n\n#eSelect #عروض #تسوق #منتجات_عمانية`;

  // Publish to Meta
  await postToFacebook(caption, imageUrl, productUrl);
  await postToInstagram(caption, imageUrl);

  res.status(200).send("OK");
});

// ================== WEBHOOK: PRODUCT UPDATE ==================
app.post("/webhook/product-update", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");

  const product = req.body;
  console.log("🌀 [Webhook] Product updated:", product.title);
  res.status(200).send("OK");
});

// ================== WEBHOOK: PRODUCT DELETE ==================
app.post("/webhook/product-delete", async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send("Invalid signature");

  console.log("🗑️ [Webhook] Product deleted:", req.body.id);
  res.status(200).send("OK");
});

// ================== START SERVER ==================
app.listen(PORT, () => {
  console.log(`🚀 eSelect Meta Sync running at port ${PORT}`);
});
