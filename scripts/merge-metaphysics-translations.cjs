#!/usr/bin/env node
/**
 * Merges two metaphysics translations:
 * - Books 1-2: Original McMahon 1857 (from LibriVox audio)
 * - Books 3-14: W.D. Ross 1908 (new, cleaner translation)
 *
 * Creates a unified metaphysics.json with both translations.
 *
 * Usage:
 *   node merge-metaphysics-translations.cjs
 *   Options: --backup (saves original metaphysics.json as .backup)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const METAPHYSICS_FILE = path.join(ROOT, 'data', 'text', 'metaphysics.json');
const ROSS_FILE = path.join(ROOT, 'data', 'text', 'ross_books_3-14.json');
const OUTPUT_FILE = METAPHYSICS_FILE;
const BACKUP_FILE = METAPHYSICS_FILE + '.backup';

function main() {
  console.log(`\n=== Merging Metaphysics Translations ===`);
  console.log(`Books 1-2:  McMahon 1857 (original)`);
  console.log(`Books 3-14: W.D. Ross 1908 (new)\n`);

  // Read both files
  if (!fs.existsSync(ROSS_FILE)) {
    console.error(`Error: Ross books file not found: ${ROSS_FILE}`);
    console.error(`Run: node fetch-ross-from-mit.cjs first`);
    process.exit(1);
  }

  const mcmahon = JSON.parse(fs.readFileSync(METAPHYSICS_FILE, 'utf-8'));
  const ross = JSON.parse(fs.readFileSync(ROSS_FILE, 'utf-8'));

  // Extract Books 1-2 from McMahon
  const books1_2 = mcmahon.filter(ch => ch.book <= 2);
  console.log(`✓ Found Books 1-2: ${books1_2.length} chapters (McMahon)`);

  // Combine
  const merged = [...books1_2, ...ross];

  // Verify we have all expected books
  const bookNums = new Set(merged.map(ch => ch.book));
  console.log(`✓ Total books: ${bookNums.size} (${Array.from(bookNums).sort((a, b) => a - b).join(', ')})`);

  // Count chapters per book
  console.log(`\n=== Chapter Counts ===`);
  const EXPECTED = {
    1: 10, 2: 3, 3: 6, 4: 8, 5: 30, 6: 4, 7: 17, 8: 6,
    9: 10, 10: 10, 11: 12, 12: 10, 13: 10, 14: 6,
  };

  let totalChapters = 0;
  for (let b = 1; b <= 14; b++) {
    const chapters = merged.filter(ch => ch.book === b);
    const count = chapters.length;
    const expected = EXPECTED[b];
    const status = count === expected ? '✓' : '!';
    console.log(`  Book ${String(b).padStart(2)}: ${String(count).padStart(2)} chapters ${status} (expected ${expected})`);
    totalChapters += count;
  }

  console.log(`\nTotal: ${totalChapters} chapters`);

  // Backup original if requested
  if (process.argv.includes('--backup')) {
    if (!fs.existsSync(BACKUP_FILE)) {
      fs.copyFileSync(METAPHYSICS_FILE, BACKUP_FILE);
      console.log(`✓ Backed up original to: ${BACKUP_FILE}`);
    }
  }

  // Write merged file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(merged, null, 2));
  console.log(`\n✓ Wrote merged metaphysics.json: ${OUTPUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. node scripts/build-data-metaphysics.cjs  (rebuild app data)`);
  console.log(`  2. node scripts/generate-metaphysics-tts.cjs (generate TTS for books 3-14)`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
