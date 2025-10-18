// meta.js
const axios = require('axios');
const { generateHashtags } = require('./openai');
const fs = require('fs');
const path = require('path');

// ... (دوال readDb, writeDb, checkContainerStatus لم تتغير)

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
            const db = readDb();
            // !! تعديل مهم: نحفظ اسم المنتج الآن !!
            db.push({ 
                shopifyProductId: product.id, 
                instagramPostId: igPostId, 
                productTitle: product.title, // <-- هذا السطر جديد
                status: 'active' 
            });
            writeDb(db);
            console.log(`✅ Successfully posted product ${product.id} to Instagram.`);
        }
    } catch (error) {
        console.error(`❌ Failed to create post for product ${product.id}.`);
        if (error.response) {
            console.error('Error Details from Meta:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('General Error:', error.message);
        }
    }
};

// ... (دوال postToInstagram, createSingleMediaContainer, waitForContainerReady, publishMedia لم تتغير)

// ==========================================================
// ============== دالة تحديث النص (تبقى كما هي) ===============
// ==========================================================
const updateInstagramPostCaption = async (mediaId, newCaption) => {
    console.log(`Updating caption for media ID: ${mediaId}`);
    try {
        const url = `https://graph.facebook.com/${mediaId}`;
        await axios.post(url, {
            caption: newCaption,
            access_token: process.env.META_ACCESS_TOKEN,
        });
        console.log('✅ Caption updated successfully.');
    } catch (error) {
        console.error('❌ Failed to update caption.');
        if (error.response) {
            console.error('Error Details from Meta:', JSON.stringify(error.response.data, null, 2));
        }
    }
};

// تم حذف دالة hideInstagramPost

module.exports = { 
    createPost, 
    updateInstagramPostCaption,
    readDb, 
    writeDb 
};
