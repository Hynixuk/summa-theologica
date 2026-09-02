#!/usr/bin/env node
/**
 * build-summaries.cjs
 *
 * Builds app/data-summaries.js from source summary files, normalizing all three
 * works into one consistent flat shape:
 *
 *   window.SUMMARIES = {
 *     st:           { books: { P1: {title, summary}, ... }, chapters: { P1Q1: "...", ... } },
 *     scg:          { books: { B1: {title, summary}, ... }, chapters: { B1C1: "...", ... } },
 *     metaphysics:  { overview: {title, content}, books: { B1: {title, summary}, ... }, chapters: { B1C1: "...", ... } }
 *   }
 *
 * `books` holds the longer (150-200 word) book/part-level summary, shown once at the
 * start of a book. `chapters` holds the shorter (20-40 word) per-chapter/question summary,
 * shown at the top of every chapter/question. Missing chapter entries are fine — the app
 * simply skips the box for that chapter — but book entries should exist for every book.
 *
 * Sources merged, later files win on key collisions:
 * - data/st-summaries.json               (ST book-level `parts`)
 * - data/summaries/st-part1-part2-complete.json / st-part3-complete.json / st-part4-complete.json (ST chapter-level)
 * - data/scg-summaries.json              (SCG book-level `books`)
 * - data/summaries/scg-book1-book2-complete.json / scg-book3-complete.json / scg-book4-complete.json (SCG chapter-level)
 * - data/metaphysics-summaries.json      (Metaphysics `overview` + book-level `books` array)
 * - data/summaries/metaphysics-chapters-complete.json (Metaphysics chapter-level)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const SUM_DIR = path.join(DATA, 'summaries');
const OUT_FILE = path.join(ROOT, 'app', 'data-summaries.js');

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error(`Error parsing ${filePath}: ${e.message}`);
    process.exit(1);
  }
}

// Merges any number of flat {key: text} objects into one, warning on true conflicts
// (same key, different non-empty value) so silent data loss during a rebuild is visible.
function mergeFlat(...sources) {
  const merged = {};
  for (const src of sources) {
    if (!src) continue;
    for (const key of Object.keys(src)) {
      if (merged[key] && merged[key] !== src[key]) {
        console.warn(`  Warning: overwriting "${key}"`);
      }
      merged[key] = src[key];
    }
  }
  return merged;
}

function buildST() {
  const bookLevel = loadJSON(path.join(DATA, 'st-summaries.json'));
  const books = {};
  if (bookLevel && bookLevel.parts) {
    for (const partKey of Object.keys(bookLevel.parts)) {
      const p = bookLevel.parts[partKey];
      books[partKey] = { title: p.title || partKey, summary: p.bookSummary || '' };
    }
  }

  // Chapter-level: prefer the complete per-question files; fall back to the sparse
  // "key questions" map inside st-summaries.json for anything not yet covered.
  const sparse = {};
  if (bookLevel && bookLevel.parts) {
    for (const partKey of Object.keys(bookLevel.parts)) {
      Object.assign(sparse, bookLevel.parts[partKey].questions || {});
    }
  }
  const complete1 = loadJSON(path.join(SUM_DIR, 'st-part1-part2-complete.json'));
  const complete3 = loadJSON(path.join(SUM_DIR, 'st-part3-complete.json'));
  const complete4 = loadJSON(path.join(SUM_DIR, 'st-part4-complete.json'));
  const chapters = mergeFlat(sparse, complete1, complete3, complete4);

  return { books, chapters };
}

function buildSCG() {
  const bookLevel = loadJSON(path.join(DATA, 'scg-summaries.json'));
  const books = {};
  if (bookLevel && bookLevel.books) {
    for (const bookKey of Object.keys(bookLevel.books)) {
      const b = bookLevel.books[bookKey];
      books[bookKey] = { title: b.title || bookKey, summary: b.bookSummary || '' };
    }
  }

  const sparse = {};
  if (bookLevel && bookLevel.books) {
    for (const bookKey of Object.keys(bookLevel.books)) {
      Object.assign(sparse, bookLevel.books[bookKey].chapters || {});
    }
  }
  const complete12 = loadJSON(path.join(SUM_DIR, 'scg-book1-book2-complete.json'));
  const complete3 = loadJSON(path.join(SUM_DIR, 'scg-book3-complete.json'));
  const complete4 = loadJSON(path.join(SUM_DIR, 'scg-book4-complete.json'));
  const chapters = mergeFlat(sparse, complete12, complete3, complete4);

  return { books, chapters };
}

function buildMetaphysics() {
  const bookLevel = loadJSON(path.join(DATA, 'metaphysics-summaries.json'));
  const books = {};
  let overview = null;
  if (bookLevel) {
    overview = bookLevel.overview || null;
    (bookLevel.books || []).forEach(function (b) {
      books['B' + b.book] = { title: b.title || ('Book ' + b.book), summary: b.summary || '' };
    });
  }

  const complete = loadJSON(path.join(SUM_DIR, 'metaphysics-chapters-complete.json'));
  const chapters = mergeFlat(complete);

  return { overview: overview, books: books, chapters: chapters };
}

function main() {
  console.log('Building summaries...');

  const st = buildST();
  const scg = buildSCG();
  const metaphysics = buildMetaphysics();

  const summaries = { st: st, scg: scg, metaphysics: metaphysics };

  const output =
    '// Auto-generated by scripts/build-summaries.cjs — do not edit by hand.\n' +
    '// Rebuild any time with: node scripts/build-summaries.cjs\n' +
    'window.SUMMARIES = ' + JSON.stringify(summaries, null, 2) + ';\n';

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, output, 'utf-8');

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  ST:           ${Object.keys(st.books).length} book summaries, ${Object.keys(st.chapters).length} question summaries`);
  console.log(`  SCG:          ${Object.keys(scg.books).length} book summaries, ${Object.keys(scg.chapters).length} chapter summaries`);
  console.log(`  Metaphysics:  ${Object.keys(metaphysics.books).length} book summaries, ${Object.keys(metaphysics.chapters).length} chapter summaries`);
}

main();
