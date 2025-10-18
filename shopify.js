// shopify.js
const crypto = require('crypto');
const { createPost } = require('./meta');
const axios = require('axios');

/**
 * Fetches the complete details for a single product from Shopify.
 * @param {string|number} productId - The ID of the Shopify product.
 * @returns {Promise<object|null>} - The full product object or null if not found.
 */
const getShopifyProductById = async (productId) => {
    const url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2024-04/products/${productId}.json`;
    console.log(`Fetching full details for product ID: ${productId}`);
    try {
        const response = await axios.get(url, {
            headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
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

    // ==========================================
    // ==============   التصحيح هنا   ==============
    // ==========================================
    const hash = crypto
        .createHmac('sha256', secret) // تم تصحيح sha265 إلى sha256
        .update(body, 'utf8', 'hex')
        .digest('base64');
    
    return hmac === hash;
};

const productCreateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) {
        console.warn('Webhook verification failed! Request might be fraudulent.');
        return res.status(401).send('Unauthorized');
    }

    console.log('Webhook received and verified successfully.');
    
    const partialProduct = JSON.parse(req.body.toString());
    const productId = partialProduct.id;

    if (partialProduct.status !== 'active') {
        console.log(`Product "${partialProduct.title}" is not active. Skipping.`);
        return res.status(200).send('Skipped non-active product.');
    }
    
    console.log(`Scheduling post for "${partialProduct.title}" (ID: ${productId}) in 2 minutes.`);
    
    setTimeout(async () => {
        const fullProduct = await getShopifyProductById(productId);

        if (!fullProduct) {
            console.error(`Could not retrieve full details for product ID ${productId}. Aborting post.`);
            return;
        }

        console.log(`Processing post for product: ${fullProduct.title}`);
        createPost(fullProduct);

    }, 2 * 60 * 1000); // 2 minutes

    res.status(200).send('Webhook received and scheduled.');
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

module.exports = { productCreateWebhookHandler, getActiveShopifyProducts };
