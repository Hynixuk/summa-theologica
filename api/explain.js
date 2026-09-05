/**
 * api/explain.js
 * Explains a single paragraph in plain language, using Groq.
 * GROQ_API_KEY must be set as a Vercel environment variable.
 */

const groq = require('./_groq');

function buildPrompt(paragraphText, paragraphLabel) {
  return 'Explain this paragraph from a medieval philosophy text (Aquinas or similar) to someone ' +
    'with no background in philosophy or theology.\n\n' +
    (paragraphLabel ? '[' + paragraphLabel + ']\n' : '') +
    paragraphText +
    '\n\nRules for your explanation:\n' +
    '- Write 2 to 3 short sentences. Keep it under 60 words.\n' +
    '- Use plain, everyday English, like you are explaining it to a smart teenager.\n' +
    '- Do not use technical or philosophical jargon. Avoid words like predicated, mode, species, ' +
    'substance, essence, efficient cause, contingent, and privation. If such an idea is ' +
    'unavoidable, explain it in ordinary words instead of naming it.\n' +
    '- Say plainly what the paragraph is claiming and why it matters to the argument.\n' +
    '- Start directly with the explanation. Do not begin with phrases like "This paragraph" or ' +
    '"The objection states".\n' +
    '- Plain prose only. No markdown, no asterisks, no bullet points, no headings.';
}

module.exports = async (req, res) => {
  if (groq.handlePreamble(req, res)) return;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    return;
  }

  const { paragraph, label } = groq.parseBody(req);

  if (!paragraph || typeof paragraph !== 'string') {
    res.status(400).json({ error: 'Missing paragraph text' });
    return;
  }

  try {
    const prompt = buildPrompt(paragraph.slice(0, 2000), (label || '').slice(0, 100));
    const explanation = await groq.chat(
      [{ role: 'user', content: prompt }],
      apiKey,
      { maxTokens: 1200, temperature: 0.3 }
    );
    res.status(200).json({ explanation });
  } catch (error) {
    console.error('Explanation error:', error);
    res.status(502).json({ error: error.message });
  }
};
