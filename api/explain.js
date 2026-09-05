/**
 * api/explain.js
 * Vercel serverless function that calls Groq to explain a paragraph
 */

require('dotenv').config({ path: '.env.local' });

const https = require('https');

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

if (!GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY not set in environment');
}

/**
 * Call Groq API to generate an explanation
 */
async function explainWithGroq(paragraphText, paragraphLabel) {
  const prompt = `You are a medieval scholastic theology expert. A student asks you to briefly explain this paragraph from Aquinas's Summa Theologiae or related scholastic texts:

${paragraphLabel ? `[${paragraphLabel}]` : ''}
${paragraphText}

Provide a concise 2-3 sentence explanation of what this paragraph is saying and its role in the argument. Be clear and scholarly but accessible to a student.`;

  const requestBody = JSON.stringify({
    model: 'mixtral-8x7b-32768', // Fast and good quality
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 300,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Groq API error: ${res.statusCode} - ${data}`));
          return;
        }

        try {
          const result = JSON.parse(data);
          const explanation = result.choices?.[0]?.message?.content?.trim();
          if (!explanation) {
            reject(new Error('Empty response from Groq'));
          } else {
            resolve(explanation);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Groq response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Groq request failed: ${e.message}`));
    });

    req.write(requestBody);
    req.end();
  });
}

/**
 * Vercel serverless handler
 */
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { paragraph, label } = req.body;

  if (!paragraph) {
    res.status(400).json({ error: 'Missing paragraph text' });
    return;
  }

  try {
    const explanation = await explainWithGroq(paragraph, label || '');
    res.status(200).json({ explanation });
  } catch (error) {
    console.error('Explanation error:', error);
    res.status(500).json({ error: error.message });
  }
};
