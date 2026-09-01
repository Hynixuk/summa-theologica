// Scrapes Summa Theologica question pages from newadvent.org (Dominican Fathers 1920 translation, public domain)
// Usage: node scrape-text.js <partCode> <startQ> <endQ> <outFile>
// partCode: 1 = Prima Pars, 2 = Prima Secundae, 3 = Secunda Secundae, 4 = Tertia Pars, 5 = Supplement

const fs = require('fs');

const PART_NAMES = {
  1: 'Prima Pars',
  2: 'Prima Secundae Partis',
  3: 'Secunda Secundae Partis',
  4: 'Tertia Pars',
  5: 'Supplementum Tertiae Partis',
};

function stripTags(html) {
  return html
    .replace(/<a\b[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    .replace(/&#8212;/g, '—')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseQuestionPage(html, part, qnum, url) {
  const bodyStart = html.indexOf('<h1>');
  const bodyEnd = html.indexOf('<!-- google_ad_section_end -->');
  const scope = bodyStart >= 0 ? html.slice(bodyStart, bodyEnd > 0 ? bodyEnd : undefined) : html;

  const h1Match = scope.match(/<h1>Question \d+\.\s*(.*?)<\/h1>/i);
  const title = h1Match ? stripTags(h1Match[1]) : `Question ${qnum}`;

  // Split into article chunks on <h2 id="articleN">
  const articleRe = /<h2 id="article(\d+)">Article \d+\.\s*(.*?)<\/h2>([\s\S]*?)(?=<h2 id="article\d+">|$)/g;
  const articles = [];
  let m;
  while ((m = articleRe.exec(scope)) !== null) {
    const num = parseInt(m[1], 10);
    const artTitle = stripTags(m[2]);
    const chunk = m[3];

    const paraRe = /<p>([\s\S]*?)<\/p>/g;
    let pm;
    const paragraphs = [];
    while ((pm = paraRe.exec(chunk)) !== null) {
      const raw = pm[1];
      const labelMatch = raw.match(/^<strong>(.*?)<\/strong>\s*(.*)$/is);
      if (labelMatch) {
        paragraphs.push({
          label: stripTags(labelMatch[1]),
          text: stripTags(labelMatch[2]),
        });
      } else {
        const text = stripTags(raw);
        if (text) paragraphs.push({ label: null, text });
      }
    }
    articles.push({ number: num, title: artTitle, paragraphs });
  }

  return {
    part,
    partName: PART_NAMES[part],
    question: qnum,
    url,
    title,
    articles,
  };
}

async function fetchQuestion(part, qnum, retries = 3) {
  const url = `https://www.newadvent.org/summa/${part}${String(qnum).padStart(3, '0')}.htm`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SummaReaderProject/1.0)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!html.includes('<h1>')) throw new Error('No <h1> found, page may not exist');
      return parseQuestionPage(html, part, qnum, url);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

async function main() {
  const [, , partArg, startArg, endArg, outArg] = process.argv;
  const part = parseInt(partArg, 10);
  const start = parseInt(startArg, 10);
  const end = parseInt(endArg, 10);
  const outFile = outArg;

  if (!part || !start || !end || !outFile) {
    console.error('Usage: node scrape-text.js <partCode 1-5> <startQ> <endQ> <outFile>');
    process.exit(1);
  }

  const results = [];
  for (let q = start; q <= end; q++) {
    process.stdout.write(`Fetching Part ${part} Question ${q}... `);
    try {
      const data = await fetchQuestion(part, q);
      results.push(data);
      console.log(`OK (${data.articles.length} articles)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nWrote ${results.length} questions to ${outFile}`);
}

main();
