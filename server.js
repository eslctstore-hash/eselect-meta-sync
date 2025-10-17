// server.js (النسخة المصححة)
require('dotenv').config();
const express = require('express');
const { productCreateWebhookHandler } = require('./shopify');
const { scheduleDailySync } = require('./sync');

const app = express();
const PORT = process.env.PORT || 3000;

// رسالة ترحيبية بسيطة
app.get('/', (req, res) => {
    res.send('Shopify to Meta Publisher is running!');
});

// =================================================================
// !! مهم: تعريف مسار الـ Webhook الخام أولاً !!
// هذا يضمن أن هذا المسار بالذات لن يتم تحليله كـ JSON تلقائيًا
// =================================================================
app.post('/webhooks/products/create', express.raw({ type: 'application/json' }), productCreateWebhookHandler);


// الآن، قم بتطبيق محلل JSON العام لباقي المسارات المحتملة
app.use(express.json());


// بدء المزامنة اليومية
scheduleDailySync();

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
