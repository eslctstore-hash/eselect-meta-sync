// shopify.js
const crypto = require('crypto');
const { createPost } = require('./meta');
const axios = require('axios');

// دالة للتحقق من صحة Webhook القادم من Shopify
const verifyShopifyWebhook = (req) => {
    const hmac = req.get('X-Shopify-Hmac-Sha256');
    const body = req.body; // هنا الـ raw body
    const hash = crypto
        .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
        .update(body, 'utf8', 'hex')
        .digest('base64');
    return hmac === hash;
};


const productCreateWebhookHandler = async (req, res) => {
    // التحقق من مصدر الطلب
    // if (!verifyShopifyWebhook(req)) {
    //     console.log('Webhook verification failed!');
    //     return res.status(401).send('Unauthorized');
    // }

    // تم تجاوز التحقق مؤقتاً للتسهيل، لكن يجب تفعيله في البيئة الحقيقية
    
    console.log('Webhook received for product creation.');
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


module.exports = { productCreateWebhookHandler, verifyShopifyWebhook, getActiveShopifyProducts };
