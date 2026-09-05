/**
 * api/_groq.js
 * Shared Groq client used by the serverless endpoints. Files prefixed with
 * "_" are not exposed as routes by Vercel.
 *
 * NOTE: the gpt-oss models are reasoning models — they spend completion
 * tokens on internal reasoning before emitting any content. With a tight
 * max_tokens they burn the whole budget thinking and return EMPTY content
 * (finish_reason "length"). Always keep reasoning_effort low and leave
 * generous headroom.
 */

const https = require('https');

const MODEL = 'openai/gpt-oss-120b';

/**
 * Remove markdown emphasis the model may still emit, since clients render
 * these strings as plain text.
 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:)]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s.,;:)]|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

/**
 * Send a chat completion to Groq and resolve with the plain-text content.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string} apiKey
 * @param {{maxTokens?: number, temperature?: number}} [opts]
 * @returns {Promise<string>}
 */
function chat(messages, apiKey, opts) {
  opts = opts || {};

  const requestBody = JSON.stringify({
    model: MODEL,
    messages: messages,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
    max_tokens: opts.maxTokens || 1200,
    reasoning_effort: 'low',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Groq API error: ${res.statusCode} - ${data.slice(0, 500)}`));
          return;
        }
        let result;
        try {
          result = JSON.parse(data);
        } catch (e) {
          reject(new Error(`Failed to parse Groq response: ${e.message}`));
          return;
        }
        const choice = result.choices && result.choices[0];
        const content = choice && choice.message && choice.message.content;
        if (!content) {
          const why = choice && choice.finish_reason === 'length'
            ? 'the model ran out of tokens before answering'
            : 'the model returned no text';
          reject(new Error(`No answer produced (${why}).`));
          return;
        }
        resolve(stripMarkdown(content));
      });
    });

    req.on('error', (e) => reject(new Error(`Groq request failed: ${e.message}`)));
    req.write(requestBody);
    req.end();
  });
}

/**
 * Apply the CORS/method preamble shared by the endpoints. Returns true when
 * the caller should stop (preflight handled or method rejected).
 */
function handlePreamble(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return true;
  }
  return false;
}

/** Vercel usually parses JSON bodies, but guard against a raw string. */
function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  return body || {};
}

module.exports = { MODEL, chat, stripMarkdown, handlePreamble, parseBody };
