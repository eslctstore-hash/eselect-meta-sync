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

// =================================================================
// ============== NEW HELPER FUNCTION TO CHECK STATUS ==============
// =================================================================
/**
 * Checks the status of a media container on Instagram's servers.
 * @param {string} containerId The ID of the container to check.
 * @param {string} accessToken Your Meta access token.
 * @returns {Promise<string>} The status code (e.g., 'FINISHED', 'IN_PROGRESS', 'ERROR').
 */
const checkContainerStatus = async (containerId, accessToken) => {
    try {
        const url = `https://graph.facebook.com/v18.0/${containerId}?fields=status_code&access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data.status_code;
    } catch (error) {
        console.error('Error checking container status:', error.response ? error.response.data : error.message);
        return 'ERROR';
    }
};

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
            db.push({ shopifyProductId: product.id, instagramPostId: igPostId, status: 'active' });
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

// =================================================================
// ============== MODIFIED FUNCTION WITH POLLING LOGIC =============
// =================================================================
const postToInstagram = async (imageUrl, caption) => {
    const igAccountId = process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;
    const MAX_RETRIES = 12; // Try for up to 60 seconds (12 * 5s)
    const RETRY_DELAY = 5000; // 5 seconds

    // Step 1: Create Media Container
    console.log('Step 1: Creating media container...');
    const containerUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media`;
    const containerResponse = await axios.post(containerUrl, { image_url: imageUrl, caption: caption, access_token: accessToken });
    const containerId = containerResponse.data.id;
    console.log(`Step 1 successful. Container ID: ${containerId}`);

    // Step 2: Poll for container status
    console.log('Step 2: Checking media processing status...');
    for (let i = 0; i < MAX_RETRIES; i++) {
        const status = await checkContainerStatus(containerId, accessToken);
        console.log(`...Status check ${i + 1}/${MAX_RETRIES}: ${status}`);

        if (status === 'FINISHED') {
            // Step 3: Publish the container
            console.log('Step 3: Media is ready. Publishing container...');
            const publishUrl = `https://graph.facebook.com/v18.0/${igAccountId}/media_publish`;
            const publishResponse = await axios.post(publishUrl, { creation_id: containerId, access_token: accessToken });
            console.log('Step 3 successful. Post published!');
            return publishResponse.data.id;
        } else if (status === 'ERROR') {
            throw new Error('Media container failed to process.');
        }

        // Wait before checking again
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
    }

    throw new Error('Media container did not become ready in time.');
};

const updatePostStatus = async (postId, shouldEnable) => {
    console.log(`Updating post ${postId} status to ${shouldEnable ? 'enabled' : 'disabled'}. Logic to be implemented.`);
}

module.exports = { createPost, updatePostStatus, readDb, writeDb };
