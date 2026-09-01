#!/usr/bin/env node
// Fetches the clean plain-text edition of Aristotle's Metaphysics (Ross 1908)
// from the Internet Classics Archive and converts it to metaphysics.json schema.
// This replaces the old OCR-based approach (archive.org DJVU scans were garbled).

const https = require('https');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const URL = 'https://classics.mit.edu/Aristotle/metaphysics.mb.txt';

const BOOK_NAMES = {
  1: 'Book I (Α, "the Greater Alpha")',
  2: 'Book II (α, "the Less")',
  3: 'Book III (Β)',
  4: 'Book IV (Γ)',
  5: 'Book V (Δ)',
  6: 'Book VI (Ε)',
  7: 'Book VII (Ζ)',
  8: 'Book VIII (Η)',
  9: 'Book IX (Θ)',
  10: 'Book X (Ι)',
  11: 'Book XI (Κ)',
  12: 'Book XII (Λ)',
  13: 'Book XIII (Μ)',
  14: 'Book XIV (Ν)',
};

const ROMAN_TO_INT = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
  XI: 11, XII: 12, XIII: 13, XIV: 14,
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function cleanParagraph(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^"+/, '')
    .replace(/"+$/, '')
    .replace(/"+/g, '"')
    .trim();
}

function parse(fullText) {
  // Strip header/footer
  const startIdx = fullText.indexOf('BOOK I');
  const endIdx = fullText.indexOf('Copyright statement');
  const body = fullText.slice(startIdx, endIdx === -1 ? undefined : endIdx);

  // Split on the book separator + "BOOK <roman>" headings
  const bookRegex = /BOOK\s+([IVX]+)\s*\n/g;
  const bookSplits = [];
  let m;
  while ((m = bookRegex.exec(body)) !== null) {
    bookSplits.push({ roman: m[1], start: m.index + m[0].length });
  }

  const chapters = [];

  for (let i = 0; i < bookSplits.length; i++) {
    const bookNum = ROMAN_TO_INT[bookSplits[i].roman];
    if (!bookNum) continue;
    const start = bookSplits[i].start;
    const end = i + 1 < bookSplits.length ? bookSplits[i + 1].start : body.length;
    const bookText = '\n' + body.slice(start, end);

    // Split into chapters on "Part N"
    const partRegex = /\n\s*Part\s+(\d+)\s*"?\s*\n/g;
    const partSplits = [];
    let pm;
    while ((pm = partRegex.exec(bookText)) !== null) {
      partSplits.push({ num: parseInt(pm[1], 10), start: pm.index + pm[0].length });
    }

    if (partSplits.length === 0) continue;

    for (let j = 0; j < partSplits.length; j++) {
      const cStart = partSplits[j].start;
      const cEnd = j + 1 < partSplits.length ? partSplits[j + 1].start : bookText.length;
      let chapterText = bookText.slice(cStart, cEnd).replace(/-{10,}[\s\S]*$/, '').trim();

      // Split into paragraphs on blank lines
      const rawParas = chapterText.split(/\n\s*\n/).map(p => cleanParagraph(p)).filter(p => p.length > 0 && p !== '"');

      if (rawParas.length === 0) continue;

      chapters.push({
        book: bookNum,
        bookTitle: BOOK_NAMES[bookNum],
        chapter: partSplits[j].num,
        paragraphs: rawParas.map(p => ({ text: p })),
      });
    }
  }

  return chapters;
}

async function main() {
  const outFile = process.argv[2] || path.join(ROOT, 'data', 'text', 'metaphysics.json');
  const startBook = parseInt(process.argv[3] || '1', 10);
  const endBook = parseInt(process.argv[4] || '14', 10);

  console.log(`Fetching ${URL} ...`);
  const text = await fetchUrl(URL);
  console.log(`Fetched ${text.length} bytes`);

  const allChapters = parse(text);
  const filtered = allChapters.filter(c => c.book >= startBook && c.book <= endBook);

  console.log(`\nParsed ${allChapters.length} total chapters, keeping ${filtered.length} (books ${startBook}-${endBook})`);
  for (let b = startBook; b <= endBook; b++) {
    const count = filtered.filter(c => c.book === b).length;
    console.log(`  Book ${b}: ${count} chapters`);
  }

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(filtered, null, 2));
  console.log(`\nWrote ${outFile}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
