#!/usr/bin/env node
/**
 * Downloads the W.D. Ross 1908 translation of Aristotle's Metaphysics
 * from archive.org and converts it to metaphysics.json format.
 *
 * The Ross translation (1908) is superior to the current McMahon text because:
 * - Published 1908, solidly public domain (pre-1928 US copyright)
 * - Much cleaner OCR with fewer artifacts
 * - Scholarly, precise translation by the Oxford scholar W.D. Ross
 * - Consistent with academic standard for Metaphysics scholarship
 *
 * Archive source: https://archive.org/details/metaphysics-aristotle-w.d.ross
 * (full text available as DJVU OCR transcription)
 *
 * Usage:
 *   node download-ross-translation.cjs <books>
 *   books: "3-14" (for books 3-14 only, merging with existing 1-2)
 *          "all"  (for all 14 books)
 *          defaults to "3-14"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const ARCHIVE_ID = 'metaphysics-aristotle-w.d.ross';
const ARCHIVE_OCRTXT_URL = `https://archive.org/stream/${ARCHIVE_ID}/${ARCHIVE_ID}_djvu.txt`;

// Book names matching the schema
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

// Canonical chapter counts (Bekker numbering)
const CHAPTER_COUNTS = {
  1: 10, 2: 3, 3: 6, 4: 8, 5: 30, 6: 4, 7: 17, 8: 6,
  9: 10, 10: 10, 11: 12, 12: 10, 13: 10, 14: 6,
};

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Parses the OCR'd Ross text file from archive.org.
 * Returns array of {book, chapter, paragraphs: [{text}]}
 */
function parseRossText(fullText) {
  // This is a placeholder for actual parsing logic.
  // The real implementation would:
  // 1. Split text by Book markers (Book I, Book II, etc.)
  // 2. Split each book by Chapter markers
  // 3. Clean OCR artifacts (less than in McMahon)
  // 4. Group text into paragraphs
  //
  // For now, return a template showing what data structure to build.
  console.log('Parsing Ross text... (placeholder - see implementation notes)');
  console.log('Text length:', fullText.length);
  console.log('First 500 chars:', fullText.substring(0, 500));
  return [];
}

async function main() {
  const booksArg = process.argv[2] || '3-14';

  console.log(`Downloading Ross translation (${booksArg}) from archive.org...`);
  console.log(`Source: ${ARCHIVE_OCRTXT_URL}`);

  try {
    const fullText = await fetchUrl(ARCHIVE_OCRTXT_URL);
    console.log(`Downloaded ${fullText.length} characters`);

    const chapters = parseRossText(fullText);
    console.log(`Parsed ${chapters.length} chapters`);

    // TODO: Write to metaphysics.json with proper merge logic
    // TODO: Update data-metaphysics.js with build-data-metaphysics.cjs

  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
