#!/usr/bin/env node
/**
 * Fetches W.D. Ross 1908 translation from MIT Classics Archive (clean HTML source)
 * and converts to metaphysics.json schema.
 *
 * MIT Classics is better than raw archive.org DJVU for this purpose because:
 * - Already HTML-formatted with clear structure
 * - Minimal footnote/header contamination
 * - Chapter boundaries are obvious
 *
 * This script:
 * 1. Fetches each book's HTML from MIT Classics
 * 2. Parses chapter boundaries
 * 3. Extracts paragraphs
 * 4. Outputs JSON in metaphysics.json schema
 *
 * Usage:
 *   node fetch-ross-from-mit.cjs <output-file> [start-book] [end-book]
 *   node fetch-ross-from-mit.cjs data/text/ross_books_3-14.json 3 14
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

const MIT_BASE = 'https://classics.mit.edu/Aristotle/metaphysics';
const ROOT = path.join(__dirname, '..');

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

const ROMAN_NUMERALS = {
  1: 'i', 2: 'ii', 3: 'iii', 4: 'iv', 5: 'v', 6: 'vi', 7: 'vii', 8: 'viii',
  9: 'ix', 10: 'x', 11: 'xi', 12: 'xii', 13: 'xiii', 14: 'xiv',
};

const CHAPTER_COUNTS = {
  1: 10, 2: 3, 3: 6, 4: 8, 5: 30, 6: 4, 7: 17, 8: 6,
  9: 10, 10: 10, 11: 12, 12: 10, 13: 10, 14: 6,
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Simple HTML tag stripper for cleanup
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '') // Remove tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

// Roman to integer conversion
function romanToInt(roman) {
  roman = roman.toUpperCase();
  let value = 0;
  const vals = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  for (let i = 0; i < roman.length; i++) {
    const cur = vals[roman[i]];
    const next = vals[roman[i + 1]];
    if (!cur) return NaN;
    value += (next > cur) ? -cur : cur;
  }
  return value;
}

// Extract chapter number from various formats
function extractChapterNumber(text) {
  const matches = [
    /^Part\s+([IVivxl]+)/i,
    /^Chapter\s+([IVivxl]+)/i,
    /^(\d+)\./,
    /^\s*([IVivxl]+)\s*\.?$/i,
  ];

  for (const regex of matches) {
    const m = text.match(regex);
    if (m) {
      const num = m[1];
      // Convert roman to int if needed
      if (/^[IVivxl]+$/.test(num)) {
        const result = romanToInt(num);
        if (!isNaN(result)) return result;
      } else {
        return parseInt(num, 10);
      }
    }
  }
  return null;
}

async function fetchBook(bookNum) {
  const roman = ROMAN_NUMERALS[bookNum];
  const url = `${MIT_BASE}.${bookNum}.${roman}.html`;

  console.log(`Fetching Book ${bookNum} from ${url}...`);

  try {
    const html = await fetchUrl(url);
    return { bookNum, html };
  } catch (err) {
    console.error(`Failed to fetch Book ${bookNum}: ${err.message}`);
    return null;
  }
}

function parseBookHtml(bookNum, html) {
  const chapters = [];
  const bookTitle = BOOK_NAMES[bookNum];
  const expectedChapters = CHAPTER_COUNTS[bookNum];

  // Split into lines and process
  const lines = html.split('\n');
  let currentChapter = 1;
  let currentParagraphs = [];
  let inContent = false;
  let foundBookMarker = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = stripHtml(line).trim();

    // Start of content: look for book number mention
    if (!foundBookMarker && stripped.includes(`Book ${bookNum}`) && stripped.length < 50) {
      foundBookMarker = true;
      inContent = true;
      continue;
    }

    if (!inContent) continue;

    // Stop at the next book or end marker
    if (foundBookMarker && (stripped.includes('Book ') || stripped.includes('***'))) {
      if (stripped.includes(`Book ${bookNum + 1}`) || (bookNum === 14 && stripped.includes('***'))) {
        break;
      }
    }

    // Detect chapter/part markers
    const chapterMatch = stripped.match(/^(?:Part|Chapter)\s+([IVivxl]+)/i);
    if (chapterMatch) {
      // Save the previous chapter
      if (currentParagraphs.length > 0) {
        chapters.push({
          book: bookNum,
          bookTitle,
          chapter: currentChapter,
          paragraphs: currentParagraphs.map(p => ({ text: p })),
        });
      }

      // Move to next chapter
      currentChapter = romanToInt(chapterMatch[1]);
      currentParagraphs = [];
      continue;
    }

    // Collect paragraph content (substantial non-empty lines)
    if (stripped.length > 30 && !stripped.match(/^(Book|Chapter|Part|By|Written|Translated|Downloaded)/i)) {
      // Don't include lines that are headers or metadata
      if (currentChapter > 0) {
        currentParagraphs.push(stripped);
      }
    }
  }

  // Don't forget the last chapter
  if (currentParagraphs.length > 0 && currentChapter > 0) {
    chapters.push({
      book: bookNum,
      bookTitle,
      chapter: currentChapter,
      paragraphs: currentParagraphs.map(p => ({ text: p })),
    });
  }

  return chapters;
}

async function main() {
  const outFile = process.argv[2] || path.join(ROOT, 'data', 'text', 'ross_books_3-14.json');
  const startBook = parseInt(process.argv[3] || '3', 10);
  const endBook = parseInt(process.argv[4] || '14', 10);

  console.log(`\n=== Fetching Ross translation (Books ${startBook}-${endBook}) ===`);
  console.log(`Output: ${outFile}\n`);

  const allChapters = [];

  for (let b = startBook; b <= endBook; b++) {
    const bookData = await fetchBook(b);
    if (!bookData) continue;

    const chapters = parseBookHtml(b, bookData.html);
    console.log(`  Book ${b}: ${chapters.length} chapters`);
    allChapters.push(...chapters);
  }

  // Write output
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(allChapters, null, 2));

  console.log(`\nWrote ${allChapters.length} chapters to ${outFile}`);
  console.log(`Next step: Merge with Books 1-2 from existing metaphysics.json`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
