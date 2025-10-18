// meta.js
const axios = require('axios');
const { generateHashtags } = require('./openai');
const fs = require('fs');
const path = require('path');

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

const checkContainerStatus = async (containerId, accessToken) => {
    try {
        const url = `https://graph.facebook.com/v18.0/${containerId}?fields=status_code&access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data.status_code;
    } catch (error) {
        return 'ERROR';
    }
};

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
            db.push({ 
                shopifyProductId: product.id, 
                instagramPostId: igPostId, 
                productTitle: product.title,
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

const postToInstagram = async (imageUrls, caption) => {
    // ... هذا القسم لم يتغير ...
    const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (imageUrls.length === 1) {
        const containerId = await createSingleMediaContainer(imageUrls[0], caption, accessToken);
        await waitForContainerReady(containerId, accessToken);
        return publishMedia(containerId, accessToken);
    } else {
        const childContainerIds = [];
        for (const url of imageUrls) {
            const childId = await createSingleMediaContainer(url, null, accessToken);
            childContainerIds.push(childId);
        }

        for (const childId of childContainerIds) {
            await waitForContainerReady(childId, accessToken);
        }

        const carouselContainerUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media`;
        const carouselRes = await axios.post(carouselContainerUrl, {
            caption: caption,
            media_type: 'CAROUSEL',
            children: childContainerIds,
            access_token: accessToken,
        });
        const carouselContainerId = carouselRes.data.id;
        await waitForContainerReady(carouselContainerId, accessToken);
        return publishMedia(carouselContainerId, accessToken);
    }
};

const createSingleMediaContainer = async (imageUrl, caption, accessToken) => {
    // ... هذا القسم لم يتغير ...
    const url = `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_ACCOUNT_ID}/media`;
    const params = { image_url: imageUrl, access_token: accessToken };
    if (caption) params.caption = caption;
    const response = await axios.post(url, params);
    return response.data.id;
};

const waitForContainerReady = async (containerId, accessToken) => {
    // ... هذا القسم لم يتغير ...
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
    // ... هذا القسم لم يتغير ...
    const url = `https://graph.facebook.com/v18.0/${process.env.INSTAGRAM_ACCOUNT_ID}/media_publish`;
    const response = await axios.post(url, { creation_id: containerId, access_token: accessToken });
    console.log(`Successfully published media with ID: ${response.data.id}`);
    return response.data.id;
};

// ==========================================================
// ============== دالة تحديث النص (تم تعديلها) ================
// ==========================================================
const updateInstagramPostCaption = async (mediaId, newCaption) => {
    console.log(`Updating caption for media ID: ${mediaId}`);
    try {
        const url = `https://graph.facebook.com/${mediaId}`;
        await axios.post(url, {
            caption: newCaption,
            comment_enabled: true, // <-- هذا السطر الجديد هو الحل
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

module.exports = { 
    createPost, 
    updateInstagramPostCaption,
    readDb, 
    writeDb 
};
