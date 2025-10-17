// sync.js
const cron = require('node-cron');
const { getActiveShopifyProducts } = require('./shopify');
const { createPost, updatePostStatus, readDb, writeDb } = require('./meta');

const scheduleDailySync = () => {
    // '0 3 * * *'  يعني التشغيل كل يوم الساعة 3 صباحاً
    cron.schedule('0 3 * * *', () => {
        console.log('Running daily product sync...');
        syncProducts();
    }, {
        scheduled: true,
        timezone: "Asia/Muscat"
    });
};

const syncProducts = async () => {
    const shopifyProducts = await getActiveShopifyProducts();
    const db = readDb();

    const shopifyProductIds = shopifyProducts.map(p => p.id);
    const dbProductIds = db.map(p => p.shopifyProductId);
    
    // 1. نشر المنتجات الجديدة (موجودة في Shopify وغير موجودة في قاعدة بياناتنا)
    for (const product of shopifyProducts) {
        if (!dbProductIds.includes(product.id)) {
            console.log(`Sync: Found new product "${product.title}". Posting...`);
            await createPost(product);
        }
    }

    // 2. تحديث حالة المنتجات القديمة
    let updatedDb = db.map(dbEntry => {
        // إذا كان المنتج المحفوظ لم يعد موجوداً في قائمة المنتجات الفعالة من Shopify
        if (!shopifyProductIds.includes(dbEntry.shopifyProductId)) {
            if (dbEntry.status === 'active') {
                console.log(`Sync: Product ${dbEntry.shopifyProductId} is no longer active. Disabling post...`);
                // updatePostStatus(dbEntry.instagramPostId, false); // تعطيل المنشور
                dbEntry.status = 'inactive';
            }
        } else { // المنتج ما زال فعالاً
            if (dbEntry.status === 'inactive') {
                console.log(`Sync: Product ${dbEntry.shopifyProductId} is active again. Enabling post...`);
                // updatePostStatus(dbEntry.instagramPostId, true); // إعادة تفعيل المنشور
                dbEntry.status = 'active';
            }
        }
        return dbEntry;
    });

    writeDb(updatedDb);
    console.log('Daily sync completed.');
};

module.exports = { scheduleDailySync };
