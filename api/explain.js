/**
 * api/explain.js
 * Vercel serverless function that calls Groq to explain a paragraph.
 * GROQ_API_KEY must be set as a Vercel environment variable (no dotenv/
 * local .env file is available at runtime in the deployed function).
 */

const https = require('https');

const GROQ_API_URL_PATH = '/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

/**
 * Call Groq API to generate an explanation
 */
function explainWithGroq(paragraphText, paragraphLabel, apiKey) {
  const prompt = `Explain this paragraph from a medieval philosophy text (Aquinas or similar) to someone with no background in philosophy or theology.

${paragraphLabel ? `[${paragraphLabel}]` : ''}
${paragraphText}

Rules for your explanation:
- Write 2 to 3 short sentences. Keep it under 60 words.
- Use plain, everyday English, like you are explaining it to a smart teenager.
- Do not use technical or philosophical jargon. Avoid words like predicated, mode, species, substance, essence, efficient cause, contingent, and privation. If such an idea is unavoidable, explain it in ordinary words instead of naming it.
- Say plainly what the paragraph is claiming and why it matters to the argument.
- Start directly with the explanation. Do not begin with phrases like "This paragraph" or "The objection states".
- Plain prose only. No markdown, no asterisks, no bullet points, no headings.`;

  // gpt-oss is a reasoning model: it spends completion tokens on internal
  // reasoning before emitting any content. With a low cap it burns the whole
  // budget thinking and returns an EMPTY message. Keep reasoning effort low
  // and leave generous headroom so the actual answer always fits.
  const requestBody = JSON.stringify({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1200,
    reasoning_effort: 'low',
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.groq.com',
      path: GROQ_API_URL_PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Groq API error: ${res.statusCode} - ${data.slice(0, 500)}`));
          return;
        }
        try {
          const result = JSON.parse(data);
          const choice = result.choices && result.choices[0];
          const explanation = choice && choice.message && choice.message.content;
          if (!explanation) {
            var why = choice && choice.finish_reason === 'length'
              ? 'the model ran out of tokens before answering'
              : 'the model returned no text';
            reject(new Error('No explanation produced (' + why + ').'));
          } else {
            // Strip any markdown emphasis the model still emits, since the
            // client renders the text as plain text.
            var clean = explanation
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)]|$)/g, '$1$2')
              .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)]|$)/g, '$1$2')
              .replace(/^#{1,6}\s+/gm, '')
              .trim();
            resolve(clean);
          }
        } catch (e) {
          reject(new Error(`Failed to parse Groq response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Groq request failed: ${e.message}`)));
    req.write(requestBody);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    return;
  }

  // Vercel parses JSON bodies automatically for serverless functions, but
  // guard against req.body being a raw string just in case.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { paragraph, label } = body || {};

  if (!paragraph || typeof paragraph !== 'string') {
    res.status(400).json({ error: 'Missing paragraph text' });
    return;
  }

  try {
    const explanation = await explainWithGroq(paragraph.slice(0, 2000), (label || '').slice(0, 100), apiKey);
    res.status(200).json({ explanation });
  } catch (error) {
    console.error('Explanation error:', error);
    res.status(502).json({ error: error.message });
  }
};
