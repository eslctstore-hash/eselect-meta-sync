/**
 * eSelect Meta Sync v8.0.1 - Hotfix for Initialization Error
 * By Gemini: Engineered to handle complex webhook scenarios (single-product race conditions & multi-product floods)
 * This is the definitive solution.
 */

import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
const app = express();

app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));

// ==================== CONFIGURATION ====================
const PORT = process.env.PORT || 3000;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;
const META_GRAPH_URL = process.env.META_GRAPH_URL || "https://graph.facebook.com/v20.0";
const META_IG_ID = process.env.META_IG_ID;
const META_PAGE_ID = process.env.META_PAGE_ID;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SYNC_TO_FACEBOOK = process.env.SYNC_TO_FACEBOOK === "true";

// ==================== HYBRID SYSTEM (DEBOUNCE + QUEUE) ====================
const pendingProducts = new Map(); // For Debounce logic
const publishQueue = []; // For sequential, safe publishing
let isProcessingQueue = false;

const DEBOUNCE_DELAY = 60 * 1000; // 30 ثانية انتظار للتأكد من وصول كل التحديثات
const PUBLISH_INTERVAL = 180 * 1000; // 90 ثانية فاصل بين كل عملية نشر

const log = (prefix, message, color = "\x1b[36m") => {
    const reset = "\x1b[0m"; // <-- تم نقل هذا السطر للأعلى (هذا هو الإصلاح)
    console.log(`${color}${prefix}${reset} ${message}`);
};

// ==================== HELPERS ====================
function verifyHmac(req) {
    const hmac = req.headers["x-shopify-hmac-sha256"];
    if (!hmac) return false;
    const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

const cleanText = (html) => html?.replace(/<[^>]*>/g, " ").replace(/\s+/g, ' ').trim() || "";

// ==================== AI CAPTION GENERATION ====================
async function generateCaption(product) {
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
async function publishProductToMeta(product) {
    if (!product.images || product.images.length === 0) {
        log("[⚠️]", `Skipping "${product.title}" - no images found.`, "\x1b[33m");
        return;
    }

    try {
        log("[🚀]", `Publishing "${product.title}" from queue...`, "\x1b[35m");
        const caption = await generateCaption(product);
        const imageUrls = product.images.slice(0, 10).map(img => img.src);
        
        const mediaIds = [];
        for (const url of imageUrls) {
            const res = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, { image_url: url, access_token: META_ACCESS_TOKEN });
            mediaIds.push(res.data.id);
        }
        
        let containerId;
        if (mediaIds.length > 1) {
            const carouselRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, { media_type: 'CAROUSEL', children: mediaIds, access_token: META_ACCESS_TOKEN });
            containerId = carouselRes.data.id;
        } else {
            containerId = mediaIds[0];
        }

        await axios.post(`${META_GRAPH_URL}/${containerId}`, { caption: caption, access_token: META_ACCESS_TOKEN });

        await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, { creation_id: containerId, access_token: META_ACCESS_TOKEN });
        log("[✅]", `Successfully published "${product.title}" to Instagram!`, "\x1b[32m");

        // Optional: Facebook Post
        if (SYNC_TO_FACEBOOK) { /* ... Facebook logic ... */ }

    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        log("[❌]", `Failed to publish "${product.title}": ${msg}`, "\x1b[31m");
    }
}

// ==================== QUEUE PROCESSOR ====================
async function processQueue() {
    if (isProcessingQueue || publishQueue.length === 0) return;
    isProcessingQueue = true;

    log("[⚙️]", `Processing queue. Items: ${publishQueue.length}. Interval: ${PUBLISH_INTERVAL / 1000}s.`);
    const product = publishQueue.shift(); // Get the next product
    await publishProductToMeta(product);

    // Wait for the interval before processing the next item
    setTimeout(() => {
        isProcessingQueue = false;
        processQueue(); // Process next item in queue
    }, PUBLISH_INTERVAL);
}

// ==================== WEBHOOK HANDLER (The Brain) ====================
function handleProductWebhook(product) {
    if (product.status !== 'active') {
        log("[🟡]", `Skipping product "${product.title}" with status: ${product.status}`, "\x1b[33m");
        return;
    }

    if (pendingProducts.has(product.id)) {
        clearTimeout(pendingProducts.get(product.id).timer);
        log("[🔄]", `Debounce timer reset for "${product.title}". Waiting for final update...`, "\x1b[36m");
    } else {
        log("[🆕]", `New event for "${product.title}". Starting debounce timer...`, "\x1b[36m");
    }

    const timer = setTimeout(() => {
        log("[⏰]", `Debounce timer finished for "${product.title}". Adding to publish queue.`, "\x1b[32m");
        publishQueue.push(product); 
        pendingProducts.delete(product.id); 
        processQueue(); 
    }, DEBOUNCE_DELAY);

    pendingProducts.set(product.id, { timer, product });
}

app.post("/webhook/product-create", (req, res) => {
    res.sendStatus(200);
    handleProductWebhook(req.body);
});

app.post("/webhook/product-update", (req, res) => {
    res.sendStatus(200);
    handleProductWebhook(req.body);
});


// ==================== SERVER ====================
app.get("/", (_, res) => res.send(`🚀 eSelect Meta Sync v8.0.1 - Hybrid (Debounce + Queue) is Active. Queue size: ${publishQueue.length}`));

app.listen(PORT, () => log("[✅]", `Server running on port ${PORT}`, "\x1b[32m"));
