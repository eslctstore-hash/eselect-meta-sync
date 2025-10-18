// shopify.js
const crypto = require('crypto');
const axios = require('axios');
const { 
    createPost, 
    updateInstagramPostCaption,
    readDb
} = require('./meta');

// ... (getShopifyProductById و verifyShopifyWebhook تبقى كما هي)
const getShopifyProductById = async (productId) => {
    // ... no change
};
const verifyShopifyWebhook = (req) => {
    // ... no change
};

const productCreateWebhookHandler = async (req, res) => {
    // ... no change
};

// ==========================================================
// ============== معالج تحديث المنتج (مُحسَّن) ===============
// ==========================================================
const productUpdateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT UPDATE.');
    
    const updatedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === updatedProduct.id);

    // **المنطق الجديد**
    if (existingPost && existingPost.instagramPostId) {
        // إذا كان المنشور موجودًا، قم بتحديثه كالمعتاد
        console.log(`Found existing post for product ${updatedProduct.id}. Updating caption...`);
        let statusText = '';
        if (updatedProduct.status === 'archived' || updatedProduct.status === 'draft') {
            statusText = '(حالياً هذا المنتج غير متوفر مؤقتاً)\n';
        }
        const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${updatedProduct.handle}`;
        const newCaption = `${statusText}${updatedProduct.title}\n\n${updatedProduct.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}`;
        await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);
    } else if (!existingPost && updatedProduct.status === 'active') {
        // إذا لم يكن المنشور موجودًا والمنتج أصبح فعالاً، قم بإنشائه كمنشور جديد
        console.log(`Product ${updatedProduct.id} is now active and was not posted before. Creating a new post.`);
        // لا نحتاج لتأخير زمني هنا لأن المنتج موجود بالفعل
        createPost(updatedProduct);
    } else {
        // تجاهل الحالات الأخرى (مثل تحديث منتج لا يزال draft)
        console.log(`Skipping update for product ${updatedProduct.id} with status '${updatedProduct.status}'.`);
    }

    res.status(200).send('Webhook for update processed.');
};

const productDeleteWebhookHandler = async (req, res) => {
    // ... no change
};

module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
};
