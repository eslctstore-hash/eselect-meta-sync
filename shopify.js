// shopify.js
const crypto = require('crypto');
const { 
    createPost, 
    updateInstagramPostCaption, // جديد
    hideInstagramPost           // جديد
} = require('./meta');
const axios = require('axios');
const { readDb } = require('./meta');

// ... (دالة getShopifyProductById تبقى كما هي)
const getShopifyProductById = async (productId) => {
    // ... الكود هنا لم يتغير
};

const verifyShopifyWebhook = (req) => {
    // ... الكود هنا لم يتغير
};

// ## معالج إنشاء المنتج (تم تعديله قليلاً) ##
const productCreateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
        console.warn('Webhook verification failed!');
        return res.status(401).send('Unauthorized');
    }
    console.log('Webhook received for PRODUCT CREATE.');
    const partialProduct = JSON.parse(req.body.toString());
    // ... باقي الكود لم يتغير
};

// ==========================================================
// ============== معالج تحديث المنتج (جديد) ===================
// ==========================================================
const productUpdateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
        return res.status(401).send('Unauthorized');
    }
    console.log('Webhook received for PRODUCT UPDATE.');
    
    const updatedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === updatedProduct.id);

    if (!existingPost || !existingPost.instagramPostId) {
        console.log(`No existing post found for updated product ${updatedProduct.id}. Skipping.`);
        return res.status(200).send('No post to update.');
    }

    let statusText = '';
    if (updatedProduct.status === 'archived') {
        statusText = '(المخزون غير متوفر حالياً)\n';
    } else if (updatedProduct.status === 'draft') {
        statusText = '(المنتج غير متوفر مؤقتاً)\n';
    }

    const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${updatedProduct.handle}`;
    const newCaption = `${statusText}${updatedProduct.title}\n\n${updatedProduct.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}`;
    
    await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);

    res.status(200).send('Webhook for update processed.');
};

// ==========================================================
// ============== معالج حذف المنتج (جديد) ====================
// ==========================================================
const productDeleteWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
        return res.status(401).send('Unauthorized');
    }
    console.log('Webhook received for PRODUCT DELETE.');

    const deletedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === deletedProduct.id);

    if (existingPost && existingPost.instagramPostId) {
        await hideInstagramPost(existingPost.instagramPostId);
    }

    res.status(200).send('Webhook for delete processed.');
};

// ... (دالة getActiveShopifyProducts تبقى كما هي)

module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts 
};
