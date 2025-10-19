// shopify.js
const crypto = require('crypto');
const axios = require('axios');
const { 
    createPost, 
    updateInstagramPostCaption,
    readDb
} = require('./meta');

// ... (getShopifyProductById, verifyShopifyWebhook, getActiveShopifyProducts لم تتغير)
const getShopifyProductById = async (productId) => { /* ... no change ... */ };
const verifyShopifyWebhook = (req) => { /* ... no change ... */ };
const getActiveShopifyProducts = async () => { /* ... no change ... */ };


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
            await createPost(fullProduct); // أضفنا await هنا احتياطياً لضمان التسلسل
        }
    }, 2 * 60 * 1000);
    res.status(200).send('Webhook received and scheduled.');
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

    if (existingPost && existingPost.instagramPostId) {
        console.log(`Found existing post for product ${updatedProduct.id}. Updating caption...`);
        let statusText = '';
        if (updatedProduct.status === 'archived' || updatedProduct.status === 'draft') {
            statusText = '(حالياً هذا المنتج غير متوفر مؤقتاً)\n';
        }
        const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${updatedProduct.handle}`;
        const newCaption = `${statusText}${updatedProduct.title}\n\n${updatedProduct.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}`;
        await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);
    } else if (!existingPost && updatedProduct.status === 'active') {
        console.log(`Product ${updatedProduct.id} is now active and was not posted before. Creating a new post.`);
        // **تمت إضافة await هنا لإصلاح الخلل البرمجي**
        await createPost(updatedProduct);
    } else {
        console.log(`Skipping update for product ${updatedProduct.id} with status '${updatedProduct.status}'.`);
    }

    res.status(200).send('Webhook for update processed.');
};

const productDeleteWebhookHandler = async (req, res) => {
    // ... no change ...
};

module.deports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts 
};
