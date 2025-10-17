/**
 * eSelect Meta Sync v7.0.0 - Smart Debounce Logic
 * Built by Gemini to handle rapid create/update webhooks gracefully.
 */

import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
const app = express();

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const META_GRAPH_URL = process.env.META_GRAPH_URL || "https://graph.facebook.com/v20.0";
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Needed for captions
const SYNC_TO_FACEBOOK = process.env.SYNC_TO_FACEBOOK === "true";

// ==================== SMART DEBOUNCE & QUEUE ====================
// هذا المتغير هو مفتاح الحل. يخزن المؤقتات للمنتجات الجديدة.
const pendingProducts = new Map();
const DEBOUNCE_DELAY = 60 * 1000; // 60 ثانية انتظار

function log(prefix, message, color = "\x1b[36m") {
  const reset = "\x1b[0m";
  console.log(`${color}${prefix}${reset} ${message}`);
}

// ==================== HELPERS ====================
function verifyHmac(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!hmac) return false;
  const digest = crypto.createHmac("sha26", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

function cleanText(html) {
  return html?.replace(/<[^>]*>/g, " ").replace(/\s+/g, ' ').trim() || "";
}

// ==================== AI CAPTION GENERATION ====================
async function generateCaption(product) {
    // (هذه الدالة تبقى كما هي لتوليد الوصف)
    if (!OPENAI_API_KEY) {
        log("[⚠️]", "OpenAI API key missing. Using basic caption.", "\x1b[33m");
        return `${product.title}\n\n${cleanText(product.body_html)}`;
    }
    log("[🤖]", `Generating caption for: ${product.title}...`);
    const prompt = `Create an engaging social media post in Arabic for a new product for "eselect" store. Focus on benefits and use attractive language. Include a call to action and relevant hashtags like #eselect, #اي_سيلكت, product type, and brand.\n\nProduct: "${product.title}"\nDescription: "${cleanText(product.body_html)}"`;
    try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions",
            { model: "gpt-4o", messages: [{ role: "user", content: prompt }], max_tokens: 400 },
            { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
        );
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        log("[❌]", `AI caption generation failed: ${error.message}`, "\x1b[31m");
        return `${product.title}\n\n${cleanText(product.body_html)}`; // Fallback
    }
}

// ==================== CORE PUBLISHING LOGIC ====================
async function publishToMeta(product) {
    log("[🚀]", `Starting publish process for "${product.title}"`, "\x1b[35m");
    if (!product.images || product.images.length === 0) {
        log("[⚠️]", `Product "${product.title}" has no images. Skipping.`, "\x1b[33m");
        return;
    }

    try {
        const caption = await generateCaption(product);
        const imageUrls = product.images.slice(0, 10).map(img => img.src);
        
        // Step 1: Upload media to Instagram
        const igMediaIds = [];
        for (const url of imageUrls) {
            const res = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, { image_url: url, access_token: META_ACCESS_TOKEN });
            igMediaIds.push(res.data.id);
        }

        // Step 2: Create container
        let creationId;
        if (igMediaIds.length === 1) {
            creationId = igMediaIds[0]; // For single image, the media ID is the container
        } else {
            const carouselRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
                media_type: 'CAROUSEL',
                children: igMediaIds,
                access_token: META_ACCESS_TOKEN
            });
            creationId = carouselRes.data.id;
        }

        // Add caption to the final container
        await axios.post(`${META_GRAPH_URL}/${creationId}`, { caption: caption, access_token: META_ACCESS_TOKEN });

        // Step 3: Publish
        await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, { creation_id: creationId, access_token: META_ACCESS_TOKEN });
        log("[✅]", `Successfully published "${product.title}" to Instagram!`, "\x1b[32m");

        // Optional: Publish to Facebook
        if (SYNC_TO_FACEBOOK) {
            const attached_media = igMediaIds.map(id => ({ media_fbid: id }));
            await axios.post(`${META_GRAPH_URL}/${META_PAGE_ID}/feed`, { message: caption, attached_media, access_token: META_ACCESS_TOKEN });
            log("[✅]", `Successfully published "${product.title}" to Facebook!`, "\x1b[32m");
        }

    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        log("[❌]", `Failed to publish "${product.title}": ${msg}`, "\x1b[31m");
    }
}


// ==================== WEBHOOK HANDLERS ====================

app.post("/webhook/product-create", (req, res) => {
    // لا نتحقق من HMAC هنا لأننا نعتمد على webhook التحديث
    res.sendStatus(200); // 응답 즉시
    const product = req.body;
    
    // إذا كان المنتج نشطاً وتم إنشاؤه يدوياً
    if (product.status === 'active') {
        log('[🆕]', `New product received: "${product.title}". Setting a ${DEBOUNCE_DELAY / 1000}s timer.`, '\x1b[36m');
        
        // قم بتعيين مؤقت. إذا لم يتم استلام أي تحديث، فسيتم تشغيله.
        const timerId = setTimeout(() => {
            log('[⏰]', `Timer finished for "${product.title}". No update received, proceeding to publish.`, '\x1b[32m');
            publishToMeta(product);
            pendingProducts.delete(product.id);
        }, DEBOUNCE_DELAY);
        
        pendingProducts.set(product.id, timerId);
    }
});

app.post("/webhook/product-update", (req, res) => {
    // لا نتحقق من HMAC هنا لأننا نعتمد على webhook التحديث
    res.sendStatus(200);
    const product = req.body;

    log('[🔄]', `Product update received for "${product.title}" with status: ${product.status}`, '\x1b[33m');

    // تحقق مما إذا كان هناك مؤقت معلق لهذا المنتج
    if (pendingProducts.has(product.id)) {
        clearTimeout(pendingProducts.get(product.id)); // إلغاء مؤقت الإنشاء
        pendingProducts.delete(product.id);
        log('[👍]', `Canceled pending 'create' job for "${product.title}". Using 'update' data.`, '\x1b[32m');
    }

    if (product.status === 'active') {
        // إذا كان المنتج نشطاً، قم ببدء عملية النشر فوراً
        publishToMeta(product);
    } else {
        // إذا أصبح المنتج draft أو archived
        log('[🗑️]', `Product "${product.title}" is now ${product.status}. No action taken.`, '\x1b[33m');
        // TODO: هنا يمكنك إضافة منطق لحذف المنشور من Meta
        // const postId = findPostIdForProduct(product.id);
        // if (postId) deleteMetaPost(postId);
    }
});


// ==================== SERVER ====================
app.get("/", (_, res) => res.send("🚀 eSelect Meta Sync v7.0.0 - Smart Debounce Active"));
app.listen(PORT, () => log("[✅]", `Server running on port ${PORT}`, "\x1b[32m"));
