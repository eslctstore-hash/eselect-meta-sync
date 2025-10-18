// meta.js
const axios = require('axios');
const { generateHashtags } = require('./openai');
const fs = require('fs');
const path = require('path');

// ... (دوال readDb و writeDb و checkContainerStatus تبقى كما هي)

// ## دالة إنشاء المنشور (مُحسَّنة للصور المتعددة) ##
const createPost = async (product) => {
    // ... الكود لإنشاء caption و hashtags لم يتغير ...

    try {
        const imageUrls = product.images.map(img => img.src).slice(0, 10); // خذ أول 10 صور
        if (imageUrls.length === 0) {
            console.error('Product has no images. Aborting post.');
            return;
        }

        console.log(`Attempting to post with ${imageUrls.length} image(s).`);
        const igPostId = await postToInstagram(imageUrls, captionWithHashtags);
        
        if (igPostId) {
            // ... حفظ في قاعدة البيانات لم يتغير ...
        }
    } catch (error) {
        // ... معالجة الأخطاء لم تتغير ...
    }
};

// ## دالة النشر على انستجرام (مُعاد كتابتها بالكامل) ##
const postToInstagram = async (imageUrls, caption) => {
    const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (imageUrls.length === 1) {
        // **منشور بصورة واحدة (المنطق القديم مع التحقق من الجاهزية)**
        const containerId = await createSingleMediaContainer(imageUrls[0], caption, accessToken);
        await waitForContainerReady(containerId, accessToken);
        return publishMedia(containerId, accessToken);
    } else {
        // **منشور بصور متعددة (Carousel)**
        console.log('Creating carousel post...');
        const childContainerIds = [];
        for (const url of imageUrls) {
            const childId = await createSingleMediaContainer(url, null, accessToken); // بدون نص
            childContainerIds.push(childId);
        }

        // انتظر حتى تجهز كل الصور
        for (const childId of childContainerIds) {
            await waitForContainerReady(childId, accessToken);
        }

        // إنشاء حاوية الـ Carousel
        const carouselContainerUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media`;
        const carouselRes = await axios.post(carouselContainerUrl, {
            caption: caption,
            media_type: 'CAROUSEL',
            children: childContainerIds,
            access_token: accessToken,
        });
        const carouselContainerId = carouselRes.data.id;
        console.log(`Carousel container created: ${carouselContainerId}`);

        await waitForContainerReady(carouselContainerId, accessToken);
        return publishMedia(carouselContainerId, accessToken);
    }
};

// -- دوال مساعدة جديدة --
const createSingleMediaContainer = async (imageUrl, caption, accessToken) => {
    const url = `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_ACCOUNT_ID}/media`;
    const params = { image_url: imageUrl, access_token: accessToken };
    if (caption) params.caption = caption;
    const response = await axios.post(url, params);
    return response.data.id;
};

const waitForContainerReady = async (containerId, accessToken) => {
    const MAX_RETRIES = 12, RETRY_DELAY = 5000;
    for (let i = 0; i < MAX_RETRIES; i++) {
        const status = await checkContainerStatus(containerId, accessToken);
        if (status === 'FINISHED') return;
        if (status === 'ERROR') throw new Error(`Container ${containerId} failed to process.`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }
    throw new Error('Container did not become ready in time.');
};

const publishMedia = async (containerId, accessToken) => {
    const url = `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_ACCOUNT_ID}/media_publish`;
    const response = await axios.post(url, { creation_id: containerId, access_token: accessToken });
    console.log(`Successfully published media with ID: ${response.data.id}`);
    return response.data.id;
};

// ==========================================================
// ============== دالة تحديث النص (جديدة) =====================
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

// ==========================================================
// ============== دالة إخفاء المنشور (جديدة) ===================
// ==========================================================
const hideInstagramPost = async (mediaId) => {
    console.log(`Hiding media ID: ${mediaId}`);
    try {
        const url = `https://graph.facebook.com/${mediaId}`;
        await axios.post(url, {
            is_hidden: true,
            access_token: process.env.META_ACCESS_TOKEN,
        });
        console.log('✅ Post hidden successfully.');
    } catch (error) {
        console.error('❌ Failed to hide post.');
        if (error.response) {
            console.error('Error Details from Meta:', JSON.stringify(error.response.data, null, 2));
        }
    }
};

module.exports = { 
    createPost, 
    updateInstagramPostCaption, 
    hideInstagramPost,
    readDb, 
    writeDb 
};
