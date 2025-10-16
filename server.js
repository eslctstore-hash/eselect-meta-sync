import express from "express";
import crypto from "crypto";
import axios from "axios";
import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import cron from "node-cron";
dotenv.config();

const app = express();
app.use(express.json({ limit: "10mb" }));

// ====== ENV VARIABLES ======
const {
  PORT,
  SHOPIFY_SECRET,
  META_GRAPH_URL,
  META_IG_BUSINESS_ID,
  META_PAGE_ID,
  META_ACCESS_TOKEN,
  OPENAI_API_KEY,
  SHOP_URL
} = process.env;

const SYNC_FILE = "./sync.json";

// ====== LOGGING ======
const log = {
  info: (msg) => console.log(chalk.blue(`[ℹ️] ${msg}`)),
  success: (msg) => console.log(chalk.green(`[✅] ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`[⚠️] ${msg}`)),
  error: (msg) => console.log(chalk.red(`[❌] ${msg}`)),
};

// ====== HELPER: LOAD / SAVE SYNC FILE ======
function loadSyncData() {
  try {
    return JSON.parse(fs.readFileSync(SYNC_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveSyncData(data) {
  fs.writeFileSync(SYNC_FILE, JSON.stringify(data, null, 2));
}

// ====== VERIFY SHOPIFY WEBHOOK ======
function verifyShopify(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const body = JSON.stringify(req.body);
  const hash = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body, "utf8").digest("base64");
  return hash === hmacHeader;
}

// ====== GENERATE CAPTION ======
async function generateCaption(title, desc, link) {
  try {
    const prompt = `
اكتب وصفًا تسويقيًا احترافيًا لمنشور إنستجرام عن منتج بعنوان "${title}" من متجر إلكتروني عماني eSelect | إي سيلكت.
تضمّن 7 هاشتاقات مناسبة بالعربية والإنجليزية.
الوصف: ${desc}
رابط الشراء: ${link}
`;
    const res = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.8 },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    return res.data.choices[0].message.content.trim();
  } catch {
    return `${title}\n🔗 ${link}`;
  }
}

// ====== META OPERATIONS ======
async function publishInstagramCarousel(images, caption) {
  const childIds = [];
  for (const img of images.slice(0, 10)) {
    const res = await axios.post(`${META_GRAPH_URL}/${META_IG_BUSINESS_ID}/media`, {
      image_url: img,
      is_carousel_item: true,
      access_token: META_ACCESS_TOKEN,
    });
    childIds.push(res.data.id);
  }

  const parent = await axios.post(`${META_GRAPH_URL}/${META_IG_BUSINESS_ID}/media`, {
    caption,
    children: childIds,
    media_type: "CAROUSEL",
    access_token: META_ACCESS_TOKEN,
  });

  await axios.post(`${META_GRAPH_URL}/${META_IG_BUSINESS_ID}/media_publish`, {
    creation_id: parent.data.id,
    access_token: META_ACCESS_TOKEN,
  });
  return parent.data.id;
}

async function deleteInstagramPost(postId) {
  try {
    await axios.delete(`${META_GRAPH_URL}/${postId}?access_token=${META_ACCESS_TOKEN}`);
    log.success(`🗑️ Deleted Instagram post: ${postId}`);
  } catch (e) {
    log.warn(`⚠️ Failed to delete Instagram post: ${postId}`);
  }
}

// ====== HANDLE PRODUCT EVENTS ======
async function handleProduct(product, action = "create") {
  const data = loadSyncData();
  const id = product.id.toString();
  const images = product.images.map((i) => i.src);
  const status = product.status;
  const link = `${SHOP_URL}/products/${product.handle}`;
  const caption = await generateCaption(product.title, product.body_html, link);

  // Deleted or Draft
  if (status === "draft" || status === "archived" || action === "delete") {
    if (data[id]?.ig_post_id) await deleteInstagramPost(data[id].ig_post_id);
    delete data[id];
    saveSyncData(data);
    log.warn(`🚫 Removed product [${product.title}] from Meta platforms.`);
    return;
  }

  // New Product
  if (!data[id]) {
    const igPostId = await publishInstagramCarousel(images, caption);
    data[id] = { ig_post_id: igPostId, status };
    saveSyncData(data);
    log.success(`✅ Posted new product: ${product.title}`);
  } else {
    // Update existing post
    await deleteInstagramPost(data[id].ig_post_id);
    const igPostId = await publishInstagramCarousel(images, caption);
    data[id] = { ig_post_id: igPostId, status };
    saveSyncData(data);
    log.info(`🔁 Updated product: ${product.title}`);
  }
}

// ====== WEBHOOK ROUTES ======
app.post("/webhook/product-created", async (req, res) => {
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  await handleProduct(req.body, "create");
  res.send("ok");
});
app.post("/webhook/product-updated", async (req, res) => {
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  await handleProduct(req.body, "update");
  res.send("ok");
});
app.post("/webhook/product-deleted", async (req, res) => {
  if (!verifyShopify(req)) return res.status(401).send("Invalid signature");
  await handleProduct(req.body, "delete");
  res.send("ok");
});

// ====== PERIODIC FULL SYNC EVERY 6 HOURS ======
cron.schedule("0 */6 * * *", async () => {
  log.info("🔄 Running scheduled full sync from Shopify...");
  try {
    const products = await axios.get(`${SHOP_URL}/admin/api/2024-10/products.json`, {
      headers: {
        "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN,
      },
    });
    for (const product of products.data.products) {
      await handleProduct(product, "sync");
    }
    log.success("✅ Full sync completed successfully.");
  } catch (err) {
    log.error("❌ Failed full sync: " + err.message);
  }
});

// ====== SERVER START ======
app.get("/", (req, res) => res.send("🚀 eSelect Meta Sync v2 running"));
app.listen(PORT || 3000, () => {
  log.success(`Server running on port ${PORT}`);
});
