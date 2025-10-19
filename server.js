// server.js
require('dotenv').config();
const express = require('express');
const { 
    productCreateWebhookHandler,
    productUpdateWebhookHandler,
    productDeleteWebhookHandler
} = require('./shopify');
// استيراد دالة المزامنة مباشرة
const { scheduleDailySync, syncProducts } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Shopify to Meta Publisher is running!');
});

// ==========================================================
// ============== مشغل المزامنة اليدوي (جديد) ================
// ==========================================================
app.get('/manual-sync', async (req, res) => {
    console.log("!!!!!!!!!!!!!! MANUAL SYNC TRIGGERED !!!!!!!!!!!!!!");
    // قم بتشغيل دالة المزامنة وانتظرها حتى تنتهي
    await syncProducts(); 
    console.log("!!!!!!!!!!!!!! MANUAL SYNC COMPLETED !!!!!!!!!!!!!!");
    res.status(200).send('Manual sync process has been completed. Check logs for details.');
});

const webhookOptions = {
    limit: '10mb',
    type: 'application/json'
};
app.post('/webhooks/products/create', express.raw(webhookOptions), productCreateWebhookHandler);
app.post('/webhooks/products/update', express.raw(webhookOptions), productUpdateWebhookHandler);
app.post('/webhooks/products/delete', express.raw(webhookOptions), productDeleteWebhookHandler);

app.use(express.json({ limit: '10mb' }));

// بدء المزامنة اليومية المجدولة
scheduleDailySync();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
