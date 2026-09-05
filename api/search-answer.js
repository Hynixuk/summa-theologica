/**
 * api/search-answer.js
 * Answers a search question from retrieved corpus excerpts, using Groq.
 * Replaces the previous in-browser WebLLM/WebGPU implementation, which
 * required a large model download and a WebGPU-capable device.
 *
 * The client does the retrieval and passes the excerpts in as `context`;
 * this endpoint only does the generation step.
 */

const groq = require('./_groq');

module.exports = async (req, res) => {
  if (groq.handlePreamble(req, res)) return;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server.' });
    return;
  }

  const { query, context, allLowConfidence } = groq.parseBody(req);

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: 'Missing query' });
    return;
  }

  const excerpts = (typeof context === 'string' && context.trim())
    ? context.slice(0, 24000)
    : '(No closely matching passages were found in the corpus for this question.)';

  const systemPrompt =
    'You are a study assistant inside a reading app containing Aristotle\'s Metaphysics, ' +
    'Aquinas\'s Summa Contra Gentiles, and Aquinas\'s Summa Theologica. Base your answer ONLY on ' +
    'the numbered excerpts given below, and answer ONLY the exact question in the final "Question" ' +
    'line. You MUST always state the actual answer first — never skip straight to telling the ' +
    'reader where to read it.\n\n' +
    'Write for someone with no background in philosophy or theology: use plain, everyday English ' +
    'and avoid scholastic jargon. If a technical idea is unavoidable, explain it in ordinary words ' +
    'rather than just naming it.\n\n' +
    'Every reply has exactly two parts, in this order, with nothing before or between them:\n' +
    'PART 1 (required, never omit): 2 to 3 sentences that directly answer the question in plain ' +
    'language, giving the real content of the answer, in your own words, about THIS question only.\n' +
    'PART 2 (required, always last): 1 sentence starting with "Read " naming the excerpt number(s) ' +
    '(for example "Read [2]." or "Read [1, 3].") that contain the full argument — only numbers that ' +
    'appear in the excerpts below.\n\n' +
    'If (and only if) none of the excerpts actually address the question — including any excerpt ' +
    'marked WEAK MATCH, which was retrieved only because it shares one incidental word with the ' +
    'question and is probably NOT actually about it — reply with a single sentence saying the corpus ' +
    'doesn\'t seem to address this question, and give no citation.\n\n' +
    (allLowConfidence
      ? 'IMPORTANT: every excerpt below is a weak match for this question — retrieval only found ' +
        'incidental word overlap, not real topical relevance. Read them critically before answering.\n\n'
      : '') +
    'Reply with plain prose only — no markdown, no asterisks, no bullet points, no headings.\n\n' +
    'Excerpts:\n' + excerpts;

  try {
    const answer = await groq.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Question: ' + query.slice(0, 500) },
    ], apiKey, { maxTokens: 1200, temperature: 0.3 });

    res.status(200).json({ answer });
  } catch (error) {
    console.error('Search answer error:', error);
    res.status(502).json({ error: error.message });
  }
};
