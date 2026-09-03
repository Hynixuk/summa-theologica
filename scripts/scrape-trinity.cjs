// Scrapes St. Augustine's "On the Trinity" (De Trinitate) from newadvent.org
// (Arthur West Haddan translation, Nicene and Post-Nicene Fathers, public
// domain) — a clean HTML source, unlike SCG's OCR'd archive.org scans, so
// this follows the house style of scrape-text.cjs (plain fetch + stripTags)
// rather than scrape-scg.cjs's heuristic OCR reflow.
//
// Source: https://www.newadvent.org/fathers/1301XX.htm (XX = 01-15, one page
// per book). Page structure (verified against the live pages for all 15
// books):
//   <h1>On the Trinity (Book N)</h1>
//   optionally <h2>Introduction</h2> or <h2>Preface.&mdash; Title...</h2>
//     (an unnumbered lead section; appears in Books I-IV and VIII) followed
//     by its own <p> paragraphs
//   <h2>Chapter N.&mdash; Long descriptive title...</h2> marks each chapter
//   Body content is <p> tags; occasional <blockquote><p>...</p></blockquote>
//   for quoted material, flattened into normal paragraphs.
//   Inline <a href="../cathen/XXXXXa.htm">word</a> links are stripped,
//   keeping only the visible text.
//
// The lead section (Introduction/Preface), when present, is emitted as
// "chapter 0" with the h2's own title — it's substantial standalone material
// (e.g. Book I's is Augustine's prefatory letter to Bishop Aurelius), not
// naturally part of Chapter 1.
//
// Usage:
//   node scrape-trinity.cjs <book 1-15> <outFile>
//   node scrape-trinity.cjs all <outDir>   (writes trinity_book1.json .. trinity_book15.json)

const fs = require('fs');
const path = require('path');

const BOOK_ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];

function stripTags(html) {
  return html
    .replace(/<a\b[^>]*>/gi, '')
    .replace(/<\/a>/gi, '')
    .replace(/<blockquote[^>]*>/gi, '')
    .replace(/<\/blockquote>/gi, '')
    .replace(/<em>/gi, '')
    .replace(/<\/em>/gi, '')
    .replace(/<strong>/gi, '')
    .replace(/<\/strong>/gi, '')
    .replace(/<q>/gi, '"')
    .replace(/<\/q>/gi, '"')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&#8212;/g, '—')
    .replace(/&mdash;/g, '—')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#151;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&aelig;/gi, 'æ')
    .replace(/&AElig;/g, 'Æ')
    .replace(/&oelig;/gi, 'œ')
    .replace(/&eacute;/gi, 'é')
    .replace(/&egrave;/gi, 'è')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<[^>]+>/g, '') // any remaining stray tags
    // Generic numeric character references (decimal &#123; and hex &#x1F3;)
    // — covers the scattered polytonic Greek quotations in the source.
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => {
      // Last-resort: log unrecognized entities to console instead of
      // silently leaving them in the text (surfaced via stderr so a scrape
      // run can be spot-checked afterward).
      console.error(`[stripTags] unhandled entity: ${m}`);
      return m;
    });
}

function extractParagraphs(chunk) {
  const paraRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
  const paragraphs = [];
  let pm;
  while ((pm = paraRe.exec(chunk)) !== null) {
    const text = stripTags(pm[1]);
    if (text) paragraphs.push({ label: null, text });
  }
  return paragraphs;
}

function parseBookPage(html, book, url) {
  const bodyStart = html.indexOf('<h1>');
  const bodyEnd = html.indexOf('<div class="pub">');
  const scope = bodyStart >= 0 ? html.slice(bodyStart, bodyEnd > 0 ? bodyEnd : undefined) : html;

  const h1Match = scope.match(/<h1>(.*?)<\/h1>/i);
  const bookTitle = h1Match ? stripTags(h1Match[1]) : `Book ${BOOK_ROMAN[book]}`;

  // Find every <h2> heading (Introduction / Preface / Chapter N) and slice
  // the scope into chunks running from one heading to the next.
  const headingRe = /<h2[^>]*>([\s\S]*?)<\/h2>/g;
  const headings = [];
  let hm;
  while ((hm = headingRe.exec(scope)) !== null) {
    headings.push({ raw: hm[1], index: hm.index, end: headingRe.lastIndex });
  }

  const chapters = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const chunkStart = h.end;
    const chunkEnd = i + 1 < headings.length ? headings[i + 1].index : scope.length;
    const chunk = scope.slice(chunkStart, chunkEnd);
    const headingText = stripTags(h.raw);

    const chapMatch = headingText.match(/^Chapter\s+(\d+)\.?\s*—?\s*(.*)$/i);
    if (chapMatch) {
      const num = parseInt(chapMatch[1], 10);
      const title = chapMatch[2].trim();
      chapters.push({ chapter: num, title: title || `Chapter ${num}`, paragraphs: extractParagraphs(chunk) });
    } else {
      // Unnumbered lead section (Introduction / Preface) -> chapter 0.
      const title = headingText.replace(/\.?\s*—\s*/, ': ').trim() || 'Introduction';
      const paragraphs = extractParagraphs(chunk);
      if (paragraphs.length) {
        chapters.push({ chapter: 0, title, paragraphs });
      }
    }
  }

  return { book, bookTitle, chapters };
}

async function fetchBook(book, retries = 3) {
  const n = String(book).padStart(2, '0');
  const url = `https://www.newadvent.org/fathers/1301${n}.htm`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SummaReaderProject/1.0)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      if (!html.includes('<h1>')) throw new Error('No <h1> found, page may not exist');
      const parsed = parseBookPage(html, book, url);
      if (!parsed.chapters.length) throw new Error('No chapters parsed');
      return parsed;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

function toRecords(parsed) {
  return parsed.chapters.map((c) => ({
    book: parsed.book,
    bookTitle: parsed.bookTitle,
    chapter: c.chapter,
    title: c.title,
    paragraphs: c.paragraphs,
  }));
}

async function main() {
  const [, , bookArg, outArg] = process.argv;
  if (!bookArg || !outArg) {
    console.error('Usage: node scrape-trinity.cjs <book 1-15|all> <outFile|outDir>');
    process.exit(1);
  }

  if (bookArg === 'all') {
    fs.mkdirSync(outArg, { recursive: true });
    for (let book = 1; book <= 15; book++) {
      process.stdout.write(`Book ${book}... `);
      const parsed = await fetchBook(book);
      const records = toRecords(parsed);
      const outFile = path.join(outArg, `trinity_book${book}.json`);
      fs.writeFileSync(outFile, JSON.stringify(records, null, 2), 'utf-8');
      console.log(`OK (${records.length} chapters) -> ${outFile}`);
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 400));
    }
  } else {
    const book = parseInt(bookArg, 10);
    const parsed = await fetchBook(book);
    const records = toRecords(parsed);
    fs.writeFileSync(outArg, JSON.stringify(records, null, 2), 'utf-8');
    console.log(`Wrote ${records.length} chapters to ${outArg}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
