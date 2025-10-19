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
    let allProducts = [];
    let url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2024-04/products.json?status=active&limit=250`;

    try {
        while (url) {
            const response = await axios.get(url, {
                headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
            });
            allProducts = allProducts.concat(response.data.products);
            const linkHeader = response.headers.link;
            url = null;
            if (linkHeader) {
                const links = linkHeader.split(',');
                const nextLink = links.find(link => link.includes('rel="next"'));
                if (nextLink) {
                    url = nextLink.substring(nextLink.indexOf('<') + 1, nextLink.indexOf('>'));
                }
            }
        }
        return allProducts;
    } catch (error) {
        console.error('Error fetching Shopify products with pagination:', error.message);
        return null;
    }
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
            await createPost(fullProduct);
        }
    }, 2 * 60 * 1000);
    res.status(200).send('Webhook received and scheduled.');
};

const productUpdateWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT UPDATE.');
    const updatedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === updatedProduct.id);

    if (existingPost && existingPost.instagramPostId) {
        let statusText = '';
        if (updatedProduct.status === 'archived' || updatedProduct.status === 'draft') {
            statusText = '(حالياً هذا المنتج غير متوفر مؤقتاً)\n';
        }
        const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${updatedProduct.handle}`;
        const newCaption = `${statusText}${updatedProduct.title}\n\n${updatedProduct.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}`;
        await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);
    } else if (!existingPost && updatedProduct.status === 'active') {
        console.log(`Product ${updatedProduct.id} is now active and was not posted before. Creating a new post.`);
        await createPost(updatedProduct);
    }
    res.status(200).send('Webhook for update processed.');
};

const productDeleteWebhookHandler = async (req, res) => {
    if (!verifyShopifyWebhook(req)) { return res.status(401).send('Unauthorized'); }
    console.log('Webhook received for PRODUCT DELETE.');
    const deletedProduct = JSON.parse(req.body.toString());
    const db = readDb();
    const existingPost = db.find(p => p.shopifyProductId === deletedProduct.id);
    if (existingPost && existingPost.instagramPostId) {
        const newCaption = `${existingPost.productTitle}\n\n(عفواً هذا المنتج لم يعد متوفراً ، تجد منتجات مشابهة في حسابنا او الانتقال الى رابط المتجر www.eselect.store)`;
        await updateInstagramPostCaption(existingPost.instagramPostId, newCaption);
    }
    res.status(200).send('Webhook for delete processed.');
};

// ==========================================
// ==============   التصحيح هنا   ==============
// ==========================================
module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts 
};
