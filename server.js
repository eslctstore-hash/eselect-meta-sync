const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "10mb" }));

const { META_ACCESS_TOKEN, META_IG_ID, OPENAI_API_KEY, SHOPIFY_SECRET } = process.env;

// ====== VERIFY SHOPIFY WEBHOOK ======
function verifyShopify(req) {
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  const body = JSON.stringify(req.body);
  const hash = crypto
    .createHmac("sha256", SHOPIFY_SECRET)
    .update(body, "utf8")
    .digest("base64");
  return hmacHeader === hash;
}

// ====== GENERATE CAPTION & HASHTAGS (GPT-4o) ======
async function generateCaption(product) {
  const prompt = `
  Create a bilingual (Arabic + English) caption and 10 hashtags about this product.
  Keep it engaging and marketing-oriented.
  Product:
  Name: ${product.title}
  Description: ${product.body_html}
  URL: ${process.env.SHOP_URL}/products/${product.handle}
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

// ====== POST TO INSTAGRAM (Cross-post to Facebook automatically) ======
async function postToMeta(product, caption, imageUrl) {
  // Step 1: Create container on IG
  const igContainer = await axios.post(
    `https://graph.facebook.com/v21.0/${META_IG_ID}/media`,
    {
      image_url: imageUrl,
      caption: caption,
      access_token: META_ACCESS_TOKEN,
      crossposted_to_page_id: "me", // يربط النشر تلقائيًا مع الصفحة
    }
  );

  // Step 2: Publish container
  const creationId = igContainer.data.id;
  await axios.post(
    `https://graph.facebook.com/v21.0/${META_IG_ID}/media_publish`,
    {
      creation_id: creationId,
      access_token: META_ACCESS_TOKEN,
    }
  );
  console.log(`✅ Published ${product.title} to IG+FB cross-post`);
}

// ====== CREATE / UPDATE / DELETE HANDLERS ======
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

  // فقط المنتجات النشطة يتم تحديثها
  if (product.status === "active") {
    const caption = await generateCaption(product);
    const imageUrl = product.image?.src || product.images[0]?.src;
    await postToMeta(product, caption, imageUrl);
  } else {
    console.log(`🟡 Product ${product.title} status = ${product.status}`);
  }
  res.sendStatus(200);
});

app.post("/webhook/product-delete", async (req, res) => {
  if (!verifyShopify(req)) return res.sendStatus(401);
  console.log("🗑️ Product deleted:", req.body.id);
  // يمكنك حفظ post_id سابقًا لحذفه من Meta
  res.sendStatus(200);
});

// ====== TEST ROUTE ======
app.get("/", (req, res) => {
  res.send("🚀 eSelect Cross-Posting system is live!");
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`✅ Server running on port ${process.env.PORT || 3000}`)
);
