// Assembles scraped Metaphysics (Aristotle, M'Mahon 1857 translation) text +
// the single audio/metaphysics/manifest.json into app/data-metaphysics.js for
// the reader app. Mirrors build-data-scg.cjs, but adapted for two things SCG
// didn't have to deal with:
//
//  1. A single flat text file (data/text/metaphysics.json — array of
//     {book, bookTitle, chapter, paragraphs}) instead of one file per book.
//  2. Audio that does NOT map 1:1 to chapters. There are 14 books with up to
//     30 chapters each, but only 52 audio tracks total, so each track spans
//     a *range* of chapters (every track stays within one book).
//
// TRACK -> BOOK/CHAPTER-RANGE MAPPING
// -----------------------------------------------------------------------
// The current audio/metaphysics files are named plainly and consistently —
// "01 - Book 1 Chapters 1-3.mp3", "04 - Book 1 Chapter 10.mp3", etc. — with
// book numbers that already match this edition's own Book/Chapter numbering
// directly (no LibriVox-style relabeling to correct for, unlike an older
// 32-track recording this script once targeted). So the mapping is parsed
// straight out of each track's filename at build time below, rather than
// kept as a hand-maintained table — which is important because a hardcoded
// table silently goes stale the moment the audio files themselves change
// (exactly what happened here: an earlier 32-track table was still in this
// file after the audio was replaced with the current, more finely segmented
// 52-track set, silently mismatching several chapters to the wrong track).
//
// A track's audio is assigned in full to every chapter it nominally covers —
// there's no way to derive exact in-track timestamps for each chapter
// boundary from the filename alone, so all chapters in a track share one
// audioFile/durationSeconds and the player lets the listener scrub within
// the track rather than jump to an exact chapter-start timestamp.
const TRACK_TITLE_PATTERN = /Book\s+(\d+)\s+Chapters?\s+(\d+)(?:\s*-\s*(\d+))?/i;

function parseTrackBookChapters(manifest) {
  const out = [];
  if (!manifest || !Array.isArray(manifest.tracks)) return out;
  manifest.tracks.forEach((t) => {
    const m = TRACK_TITLE_PATTERN.exec(t.file || t.title || '');
    if (!m) {
      console.warn(`  ⚠ Could not parse book/chapter range from track ${t.track} filename: ${t.file}`);
      return;
    }
    const book = parseInt(m[1], 10);
    const chapterStart = parseInt(m[2], 10);
    const chapterEnd = m[3] ? parseInt(m[3], 10) : chapterStart;
    out.push({ track: t.track, book, chapterStart, chapterEnd });
  });
  return out;
}

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
  // Parse each track's book/chapter range straight from its filename (see
  // header comment), then enrich with the actual manifest track data (file
  // name, duration) so lookups below have everything in one place.
  const trackMap = parseTrackBookChapters(manifest).map((t) => {
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
