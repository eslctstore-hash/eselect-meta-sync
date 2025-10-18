// sync.js
const cron = require('node-cron');
const { getActiveShopifyProducts } = require('./shopify');
const { createPost, updatePostStatus, readDb, writeDb } = require('./meta');

const scheduleDailySync = () => {
    // يعمل كل يوم الساعة 3 صباحاً بتوقيت مسقط
    cron.schedule('0 3 * * *', () => {
        console.log('Running daily product sync...');
        syncProducts();
    }, {
        scheduled: true,
        timezone: "Asia/Muscat" // توقيت سلطنة عمان
    });
};

const syncProducts = async () => {
    console.log('Fetching active products from Shopify...');
    const shopifyProducts = await getActiveShopifyProducts();
    const db = readDb();

    const shopifyProductIds = shopifyProducts.map(p => p.id);
    
    // 1. نشر المنتجات الجديدة (موجودة في Shopify وغير موجودة في قاعدة بياناتنا)
    for (const product of shopifyProducts) {
        const isAlreadyPosted = db.some(p => p.shopifyProductId === product.id);
        if (!isAlreadyPosted) {
            console.log(`Sync: Found new active product "${product.title}". Posting...`);
            await createPost(product);
        }
    }

    // 2. تحديث حالة المنتجات القديمة
    let updatedDb = db.map(dbEntry => {
        const isProductStillActive = shopifyProductIds.includes(dbEntry.shopifyProductId);
        
        if (!isProductStillActive && dbEntry.status === 'active') {
            console.log(`Sync: Product ${dbEntry.shopifyProductId} is no longer active. Disabling post...`);
            updatePostStatus(dbEntry.instagramPostId, false); // تعطيل المنشور
            dbEntry.status = 'inactive';
        } else if (isProductStillActive && dbEntry.status === 'inactive') {
            console.log(`Sync: Product ${dbEntry.shopifyProductId} is active again. Enabling post...`);
            updatePostStatus(dbEntry.instagramPostId, true); // إعادة تفعيل المنشور
            dbEntry.status = 'active';
        }
        return dbEntry;
    });

    writeDb(updatedDb);
    console.log('Daily sync completed.');
};

module.exports = { scheduleDailySync };
