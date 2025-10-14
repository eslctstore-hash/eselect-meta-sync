const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const { META_ACCESS_TOKEN, META_PAGE_ID, META_IG_ID, OPENAI_API_KEY, SHOPIFY_SECRET } = process.env;

// ========== VERIFY SHOPIFY WEBHOOK ==========
function verifyShopify(req) {
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return hmacHeader === hash;
}

// ========== GENERATE CAPTION & HASHTAGS ==========
async function generateCaption(product) {
  const prompt = `
Generate a bilingual Instagram caption (Arabic + English) for this product:
Name: ${product.title}
Description: ${product.body_html}
Create also 10 hashtags in Arabic and English related to it.
Return as:
Caption: ...
Hashtags: ...
  `;
  const res = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    },
    {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    }
  );
  return res.data.choices[0].message.content;
}

// ========== POST TO FACEBOOK & INSTAGRAM ==========
async function postToMeta(product, caption, imageUrl) {
  // Post to Facebook Page
  await axios.post(
    `https://graph.facebook.com/${META_PAGE_ID}/photos`,
    {
      url: imageUrl,
      caption: caption,
      access_token: META_ACCESS_TOKEN,
    }
  );

  // Post to Instagram
  const igContainer = await axios.post(
    `https://graph.facebook.com/v19.0/${META_IG_ID}/media`,
    {
      image_url: imageUrl,
      caption: caption,
      access_token: META_ACCESS_TOKEN,
    }
  );
  const creationId = igContainer.data.id;
  await axios.post(
    `https://graph.facebook.com/v19.0/${META_IG_ID}/media_publish`,
    {
      creation_id: creationId,
      access_token: META_ACCESS_TOKEN,
    }
  );
}

// ========== MAIN HANDLERS ==========
app.post("/webhook/product-create", async (req, res) => {
  if (!verifyShopify(req)) return res.sendStatus(401);
  const product = req.body;
  try {
    const caption = await generateCaption(product);
    const imageUrl = product.image?.src || product.images[0]?.src;
    await postToMeta(product, caption, imageUrl);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

app.post("/webhook/product-update", async (req, res) => {
  if (!verifyShopify(req)) return res.sendStatus(401);
  const product = req.body;
  if (product.status === "active") {
    const caption = await generateCaption(product);
    const imageUrl = product.image?.src || product.images[0]?.src;
    await postToMeta(product, caption, imageUrl);
  } else {
    // Optionally hide or delete from Meta
    console.log(`Product ${product.title} is ${product.status}, consider removing.`);
  }
  res.sendStatus(200);
});

app.post("/webhook/product-delete", async (req, res) => {
  if (!verifyShopify(req)) return res.sendStatus(401);
  console.log("Product deleted:", req.body.id);
  // Optional: call Graph API to delete post if you stored post IDs
  res.sendStatus(200);
});

// ========== SERVER TEST ==========
app.get("/", (req, res) => {
  res.send("🚀 eSelect Meta Auto-Publish system running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
