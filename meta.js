// meta.js
const axios = require('axios');
const { generateHashtags } = require('./openai');
const fs = = require('fs');
const path = require('path');

// قاعدة البيانات البسيطة
const DB_PATH = path.join(__dirname, 'db.json');

function readDb() {
    if (!fs.existsSync(DB_PATH)) {
        fs.writeFileSync(DB_PATH, JSON.stringify([]));
    }
    const data = fs.readFileSync(DB_PATH);
    return JSON.parse(data);
}

function writeDb(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// الدالة الرئيسية لإنشاء المنشور
const createPost = async (product) => {
    const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${product.handle}`;
    let caption = `${product.title}\n\n${product.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}\n\n`;

    try {
        const hashtags = await generateHashtags(product.title, product.body_html);
        caption += hashtags;

        const imageUrl = product.images[0]?.src;
        if (!imageUrl) {
            console.error('Product has no image.');
            return;
        }

        // نشر على انستجرام
        const igPostId = await postToInstagram(imageUrl, caption);
        
        // يمكنك إضافة دالة للنشر على فيسبوك هنا بنفس الطريقة
        // const fbPostId = await postToFacebook(imageUrl, caption);

        // حفظ معلومات المنشور في قاعدة البيانات
        if (igPostId) {
            const db = readDb();
            db.push({
                shopifyProductId: product.id,
                instagramPostId: igPostId,
                // facebookPostId: fbPostId,
                status: 'active'
            });
            writeDb(db);
            console.log(`Successfully posted product ${product.id} to Instagram.`);
        }
    } catch (error) {
        console.error(`Failed to create post for product ${product.id}:`, error.message);
    }
};

// النشر على انستجرام
const postToInstagram = async (imageUrl, caption) => {
    const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    // الخطوة 1: إنشاء حاوية
    const containerUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media`;
    const containerResponse = await axios.post(containerUrl, {
        image_url: imageUrl,
        caption: caption,
        access_token: accessToken,
    });
    const containerId = containerResponse.data.id;

    // الخطوة 2: نشر الحاوية
    const publishUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`;
    const publishResponse = await axios.post(publishUrl, {
        creation_id: containerId,
        access_token: accessToken,
    });

    return publishResponse.data.id;
};

// دالة لتحديث حالة المنشور (مثال: إخفاء)
const updatePostStatus = async (postId, shouldEnable) => {
    // Meta API لا تدعم "تعطيل" المنشور بسهولة، البديل هو أرشفته أو حذفه
    // هنا مثال بسيط لتوضيح الفكرة، قد تحتاج لتعديل الصلاحيات أو الطريقة
    console.log(`Updating post ${postId} status to ${shouldEnable ? 'enabled' : 'disabled'}. Logic to be implemented.`);
    // مثال:
    // const url = `https://graph.facebook.com/${postId}?is_published=${shouldEnable}&access_token=${process.env.META_ACCESS_TOKEN}`;
    // await axios.post(url);
}


module.exports = { createPost, updatePostStatus, readDb, writeDb };
