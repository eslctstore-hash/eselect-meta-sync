// shopify.js
const crypto = require('crypto');
const { 
    createPost, 
    updateInstagramPostCaption // لم نعد بحاجة لدالة الإخفاء
} = require('./meta');
const axios = require('axios');
const { readDb } = require('./meta');

const getShopifyProductById = async (productId) => {
    const url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2024-04/products/${productId}.json`;
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

const productCreateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT CREATE.');
    const partialProduct = JSON.parse(req.body.toString());
    const productId = partialProduct.id;
    if (partialProduct.status !== 'active') {
        return res.status(200).send('Skipped non-active product.');
    }
    console.log(`Scheduling post for "${partialProduct.title}" (ID: ${productId}) in 2 minutes.`);
    setTimeout(async () => {
        const fullProduct = await getShopifyProductById(productId);
        if (fullProduct) {
            console.log(`Processing post for product: ${fullProduct.title}`);
            createPost(fullProduct);
        }
    }, 2 * 60 * 1000);
    res.status(200).send('Webhook received and scheduled.');
};

// ==========================================================
// ============== معالج تحديث المنتج (مُعدَّل) ===============
// ==========================================================
const productUpdateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT UPDATE.');
    
    const updatedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === updatedProduct.id);

    if (!existingPost || !existingPost.instagramPostId) {
        return res.status(200).send('No post to update.');
    }

    let statusText = '';
    // توحيد الرسالة لحالتي draft و archived
    if (updatedProduct.status === 'archived' || updatedProduct.status === 'draft') {
        statusText = '(حالياً هذا المنتج غير متوفر مؤقتاً)\n';
    }

    const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${updatedProduct.handle}`;
    const newCaption = `${statusText}${updatedProduct.title}\n\n${updatedProduct.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}`;
    
    // نستدعي نفس الدالة لتحديث النص في كل الحالات
    await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);

    res.status(200).send('Webhook for update processed.');
};

// ==========================================================
// ============== معالج حذف المنتج (مُعدَّل) =================
// ==========================================================
const productDeleteWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT DELETE.');

    const deletedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === deletedProduct.id);

    if (existingPost && existingPost.instagramPostId) {
        // بدلاً من الإخفاء، سنقوم بتحديث النص
        const newCaption = `${existingPost.productTitle}\n\n(عفواً هذا المنتج لم يعد متوفراً ، تجد منتجات مشابهة في حسابنا او الانتقال الى رابط المتجر www.eselect.store)`;
        await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);
    }

    res.status(200).send('Webhook for delete processed.');
};

const getActiveShopifyProducts = async () => {
    // ... الكود هنا لم يتغير ...
};

module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts 
};
