// Assembles scraped Metaphysics (Aristotle, M'Mahon 1857 translation) text +
// the single audio/metaphysics/manifest.json into app/data-metaphysics.js for
// the reader app. Mirrors build-data-scg.cjs, but adapted for two things SCG
// didn't have to deal with:
//
//  1. A single flat text file (data/text/metaphysics.json — array of
//     {book, bookTitle, chapter, paragraphs}) instead of one file per book.
//  2. Audio that does NOT map 1:1 to chapters. There are 14 books with up to
//     30 chapters each, but only 32 LibriVox tracks total, so each track
//     spans a *range* of chapters (and every track stays within one book —
//     verified below, no track crosses a book boundary).
//
// TRACK -> BOOK/CHAPTER-RANGE MAPPING (the hard part)
// -----------------------------------------------------------------------
// LibriVox's track titles look like "Book I Chapters 1-3", "Book I (the
// Less) Chapters 1-3", "Book II Chapters 4-6", etc. Two things make this
// NOT a simple "parse the roman numeral" job:
//
//   (a) Typos in the actual titles ("14 - Book VI Chaptes 1-5", "22 - Boox
//       IX Chapters 5-10") make a fully-general regex fragile.
//   (b) LibriVox's book *labeling* scheme does not match this translation's
//       internal book numbering. The text scraper (scrape-metaphysics.cjs)
//       numbers books 1-14 sequentially, where book 2 is "Book II (α, "the
//       Less")" — i.e. it already burns a roman-numeral slot on the "Less"
//       book. LibriVox instead calls that book "Book I (the Less)" (as if
//       it were a variant of Book I, not its own numbered book), and then
//       reuses "Book II" for what the text calls Book III, "Book III" for
//       the text's Book IV, ... up through "Book XIII" for the text's Book
//       14. So every LibriVox roman numeral from II upward is the text's
//       book number MINUS 1, and "Book I (the Less)" is the text's book 2.
//
// Given both, the safest approach is to hardcode the 32-entry table below
// rather than regex-parse titles at runtime. It was derived by:
//   1. Reading every track title in audio/metaphysics/manifest.json once
//      the audio download finished (all 32 present).
//   2. Applying the label-shift rule above to get each track's internal
//      book number.
//   3. Cross-checking the resulting per-book chapter coverage against the
//      well-established canonical chapter counts for each book (10, 3, 6,
//      8, 30, 4, 17, 6, 10, 10, 12, 10, 10, 6 for books 1-14 respectively —
//      see CANONICAL_CHAPTER_COUNTS in scrape-metaphysics.cjs) — every book
//      except Book 1 lines up exactly (tracks 1-3 cover chapters 1-9 of a
//      canonically-10-chapter book; the actual OCR'd text also only yielded
//      chapters 1, 3-9 for Book 1, i.e. the scrape independently lost the
//      same tail, which is corroborating rather than concerning).
//
// This table is APPROXIMATE in the sense that a track's audio is assigned
// in full to every chapter it nominally covers — there's no way to derive
// exact in-track timestamps for each chapter boundary from a LibriVox
// title, so all chapters in a track share one audioFile/durationSeconds and
// the player will need to let the listener scrub within the track rather
// than jump to an exact chapter-start timestamp. If per-chapter timestamps
// are ever wanted, they'd have to come from manual listening or forced
// alignment (see align-corpus.mjs for the machinery used elsewhere in this
// project), not from this table.
const TRACK_BOOK_CHAPTERS = [
  { track: 1, book: 1, chapterStart: 1, chapterEnd: 3 },
  { track: 2, book: 1, chapterStart: 4, chapterEnd: 7 },
  { track: 3, book: 1, chapterStart: 8, chapterEnd: 9 },
  { track: 4, book: 2, chapterStart: 1, chapterEnd: 3 },
  { track: 5, book: 3, chapterStart: 1, chapterEnd: 3 },
  { track: 6, book: 3, chapterStart: 4, chapterEnd: 6 },
  { track: 7, book: 4, chapterStart: 1, chapterEnd: 3 },
  { track: 8, book: 4, chapterStart: 4, chapterEnd: 4 },
  { track: 9, book: 4, chapterStart: 5, chapterEnd: 8 },
  { track: 10, book: 5, chapterStart: 1, chapterEnd: 6 },
  { track: 11, book: 5, chapterStart: 7, chapterEnd: 15 },
  { track: 12, book: 5, chapterStart: 16, chapterEnd: 30 },
  { track: 13, book: 6, chapterStart: 1, chapterEnd: 4 },
  { track: 14, book: 7, chapterStart: 1, chapterEnd: 5 },
  { track: 15, book: 7, chapterStart: 6, chapterEnd: 9 },
  { track: 16, book: 7, chapterStart: 10, chapterEnd: 12 },
  { track: 17, book: 7, chapterStart: 13, chapterEnd: 17 },
  { track: 18, book: 8, chapterStart: 1, chapterEnd: 6 },
  { track: 19, book: 9, chapterStart: 1, chapterEnd: 7 },
  { track: 20, book: 9, chapterStart: 8, chapterEnd: 10 },
  { track: 21, book: 10, chapterStart: 1, chapterEnd: 4 },
  { track: 22, book: 10, chapterStart: 5, chapterEnd: 10 },
  { track: 23, book: 11, chapterStart: 1, chapterEnd: 5 },
  { track: 24, book: 11, chapterStart: 6, chapterEnd: 9 },
  { track: 25, book: 11, chapterStart: 10, chapterEnd: 12 },
  { track: 26, book: 12, chapterStart: 1, chapterEnd: 6 },
  { track: 27, book: 12, chapterStart: 7, chapterEnd: 10 },
  { track: 28, book: 13, chapterStart: 1, chapterEnd: 4 },
  { track: 29, book: 13, chapterStart: 5, chapterEnd: 7 },
  { track: 30, book: 13, chapterStart: 8, chapterEnd: 10 },
  { track: 31, book: 14, chapterStart: 1, chapterEnd: 3 },
  { track: 32, book: 14, chapterStart: 4, chapterEnd: 6 },
];

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEXT_FILE = path.join(ROOT, 'data', 'text', 'metaphysics.json');
const MANIFEST_FILE = path.join(ROOT, 'audio', 'metaphysics', 'manifest.json');
const OUT_FILE = path.join(ROOT, 'app', 'data-metaphysics.js');

const BOOK_COUNT = 14;
const BOOK_ROMAN = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII',
  8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII', 13: 'XIII', 14: 'XIV',
};

function loadText() {
  if (!fs.existsSync(TEXT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TEXT_FILE, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse ${TEXT_FILE}: ${e.message}`);
    return null;
  }
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse ${MANIFEST_FILE}: ${e.message}`);
    return null;
  }
}

// Given a chapter number within a book, find the track (if any) whose
// nominal range covers it, per TRACK_BOOK_CHAPTERS. Falls back to
// extending the book's *last* known track by up to 1 trailing chapter if
// the chapter falls just past every declared range — a small allowance
// for the same kind of off-by-one slack that shows up between LibriVox
// titles and canonical chapter counts (see header comment).
function findTrackForChapter(book, chapter, enrichedTracks) {
  const bookTracks = enrichedTracks.filter((t) => t.book === book);
  for (const t of bookTracks) {
    if (chapter >= t.chapterStart && chapter <= t.chapterEnd) return t;
  }
  if (bookTracks.length) {
    const last = bookTracks[bookTracks.length - 1];
    if (chapter === last.chapterEnd + 1) return last;
  }
  return null;
}

function main() {
  const flatText = loadText();
  const manifest = loadManifest();

  const tracksByNumber = {};
  if (manifest && Array.isArray(manifest.tracks)) {
    manifest.tracks.forEach((t) => { tracksByNumber[t.track] = t; });
  }
  // Enrich TRACK_BOOK_CHAPTERS entries with the actual manifest track data
  // (file name, duration) so lookups below have everything in one place.
  const trackMap = TRACK_BOOK_CHAPTERS.map((t) => {
    const m = tracksByNumber[t.track] || null;
    return {
      ...t,
      file: m ? m.file : null,
      durationSeconds: m ? m.durationSeconds : null,
      title: m ? m.title : null,
    };
  });

  // Group text chapters by book. The OCR-derived source can contain
  // duplicate chapter numbers within a book (a heading detected twice) or
  // gaps (a heading missed entirely) — see scrape-metaphysics.cjs's own
  // warnings for specifics. Duplicates are deduped here, keeping the LAST
  // occurrence (mirrors plain JS object key overwrite semantics, and in
  // practice the later occurrence is the one that picked up the bulk of
  // that chapter's body text before the *next* heading was found).
  const chaptersByBook = {};
  if (flatText && Array.isArray(flatText)) {
    flatText.forEach((c) => {
      if (!chaptersByBook[c.book]) chaptersByBook[c.book] = new Map();
      chaptersByBook[c.book].set(c.chapter, c); // later entries overwrite earlier dupes
    });
  }

  const textIndex = {}; // "B{book}C{chapter}" -> chapter object (+ audio fields)
  const books = [];
  let totalChapters = 0;
  let chaptersWithAudio = 0;

  for (let book = 1; book <= BOOK_COUNT; book++) {
    const chapterMap = chaptersByBook[book];
    if (!chapterMap || chapterMap.size === 0) {
      books.push({ book, bookTitle: null, roman: BOOK_ROMAN[book], chapters: [], hasAnyText: false });
      continue;
    }

    const sortedChapters = Array.from(chapterMap.values()).sort((a, b) => a.chapter - b.chapter);
    const bookTitle = sortedChapters[0].bookTitle || `Book ${BOOK_ROMAN[book]}`;

    const chapterList = sortedChapters.map((c) => {
      const track = findTrackForChapter(book, c.chapter, trackMap);
      const key = `B${book}C${c.chapter}`;
      const entry = {
        book,
        chapter: c.chapter,
        title: null, // Metaphysics chapters are unnamed in this translation
        paragraphs: c.paragraphs,
        hasAudio: !!(track && track.file),
        audioFile: track && track.file ? key : null,
        audioTrack: track ? track.track : null,
        durationSeconds: track ? track.durationSeconds : null,
      };
      textIndex[key] = entry;
      totalChapters++;
      if (entry.hasAudio) chaptersWithAudio++;
      return {
        chapter: c.chapter,
        title: null,
        hasAudio: entry.hasAudio,
        audioTrack: entry.audioTrack,
      };
    });

    books.push({
      book,
      bookTitle,
      roman: BOOK_ROMAN[book],
      hasAnyText: true,
      chapters: chapterList,
    });
  }

  const out = [];
  out.push('// Auto-generated by scripts/build-data-metaphysics.cjs — do not edit by hand.');
  out.push(`window.METAPHYSICS_BOOKS = ${JSON.stringify(books, null, 2)};`);
  out.push(`window.METAPHYSICS_TEXT = ${JSON.stringify(textIndex, null, 2)};`);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out.join('\n') + '\n', 'utf-8');

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  Text file present: ${!!flatText}`);
  console.log(`  Manifest present: ${!!manifest} (${manifest ? manifest.tracks.length : 0} tracks)`);
  console.log(`  Chapters loaded: ${totalChapters}`);
  console.log(`  Chapters with audio: ${chaptersWithAudio}/${totalChapters}`);
  books.forEach((b) => {
    if (!b.hasAnyText) { console.log(`  Book ${b.book}: no text yet`); return; }
    const withAudio = b.chapters.filter((c) => c.hasAudio).length;
    console.log(`  Book ${b.book} (${b.bookTitle}): ${b.chapters.length} chapters, ${withAudio} with audio`);
  });
}

main();
