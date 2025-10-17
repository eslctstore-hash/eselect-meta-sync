// server.js
require('dotenv').config();
const express = require('express');
const { productCreateWebhookHandler, verifyShopifyWebhook } = require('./shopify');
const { scheduleDailySync } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware للتعامل مع طلبات JSON العادية
app.use(express.json());

// Webhook يحتاج إلى Raw Body للتحقق من التوقيع، لذا نضعه قبل express.json() العام
app.post('/webhooks/products/create', express.raw({ type: 'application/json' }), productCreateWebhookHandler);

// رسالة ترحيبية بسيطة
app.get('/', (req, res) => {
    res.send('Shopify to Meta Publisher is running!');
});

// بدء المزامنة اليومية
scheduleDailySync();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
