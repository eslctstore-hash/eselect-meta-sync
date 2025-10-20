// shopify.js
const crypto = require('crypto');
const axios = require('axios');
const { 
    createPost, 
    updateInstagramPostCaption,
    readDb,
    writeDb // استيراد دالة الكتابة
} = require('./meta');

// ... (getShopifyProductById, verifyShopifyWebhook, getActiveShopifyProducts لم تتغير)
const getShopifyProductById = async (productId) => { /* ... no change ... */ };
const verifyShopifyWebhook = (req) => { /* ... no change ... */ };
const getActiveShopifyProducts = async () => { /* ... no change ... */ };

// ==========================================================
// ============== معالج إنشاء المنتج (مُعاد كتابته) ============
// ==========================================================
const productCreateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT CREATE.');
    
    const partialProduct = JSON.parse(req.body.toString());
    const productId = partialProduct.id;
    const db = readDb();

    // الخطوة 1: التحقق إذا كان المنتج مسجلاً بالفعل (سواء pending أو active)
    const existingEntry = db.find(p => p.shopifyProductId === productId);
    if (existingEntry) {
        console.log(`Duplicate webhook for product ${productId}. Ignoring.`);
        return res.status(200).send('Duplicate webhook ignored.');
    }

    if (partialProduct.status !== 'active') {
        return res.status(200).send('Skipped non-active product.');
    }

    // الخطوة 2: "قفل" المنتج فورًا بتسجيله كـ "pending"
    console.log(`Locking product ${productId} as 'pending' before scheduling.`);
    db.push({
        shopifyProductId: productId,
        instagramPostId: null,
        productTitle: partialProduct.title,
        status: 'pending' // حالة مؤقتة
    });
    writeDb(db);

    // الخطوة 3: جدولة النشر
    console.log(`Scheduling post for "${partialProduct.title}" (ID: ${productId}) in 2 minutes.`);
    setTimeout(async () => {
        const fullProduct = await getShopifyProductById(productId);
        if (fullProduct) {
            console.log(`Processing post for product: ${fullProduct.title}`);
            await createPost(fullProduct); // createPost ستقوم بتحديث الحالة إلى 'active'
        }
    }, 2 * 60 * 1000);

    res.status(200).send('Webhook received, locked, and scheduled.');
};


const productUpdateWebhookHandler = async (req, res) => {
    // ... no change ...
};

const productDeleteWebhookHandler = async (req, res) => {
    // ... no change ...
};

module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts 
};
