#!/usr/bin/env node
/**
 * Converts raw text file (from archive.org or any source) into metaphysics.json schema.
 *
 * Usage:
 *   node convert-raw-text-to-json.cjs <input-text-file> <output-json-file> [options]
 *
 * Example:
 *   # Download ross-raw.txt from archive.org, then:
 *   node convert-raw-text-to-json.cjs data/text/ross-raw.txt data/text/ross_books_3-14.json --books 3-14
 *
 * The input text file should have:
 * - Clear "BOOK III" / "BOOK IV" markers (case-insensitive)
 * - Chapter markers like "Chapter 1" or "1." on their own line
 * - Paragraph text separated by blank lines
 */

const fs = require('fs');
const path = require('path');

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

const CHAPTER_COUNTS = {
  1: 10, 2: 3, 3: 6, 4: 8, 5: 30, 6: 4, 7: 17, 8: 6,
  9: 10, 10: 10, 11: 12, 12: 10, 13: 10, 14: 6,
};

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

function extractBookNumber(line) {
  // Match "Book III", "BOOK 3", etc.
  const m = line.match(/Book\s+(?:([IVivxl]+)|(\d+))/i);
  if (m) {
    if (m[1]) return romanToInt(m[1]);
    else return parseInt(m[2], 10);
  }
  return null;
}

function extractChapterNumber(line) {
  // Match "Chapter V", "1.", "Part III", etc.
  const m = line.match(/(?:Chapter|Part)\s+(?:([IVivxl]+)|(\d+))|^(\d+)\s*\.?$/i);
  if (m) {
    if (m[1]) return romanToInt(m[1]);
    else if (m[2]) return parseInt(m[2], 10);
    else if (m[3]) return parseInt(m[3], 10);
  }
  return null;
}

function parseRawText(text, startBook, endBook) {
  const chapters = [];
  const lines = text.split('\n');

  let currentBook = null;
  let currentChapter = null;
  let currentParagraphs = [];
  let inContent = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();

    // Detect book markers
    const bookNum = extractBookNumber(trimmed);
    if (bookNum !== null) {
      // Save previous chapter
      if (currentBook !== null && currentChapter !== null && currentParagraphs.length > 0) {
        chapters.push({
          book: currentBook,
          bookTitle: BOOK_NAMES[currentBook],
          chapter: currentChapter,
          paragraphs: currentParagraphs.map(p => ({ text: p.trim() })).filter(p => p.text.length > 0),
        });
      }

      // Start new book
      if (bookNum >= startBook && bookNum <= endBook) {
        currentBook = bookNum;
        currentChapter = 1;
        inContent = true;
        currentParagraphs = [];
        console.log(`Found Book ${bookNum}`);
      } else {
        inContent = false;
      }
      continue;
    }

    if (!inContent || currentBook === null) continue;

    // Detect chapter markers
    const chapterNum = extractChapterNumber(trimmed);
    if (chapterNum !== null && chapterNum > 0 && chapterNum <= CHAPTER_COUNTS[currentBook]) {
      // Save previous chapter
      if (currentChapter !== null && currentParagraphs.length > 0) {
        chapters.push({
          book: currentBook,
          bookTitle: BOOK_NAMES[currentBook],
          chapter: currentChapter,
          paragraphs: currentParagraphs.map(p => ({ text: p.trim() })).filter(p => p.text.length > 0),
        });
      }

      // Start new chapter
      currentChapter = chapterNum;
      currentParagraphs = [];
      continue;
    }

    // Collect paragraph content
    if (currentChapter !== null) {
      // Skip short lines (likely headers)
      if (trimmed.length > 30 || (currentParagraphs.length > 0 && trimmed.length > 10)) {
        // Skip obvious headers/footers
        if (!trimmed.match(/^(Book|Chapter|Part|By|Written|Translated|Oxford|University|Press)/i)) {
          currentParagraphs.push(line);
        }
      }
    }
  }

  // Don't forget the last chapter
  if (currentBook !== null && currentChapter !== null && currentParagraphs.length > 0) {
    chapters.push({
      book: currentBook,
      bookTitle: BOOK_NAMES[currentBook],
      chapter: currentChapter,
      paragraphs: currentParagraphs.map(p => ({ text: p.trim() })).filter(p => p.text.length > 0),
    });
  }

  return chapters;
}

function main() {
  const inputFile = process.argv[2];
  const outputFile = process.argv[3];

  // Parse options
  let startBook = 3;
  let endBook = 14;
  const booksIdx = process.argv.indexOf('--books');
  if (booksIdx >= 0) {
    const range = process.argv[booksIdx + 1];
    const [start, end] = range.split('-').map(x => parseInt(x, 10));
    startBook = start;
    endBook = end;
  }

  if (!inputFile || !outputFile) {
    console.log(`Usage:`);
    console.log(`  node convert-raw-text-to-json.cjs <input.txt> <output.json> [--books START-END]`);
    console.log(`\nExample:`);
    console.log(`  node convert-raw-text-to-json.cjs data/text/ross-raw.txt data/text/ross_books_3-14.json --books 3-14`);
    process.exit(1);
  }

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  console.log(`\n=== Converting Raw Text to JSON ===`);
  console.log(`Input:  ${inputFile}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Books:  ${startBook}-${endBook}\n`);

  const text = fs.readFileSync(inputFile, 'utf-8');
  console.log(`Read ${(text.length / 1024 / 1024).toFixed(1)}MB from input file\n`);

  const chapters = parseRawText(text, startBook, endBook);

  console.log(`\nExtracted ${chapters.length} chapters\n`);

  // Summary by book
  const byBook = {};
  for (const ch of chapters) {
    if (!byBook[ch.book]) byBook[ch.book] = [];
    byBook[ch.book].push(ch.chapter);
  }

  for (let b = startBook; b <= endBook; b++) {
    const chs = byBook[b] || [];
    const expected = CHAPTER_COUNTS[b];
    const status = chs.length === expected ? '✓' : '!';
    console.log(`  Book ${String(b).padStart(2)}: ${String(chs.length).padStart(2)} chapters ${status} (expected ${expected})`);
  }

  // Write output
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(chapters, null, 2));

  console.log(`\n✓ Wrote ${chapters.length} chapters to ${outputFile}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
