/**
 * eSelect Meta Sync v9.2.0 - Instagram API Compliance Fix
 * By Gemini: Corrected the media upload process to comply with Instagram's specific requirements
 * for single vs. carousel posts, fixing the 'undefined' ID error.
 */

import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();
const app = express();

app.use(express.json({
    limit: '10mb',
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

// ==================== HYBRID SYSTEM (DEBOUNCE + QUEUE + COOL-DOWN) ====================
const pendingProducts = new Map();
const publishQueue = [];
let isProcessingQueue = false;

const DEBOUNCE_DELAY = 60 * 1000;
const COOL_DOWN_PERIOD = 3 * 60 * 1000;
const PUBLISH_INTERVAL = 3 * 60 * 1000;

const log = (prefix, message, color = "\x1b[36m") => {
    const reset = "\x1b[0m";
    console.log(`${color}${prefix}${reset} ${message}`);
};

// ==================== HELPERS ====================
function verifyHmac(req) {
    const hmac = req.headers["x-shopify-hmac-sha256"];
    if (!hmac) return false;
    const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
    try {
        return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
    } catch {
        return false;
    }
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
        return `${product.title}\n\n${cleanText(product.body_html)}`;
    }
}

// ==================== CORE PUBLISHING LOGIC (REBUILT) ====================
async function publishProductToMeta(product) {
    if (!product.images || product.images.length === 0) {
        log("[⚠️]", `Skipping "${product.title}" - no images found.`, "\x1b[33m");
        return;
    }

    try {
        log("[🚀]", `Publishing "${product.title}" from queue...`, "\x1b[35m");
        const caption = await generateCaption(product);
        const imageUrls = product.images.slice(0, 10).map(img => img.src);
        let finalContainerId;

        // --- Logic for multiple images (Carousel) ---
        if (imageUrls.length > 1) {
            log("[🖼️]", `Processing ${imageUrls.length} images for a carousel post...`);
            const mediaIds = [];
            for (const url of imageUrls) {
                // Step 1: Upload each image as a carousel item
                const res = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
                    image_url: url,
                    is_carousel_item: true, // <-- THIS IS THE CRITICAL FIX
                    access_token: META_ACCESS_TOKEN
                });
                if (res.data && res.data.id) {
                    mediaIds.push(res.data.id);
                } else {
                    throw new Error("Failed to get a media ID for a carousel item.");
                }
            }

            // Step 2: Create the main carousel container
            const carouselRes = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
                media_type: 'CAROUSEL',
                children: mediaIds,
                caption: caption,
                access_token: META_ACCESS_TOKEN
            });
            finalContainerId = carouselRes.data.id;
        }
        // --- Logic for a single image ---
        else {
            log("[🖼️]", "Processing a single image post...");
            // For a single image, create the container with the caption in one step
            const res = await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media`, {
                image_url: imageUrls[0],
                caption: caption,
                access_token: META_ACCESS_TOKEN
            });
            finalContainerId = res.data.id;
        }

        if (!finalContainerId) {
            throw new Error("Could not create the final media container.");
        }

        // Step 3: Publish the final container
        log("[📤]", `Publishing container ID: ${finalContainerId}`);
        await axios.post(`${META_GRAPH_URL}/${META_IG_ID}/media_publish`, {
            creation_id: finalContainerId,
            access_token: META_ACCESS_TOKEN
        });
        log("[✅]", `Successfully published "${product.title}" to Instagram!`, "\x1b[32m");

        // Optional: Facebook Post
        if (SYNC_TO_FACEBOOK) { /* ... Your Facebook logic ... */ }

    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        log("[❌]", `Failed to publish "${product.title}": ${msg}`, "\x1b[31m");
    }
}


// ==================== QUEUE PROCESSOR ====================
async function processQueue() {
    if (isProcessingQueue || publishQueue.length === 0) return;
    isProcessingQueue = true;

    log("[⚙️]", `Processing queue. Items: ${publishQueue.length}. Next post in ${PUBLISH_INTERVAL / 1000 / 60} minutes.`);
    const product = publishQueue.shift();
    await publishProductToMeta(product);

    setTimeout(() => {
        isProcessingQueue = false;
        processQueue();
    }, PUBLISH_INTERVAL);
}

// ==================== WEBHOOK HANDLER (The Brain) ====================
function handleProductWebhook(product) {
    if (!product || !product.status) {
        log("[⚠️]", "Received an incomplete or invalid webhook payload. Skipping.", "\x1b[33m");
        return;
    }
    
    if (product.status !== 'active') {
        log("[🟡]", `Skipping product "${product.title}" with status: ${product.status}`, "\x1b[33m");
        return;
    }

    if (pendingProducts.has(product.id)) {
        clearTimeout(pendingProducts.get(product.id).timer);
        log("[🔄]", `Debounce timer reset for "${product.title}". Waiting for final update...`);
    } else {
        log("[🆕]", `New event for "${product.title}". Starting debounce timer...`);
    }

    const timer = setTimeout(() => {
        const latestProductData = pendingProducts.get(product.id)?.product || product;
        log("[⏰]", `Debounce timer finished for "${latestProductData.title}".`);
        pendingProducts.delete(product.id);

        log("[🧊]", `ENTERING MANDATORY COOL-DOWN PERIOD of ${COOL_DOWN_PERIOD / 1000 / 60} minutes before queuing.`, "\x1b[96m");

        setTimeout(() => {
            log("[✅]", `Cool-down finished. Adding "${latestProductData.title}" to publish queue.`, "\x1b[32m");
            publishQueue.push(latestProductData);
            processQueue();
        }, COOL_DOWN_PERIOD);

    }, DEBOUNCE_DELAY);

    pendingProducts.set(product.id, { timer, product });
}

app.post("/webhook/product-create", (req, res) => { res.sendStatus(200); handleProductWebhook(req.body); });
app.post("/webhook/product-update", (req, res) => { res.sendStatus(200); handleProductWebhook(req.body); });

app.get("/", (_, res) => res.send(`🚀 eSelect Meta Sync v9.2 - API Fix Active. Queue size: ${publishQueue.length}`));
app.listen(PORT, () => log("[✅]", `Server running on port ${PORT}`, "\x1b[32m"));
