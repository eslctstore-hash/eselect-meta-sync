// openai.js
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const generateHashtags = async (productTitle, productDescription) => {
    try {
        const prompt = `Generate 15 relevant and popular hashtags in Arabic for an e-commerce product. The product name is "${productTitle}" and the description is: "${productDescription.replace(/<[^>]*>/g, '').substring(0, 500)}". Return only the hashtags starting with #.`;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 100,
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating hashtags:', error);
        return '#متجر #تسوق #منتجات'; // Fallback hashtags
    }
};

module.exports = { generateHashtags };
