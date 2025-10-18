// server.js
require('dotenv').config();
const express = require('express');
const { 
    productCreateWebhookHandler,
    productUpdateWebhookHandler,
    productDeleteWebhookHandler
} = require('./shopify');
const { scheduleDailySync } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Shopify to Meta Publisher is running!');
});

// ==========================================================
// ==============   التعديل هنا   ===========================
// ==========================================================
// زيادة الحد الأقصى لحجم الطلب إلى 10 ميجابايت لجميع الـ Webhooks
const webhookOptions = {
    limit: '10mb',
    type: 'application/json'
};

app.post('/webhooks/products/create', express.raw(webhookOptions), productCreateWebhookHandler);
app.post('/webhooks/products/update', express.raw(webhookOptions), productUpdateWebhookHandler);
app.post('/webhooks/products/delete', express.raw(webhookOptions), productDeleteWebhookHandler);

// تطبيق محلل JSON العام لباقي المسارات
app.use(express.json({ limit: '10mb' })); // زيادة الحد هنا أيضاً احتياطياً

// بدء المزامنة اليومية
scheduleDailySync();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
