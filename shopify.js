// shopify.js
const crypto = require('crypto');
const axios = require('axios');
const { 
    createPost, 
    updateInstagramPostCaption,
    readDb
} = require('./meta');

const getShopifyProductById = async (productId) => {
    const url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2024-04/products/${productId}.json`;
    console.log(`Fetching full details for product ID: ${productId}`);
    try {
        const response = await axios.get(url, {
            headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
        });
        return response.data.product;
    } catch (error) {
        console.error(`Error fetching Shopify product ${productId}:`, error.message);
        return null;
    }
};

const verifyShopifyWebhook = (req) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body;
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    if (!hmac || !body || !secret) return false;
    const hash = crypto.createHmac('sha256', secret).update(body, 'utf8', 'hex').digest('base64');
    return hmac === hash;
};

const getActiveShopifyProducts = async () => {
    const url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2024-04/products.json?status=active`;
    try {
        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
        });
        return response.data.products;
    } catch (error) {
        console.error('Error fetching Shopify products:', error.message);
        return [];
    }
};

const productCreateWebhookHandler = async (req, res) => {
    // ... الكود هنا لم يتغير ...
};

const productUpdateWebhookHandler = async (req, res) => {
    // ... الكود هنا لم يتغير ...
};

const productDeleteWebhookHandler = async (req, res) => {
    // ... الكود هنا لم يتغير ...
};

// ==========================================
// ==============   التصحيح هنا   ==============
// ==========================================
module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts // تم إضافة الدالة المفقودة هنا
};
