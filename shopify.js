// shopify.js (النسخة المصححة)
const crypto = require('crypto');
const { createPost } = require('./meta');
const axios = require('axios');

// دالة للتحقق من صحة Webhook القادم من Shopify
const verifyShopifyWebhook = (req) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body; // هنا الـ raw body (Buffer)
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    if (!hmac || !body || !secret) {
        return false;
    }

    const hash = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8', 'hex')
        .digest('base64');
    
    return hmac === hash;
};

const productCreateWebhookHandler = async (req, res) => {
    // تفعيل التحقق الأمني - مهم جدًا
    if (!verifyShopifyWebhook(req)) {
        console.warn('Webhook verification failed! Request might be fraudulent.');
        return res.status(401).send('Unauthorized');
    }

    console.log('Webhook received and verified successfully.');
    
    // تحويل البيانات الخام (Buffer) إلى نص ثم إلى كائن JSON
    const product = JSON.parse(req.body.toString());

    // تأكد أن المنتج فعال (active)
    if (product.status !== 'active') {
        console.log(`Product "${product.title}" is not active. Skipping.`);
        return res.status(200).send('Skipped non-active product.');
    }
    
    // تأجيل النشر لمدة دقيقتين
    console.log(`Scheduling post for "${product.title}" in 2 minutes.`);
    setTimeout(() => {
        console.log(`Processing post for product ID: ${product.id}`);
        createPost(product);
    }, 2 * 60 * 1000); // 2 minutes

    res.status(200).send('Webhook received and scheduled.');
};

// دالة لجلب كل المنتجات الفعالة من Shopify
const getActiveShopifyProducts = async () => {
    const url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2023-10/products.json?status=active`;
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
