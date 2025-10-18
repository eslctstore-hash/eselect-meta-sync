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

const createPost = async (product) => {
    const productUrl = `https://${process.env.SHOPIFY_SHOP_URL}/products/${product.handle}`;
    let caption = `${product.title}\n\n${product.body_html.replace(/<[^>]*>/g, '').substring(0, 1500)}...\n\nاطلبه الآن:\n${productUrl}\n\n`;

    try {
        const hashtags = await generateHashtags(product.title, product.body_html);
        caption += hashtags;

        const imageUrl = product.images[0]?.src;
        if (!imageUrl) {
            console.error('Product has no image. Aborting post.');
            return;
        }

        console.log(`Attempting to post with image URL: ${imageUrl}`);
        const igPostId = await postToInstagram(imageUrl, caption);
        
        if (igPostId) {
            const db = readDb();
            db.push({
                shopifyProductId: product.id,
                instagramPostId: igPostId,
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

const postToInstagram = async (imageUrl, caption) => {
    const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    console.log('Step 1: Creating media container...');
    const containerUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media`;
    const containerResponse = await axios.post(containerUrl, {
        image_url: imageUrl,
        caption: caption,
        access_token: accessToken,
    });
    const containerId = containerResponse.data.id;
    console.log(`Step 1 successful. Container ID: ${containerId}`);

    console.log('Step 2: Publishing container...');
    const publishUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`;
    const publishResponse = await axios.post(publishUrl, {
        creation_id: containerId,
        access_token: accessToken,
    });
    console.log('Step 2 successful. Post published.');

    return publishResponse.data.id;
};

const updatePostStatus = async (postId, shouldEnable) => {
    console.log(`Updating post ${postId} status to ${shouldEnable ? 'enabled' : 'disabled'}. Logic to be implemented.`);
}

module.exports = { createPost, updatePostStatus, readDb, writeDb };
