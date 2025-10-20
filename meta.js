// meta.js
// ... (كل الدوال الأخرى تبقى كما هي)
const createPost = async (product) => {
    const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${product.handle}`;
    let caption = `${product.title}\n\n${product.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}\n\n`;

    try {
        const hashtags = await generateHashtags(product.title, product.body_html);
        const captionWithHashtags = caption + hashtags;
        const imageUrls = product.images.map(img => img.src).slice(0, 10);
        
        if (imageUrls.length === 0) {
            console.error('Product has no images. Aborting post.');
            return;
        }

        const igPostId = await postToInstagram(imageUrls, captionWithHashtags);
        
        if (igPostId) {
            let db = readDb();
            // **المنطق الجديد: ابحث عن السجل 'pending' وقم بتحديثه**
            const entryIndex = db.findIndex(p => p.shopifyProductId === product.id);
            if (entryIndex !== -1) {
                // تحديث السجل الحالي
                db[entryIndex].instagramPostId = igPostId;
                db[entryIndex].status = 'active'; // تحديث الحالة
                db[entryIndex].productTitle = product.title; // تحديث العنوان
            } else {
                // (حالة احتياطية) إذا لم يتم العثور على السجل، قم بإضافته
                db.push({ 
                    shopifyProductId: product.id, 
                    instagramPostId: igPostId, 
                    productTitle: product.title,
                    status: 'active' 
                });
            }
            writeDb(db);
            console.log(`✅ Successfully posted and updated DB for product ${product.id}.`);
        }
    } catch (error) {
        // ... no change ...
    }
};

// ... (باقي الملف يبقى كما هو)

module.exports = { 
    createPost, 
    updateInstagramPostCaption,
    readDb, 
    writeDb 
};
