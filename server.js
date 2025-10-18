// server.js
require('dotenv').config();
const express = require('express');
const { 
    productCreateWebhookHandler,
    productUpdateWebhookHandler, // جديد
    productDeleteWebhookHandler  // جديد
} = require('./shopify');
const { scheduleDailySync } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Shopify to Meta Publisher is running!');
});

// تعريف مسارات الـ Webhook الخام أولاً
app.post('/webhooks/products/create', express.raw({ type: 'application/json' }), productCreateWebhookHandler);
app.post('/webhooks/products/update', express.raw({ type: 'application/json' }), productUpdateWebhookHandler); // جديد
app.post('/webhooks/products/delete', express.raw({ type: 'application/json' }), productDeleteWebhookHandler); // جديد

// تطبيق محلل JSON العام لباقي المسارات
app.use(express.json());

// بدء المزامنة اليومية
scheduleDailySync();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
