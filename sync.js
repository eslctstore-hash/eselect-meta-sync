// sync.js
const cron = require('node-cron');
const { getActiveShopifyProducts } = require('../shopify'); // تأكد من صحة المسار
const { createPost, readDb } = require('./meta');

const scheduleDailySync = () => {
    console.log('Daily sync is scheduled to run at 3:00 AM (Asia/Muscat).');
    cron.schedule('0 3 * * *', () => {
        console.log('CRON JOB: Starting scheduled daily product sync...');
        syncProducts();
    }, {
        scheduled: true,
        timezone: "Asia/Muscat"
    });
};

const syncProducts = async () => {
    console.log('SYNC LOG: Starting product synchronization...');
    
    console.log('SYNC LOG: Fetching active products from Shopify...');
    const shopifyProducts = await getActiveShopifyProducts();
    if (!shopifyProducts) {
        console.error('SYNC LOG: Failed to fetch products from Shopify. Aborting sync.');
        return;
    }
    console.log(`SYNC LOG: Found ${shopifyProducts.length} active products in Shopify.`);

    console.log('SYNC LOG: Reading local database...');
    const db = readDb();
    console.log(`SYNC LOG: Found ${db.length} posted products in the local database.`);

    const productsToPost = [];
    for (const product of shopifyProducts) {
        const isAlreadyPosted = db.some(p => p.shopifyProductId === product.id);
        if (!isAlreadyPosted) {
            productsToPost.push(product);
        }
    }

    if (productsToPost.length === 0) {
        console.log('SYNC LOG: All active products are already posted. No new products to sync.');
    } else {
        console.log(`SYNC LOG: Found ${productsToPost.length} new products to post.`);
        for (const product of productsToPost) {
            console.log(`SYNC LOG: Now posting product -> "${product.title}" (ID: ${product.id})`);
            await createPost(product);
            // إضافة تأخير بسيط بين كل منشور لتجنب تجاوز الحدود بسرعة
            await new Promise(resolve => setTimeout(resolve, 15000)); // 15 ثانية تأخير
        }
    }

    console.log('SYNC LOG: Synchronization process finished.');
};

// لا تنس تصدير الدالة الجديدة
module.exports = { scheduleDailySync, syncProducts };
