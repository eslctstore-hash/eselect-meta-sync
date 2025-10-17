// openai.js

// استيراد مكتبة OpenAI الرسمية
const { OpenAI } = require('openai');

// إنشاء نسخة جديدة من عميل OpenAI باستخدام المفتاح السري من ملف .env
// هذا يضمن أن مفتاحك يبقى آمناً ولا يتم تضمينه مباشرة في الكود
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * دالة لتوليد الهاشتاجات باستخدام OpenAI API
 * @param {string} productTitle - اسم المنتج
 * @param {string} productDescription - وصف المنتج
 * @returns {Promise<string>} - نص يحتوي على الهاشتاجات المقترحة
 */
const generateHashtags = async (productTitle, productDescription) => {
    try {
        // 1. تنظيف وصف المنتج: إزالة أكواد HTML وأخذ أول 500 حرف فقط
        // هذا يجعل النص المرسل لـ OpenAI أكثر تركيزاً ويوفر في استهلاك التوكنز
        const cleanDescription = productDescription.replace(/<[^>]*>/g, '').substring(0, 500);

        // 2. صياغة الأمر (Prompt) لـ OpenAI
        // الأمر يجب أن يكون واضحاً ومحدداً للحصول على أفضل النتائج
        const prompt = `
        قم بتوليد 15 هاشتاج ذات صلة وشائعة باللغة العربية لمنتج في متجر إلكتروني.
        اسم المنتج: "${productTitle}"
        وصف المنتج: "${cleanDescription}"
        
        الشروط:
        - يجب أن تكون الهاشتاجات باللغة العربية.
        - قم بإرجاع الهاشتاجات فقط، بحيث يبدأ كل واحد بعلامة #.
        - افصل بين كل هاشتاج والآخر بمسافة.
        `;

        // 3. إرسال الطلب إلى OpenAI API
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // يمكنك استخدام "gpt-4" لنتائج قد تكون أفضل
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7, // درجة الإبداع (0.2 للواقعية, 0.8 للإبداع)
            max_tokens: 150, // الحد الأقصى لعدد التوكنز في الرد
        });

        // 4. استخلاص النص من الرد وتنظيفه
        const hashtags = response.choices[0].message.content.trim();
        console.log(`Generated hashtags for "${productTitle}": ${hashtags}`);
        return hashtags;

    } catch (error) {
        // في حال حدوث أي خطأ (مشكلة في الاتصال، مفتاح غير صالح، إلخ)
        console.error('Error generating hashtags with OpenAI:', error.message);
        
        // 5. إرجاع هاشتاجات احتياطية (Fallback)
        // هذا يضمن أن التطبيق لن يتعطل وسيتم نشر المنشور بهاشتاجات عامة
        return '#متجر #تسوق #منتجات_جديدة #عروض #حصري';
    }
};

// تصدير الدالة لتكون متاحة للاستخدام في الملفات الأخرى (مثل meta.js)
module.exports = { generateHashtags };
