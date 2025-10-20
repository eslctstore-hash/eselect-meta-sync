// shopify.js
const crypto = require('crypto');
const axios = require('axios');
const { 
    createPost, 
    updateInstagramPostCaption,
    readDb,
    writeDb
} = require('./meta');

const getShopifyProductById = async (productId) => { /* ... no change ... */ };
const verifyShopifyWebhook = (req) => { /* ... no change ... */ };

// ==========================================================
// ============== دالة جلب المنتجات (مُحسَّنة) ===============
// ==========================================================
const getActiveShopifyProducts = async () => {
    let allProducts = [];
    let url = `https://${process.env.SHOPIFY_SHOP_URL}/admin/api/2024-04/products.json?status=active&limit=250`;

    try {
        while (url) {
            const response = await axios.get(url, {
                headers: {
                    'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                },
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
        // **هذا هو التعديل المهم**
        console.error('❌ Error fetching Shopify products with pagination.');
        if (error.response) {
            // إذا كان الخطأ من API Shopify، اطبع التفاصيل
            console.error('Error Details from Shopify API:', JSON.stringify(error.response.data, null, 2));
        } else {
            // وإلا، اطبع الخطأ العام
            console.error('General Error:', error.message);
        }
        return null; // إرجاع null للإشارة إلى فشل العملية
    }
};

const productCreateWebhookHandler = async (req, res) => { /* ... no change ... */ };
const productUpdateWebhookHandler = async (req, res) => { /* ... no change ... */ };
const productDeleteWebhookHandler = async (req, res) => { /* ... no change ... */ };

module.exports = { 
    productCreateWebhookHandler, 
    productUpdateWebhookHandler, 
    productDeleteWebhookHandler,
    getActiveShopifyProducts 
};
