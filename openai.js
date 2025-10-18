// openai.js
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const generateHashtags = async (productTitle, productDescription) => {
    try {
        const cleanDescription = productDescription.replace(/<[^>]*>/g, '').substring(0, 500);
        const prompt = `
        قم بتوليد 15 هاشتاج ذات صلة وشائعة باللغة العربية لمنتج في متجر إلكتروني.
        اسم المنتج: "${productTitle}"
        وصف المنتج: "${cleanDescription}"
        الشروط:
        - يجب أن تكون الهاشتاجات باللغة العربية.
        - قم بإرجاع الهاشتاجات فقط، بحيث يبدأ كل واحد بعلامة #.
        - افصل بين كل هاشتاج والآخر بمسافة.
        `;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 150,
        });

        const hashtags = response.choices[0].message.content.trim();
        console.log(`Generated hashtags for "${productTitle}": ${hashtags}`);
        return hashtags;

    } catch (error) {
        console.error('Error generating hashtags with OpenAI:', error.message);
        return '#متجر #تسوق #منتجات_جديدة #عروض #حصري';
    }
};

module.exports = { generateHashtags };
