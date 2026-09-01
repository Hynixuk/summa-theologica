// Lightweight watcher that periodically re-runs build-data-metaphysics.cjs's logic to
// keep app/data-metaphysics.js fresh as:
//   - a separate text-scraping agent (read-only from here) fills in / rewrites
//     data/text/metaphysics.json, and
//   - a separate audio download job (read-only from here, scripts/download-audio.cjs)
//     writes audio/metaphysics/*.mp3 + rewrites audio/metaphysics/manifest.json
// over time.
//
// This script is READ-ONLY with respect to data/text/metaphysics.json and
// audio/metaphysics/. It only reads those and writes app/data-metaphysics.js. It does
// not touch scrape-metaphysics.cjs or download-audio.cjs, and does not shell out to them.
//
// It does its own file scan on each tick (cheap: fs.statSync of two files) and skips
// rewriting data-metaphysics.js unless the underlying data actually changed (tracked via
// a simple content signature: file count + total mtime + total size), same trick as
// watch-scg-data.cjs / watch-alignment-index.cjs.
//
// The track -> book/chapter-range mapping (TRACK_BOOK_CHAPTERS) is duplicated from
// build-data-metaphysics.cjs rather than imported, so this file stays a fully
// self-contained drop-in like its siblings. If the mapping table in
// build-data-metaphysics.cjs ever changes, update it here too. See that file's header
// comment for the full explanation of how the mapping was derived and why it's
// hardcoded rather than parsed from track titles at runtime.
//
// Usage: node scripts/watch-metaphysics-data.cjs [intervalMinutes]
//   intervalMinutes defaults to 3. Runs indefinitely until killed (Ctrl+C).

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

const INTERVAL_MINUTES = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 3;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function watchedFiles() {
  return [TEXT_FILE, MANIFEST_FILE];
}

// Compute a cheap signature of the watched files (file count + sum of mtimes + sum of
// sizes) without reading any file bodies, so a no-change tick is nearly free. A missing
// file (text not scraped yet, or manifest not written yet) simply contributes 0 and is
// naturally picked up once it appears.
function computeSignature(files) {
  var existingCount = 0;
  var mtimeSum = 0;
  var sizeSum = 0;
  files.forEach(function (f) {
    try {
      const st = fs.statSync(f);
      existingCount++;
      mtimeSum += st.mtimeMs;
      sizeSum += st.size;
    } catch (e) {
      // Doesn't exist yet — ignore, contributes nothing to the signature.
    }
  });
  return existingCount + ':' + Math.round(mtimeSum) + ':' + sizeSum;
}

function loadText() {
  if (!fs.existsSync(TEXT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(TEXT_FILE, 'utf-8'));
  } catch (e) {
    // May be mid-write by the scraping agent — skip silently, picked up next tick.
    return null;
  }
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch (e) {
    // May be mid-write by the download job — skip silently, picked up next tick.
    return null;
  }
}

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

// Mirrors build-data-metaphysics.cjs's main() logic.
function buildData() {
  const flatText = loadText();
  const manifest = loadManifest();

  const tracksByNumber = {};
  if (manifest && Array.isArray(manifest.tracks)) {
    manifest.tracks.forEach((t) => { tracksByNumber[t.track] = t; });
  }
  const trackMap = TRACK_BOOK_CHAPTERS.map((t) => {
    const m = tracksByNumber[t.track] || null;
    return {
      ...t,
      file: m ? m.file : null,
      durationSeconds: m ? m.durationSeconds : null,
      title: m ? m.title : null,
    };
  });

  const chaptersByBook = {};
  if (flatText && Array.isArray(flatText)) {
    flatText.forEach((c) => {
      if (!chaptersByBook[c.book]) chaptersByBook[c.book] = new Map();
      chaptersByBook[c.book].set(c.chapter, c);
    });
  }

  const textIndex = {};
  const books = [];
  const perBookStats = [];

  for (let book = 1; book <= BOOK_COUNT; book++) {
    const chapterMap = chaptersByBook[book];
    if (!chapterMap || chapterMap.size === 0) {
      books.push({ book, bookTitle: null, roman: BOOK_ROMAN[book], chapters: [], hasAnyText: false });
      perBookStats.push({ book, withAudio: 0, total: 0, hasText: false });
      continue;
    }

    const sortedChapters = Array.from(chapterMap.values()).sort((a, b) => a.chapter - b.chapter);
    const bookTitle = sortedChapters[0].bookTitle || `Book ${BOOK_ROMAN[book]}`;
    var withAudio = 0;

    const chapterList = sortedChapters.map((c) => {
      const track = findTrackForChapter(book, c.chapter, trackMap);
      const key = `B${book}C${c.chapter}`;
      const hasAudio = !!(track && track.file);
      textIndex[key] = {
        book,
        chapter: c.chapter,
        title: null,
        paragraphs: c.paragraphs,
        hasAudio,
        audioFile: hasAudio ? `../audio/metaphysics/${track.file}` : null,
        audioTrack: track ? track.track : null,
        durationSeconds: track ? track.durationSeconds : null,
      };
      if (hasAudio) withAudio++;
      return { chapter: c.chapter, title: null, hasAudio, audioTrack: track ? track.track : null };
    });

    books.push({
      book,
      bookTitle,
      roman: BOOK_ROMAN[book],
      hasAnyText: true,
      chapters: chapterList,
    });
    perBookStats.push({ book, withAudio, total: chapterList.length, hasText: true });
  }

  return { books, textIndex, perBookStats };
}

function writeData(books, textIndex) {
  const out = [];
  out.push('// Auto-generated by scripts/build-data-metaphysics.cjs (kept fresh by scripts/watch-metaphysics-data.cjs) — do not edit by hand.');
  out.push('// Rebuild any time with: node scripts/build-data-metaphysics.cjs');
  out.push(`window.METAPHYSICS_BOOKS = ${JSON.stringify(books, null, 2)};`);
  out.push(`window.METAPHYSICS_TEXT = ${JSON.stringify(textIndex, null, 2)};`);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out.join('\n') + '\n', 'utf-8');
}

let lastSignature = null;

function tick() {
  var files;
  try {
    files = watchedFiles();
  } catch (e) {
    console.error('[watch-metaphysics-data] scan failed: ' + e.message);
    return;
  }

  const signature = computeSignature(files);
  if (signature === lastSignature) {
    // Nothing changed since last tick — stay quiet.
    return;
  }

  const { books, textIndex, perBookStats } = buildData();
  writeData(books, textIndex);
  lastSignature = signature;

  const ts = new Date().toISOString();
  const withText = perBookStats.filter((s) => s.hasText);
  const summary = withText.length
    ? withText.map((s) => `Book${s.book} ${s.withAudio}/${s.total}`).join(', ')
    : 'no text yet';
  console.log('[' + ts + '] Refreshed data-metaphysics.js: ' + summary + ' chapters with audio');
}

console.log(
  '[watch-metaphysics-data] Starting. Watching ' + TEXT_FILE + ' + ' + MANIFEST_FILE +
  ' every ' + INTERVAL_MINUTES + ' minute(s). Writing ' + OUT_FILE +
  '. Read-only w.r.t. data/text/ and audio/. Ctrl+C to stop.'
);

tick(); // initial refresh so data-metaphysics.js is fresh as soon as this starts
setInterval(tick, INTERVAL_MS);
