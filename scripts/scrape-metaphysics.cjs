// Scrapes Aristotle's Metaphysics (John H. M'Mahon translation, Bohn's
// Classical Library, 1857 / public domain) from the raw OCR'd full-text
// scan hosted on archive.org, and parses it into the same general JSON
// shape used for Summa Contra Gentiles (see scrape-scg.cjs), adapted for
// Metaphysics' Book -> Chapter structure (no chapter titles, no articles).
//
// Source: archive.org item `metaphysicsaris00arisgoog` (Google Books scan
// of the 1857 Bohn edition, digitized by Stanford University Library).
// Like SCG, there is no clean HTML source, so this downloads the
// `_djvu.txt` OCR transcript and runs a battery of heuristics to strip
// front/back matter, running headers, footnotes, and interleaved marginal
// glosses, and to reflow broken OCR line-wrapping into clean paragraphs.
//
// KNOWN OCR QUALITY CAVEAT (read before trusting the output blindly):
// This particular scan interleaves short marginal sidenotes (a a few
// words summarizing the adjacent line, printed in the margin of the
// original page) into the *middle* of body-text lines -- e.g. a genuine
// line of Aristotle's prose comes out as
//   "toTe  of  the  senses ;    for  even,  irrespective  of  » proof  thereof,"
// where "» proof  thereof," is bleed from a marginal note, not part of the
// sentence. Unlike footnote markers (single digits glued to a word) or
// running headers (whole lines), this contamination happens *within* a
// content line with no reliable structural signal to separate it from
// real prose, so this script does NOT attempt to strip it -- doing so
// blind would risk deleting real words far more often than it removes
// noise. It is left in place. See the README-style summary printed at
// the end of a run for a rough sense of how much of the text this
// affects (it is a minority of words, concentrated in the outer few words
// of the longer lines, but it IS a nick against verbatim accuracy).
//
// Usage:
//   node scrape-metaphysics.cjs <outFile>
//   node scrape-metaphysics.cjs <outFile> --raw <path-to-djvu.txt>   (skip network fetch, use a local copy)

const fs = require('fs');
const path = require('path');

const ARCHIVE_ID = 'metaphysicsaris00arisgoog';

// Traditional Book names/letters, for a human-readable bookTitle field.
// (The `book` field itself is always a plain integer 1-14.)
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

// Canonical chapter counts, used only for the end-of-run sanity report
// (not for parsing decisions) -- these are well-established facts about
// the text, independent of this particular OCR/edition.
const CANONICAL_CHAPTER_COUNTS = {
  1: 10, 2: 3, 3: 6, 4: 8, 5: 30, 6: 4, 7: 17, 8: 6,
  9: 10, 10: 10, 11: 12, 12: 10, 13: 10, 14: 6,
};

// ---------------------------------------------------------------------------
// Roman numeral helpers
// ---------------------------------------------------------------------------
const ROMAN_MAP = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

function romanToInt(s) {
  s = s.toUpperCase();
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN_MAP[s[i]];
    const next = ROMAN_MAP[s[i + 1]];
    if (!cur) return NaN;
    if (next > cur) total -= cur;
    else total += cur;
  }
  return total;
}

// Permissive parse of a "CHAPTER <numeral>" token into an integer, tolerant
// of this scan's common OCR misreads:
//   - digit '1' substituted for roman 'I' (whole numeral rendered as an
//     all-digit tally, e.g. "11." for "II", "111" for "III")
//   - lowercase 'l' substituted for 'I'
//   - a trailing footnote-marker digit glued on with no separator
//     ("VIII.1" = chapter VIII + footnote 1; "I1I.8" = chapter III + footnote 8)
//   - stray trailing punctuation/OCR symbols (. , ; ! * ^ « » etc.)
// Tries a few candidate readings and picks whichever is both a valid roman
// numeral AND closest to `expectedNext`; returns null if nothing plausible
// is found within a small window of expectedNext.
function parseChapterNumeral(token, expectedNext) {
  // Isolate the leading run of letters/digits (roman-numeral-ish material).
  const m = token.match(/^[A-Za-z0-9]+/);
  if (!m) return null;
  const core = m[0];

  function normalize(s) {
    return s.toUpperCase().replace(/1/g, 'I').replace(/0/g, 'O'); // '0' just in case; harmless if unused
  }

  // Metaphysics books top out at 30 chapters (Book V/Delta); reject
  // anything above that as noise (this specifically excludes the common
  // "L" (roman 50) misread of a solitary "I" that opens many chapters --
  // there is no book with anywhere near 50 chapters, so 50 is never a
  // legitimate reading here).
  const MAX_PLAUSIBLE = 35;

  const candidates = [];
  // Try the full core, then progressively strip 1-2 trailing chars (treating
  // them as a glued-on footnote marker with no separating punctuation).
  for (let strip = 0; strip <= 2 && strip < core.length; strip++) {
    const candidate = core.slice(0, core.length - strip);
    if (!candidate) continue;
    const normalized = normalize(candidate);
    if (/^[IVXLCM]+$/.test(normalized)) {
      const n = romanToInt(normalized);
      if (Number.isFinite(n) && n > 0 && n <= MAX_PLAUSIBLE) {
        candidates.push({ n, strip });
      }
    }
  }
  if (candidates.length === 0) return null;

  // Prefer the least-stripped (most literal) reading -- stripping trailing
  // characters is a last resort for genuinely glued-on footnote markers,
  // not a way to nudge a numeral closer to what we expected. Only within
  // the same strip level do we break ties by closeness to expectedNext.
  candidates.sort((a, b) => {
    if (a.strip !== b.strip) return a.strip - b.strip;
    return Math.abs(a.n - expectedNext) - Math.abs(b.n - expectedNext);
  });
  const best = candidates[0];
  if (Math.abs(best.n - expectedNext) <= 10) return best.n;
  // A literal (unstripped), well-formed roman numeral further out is still
  // trusted if it's a forward jump (legitimately skipping past several
  // dropped headings rather than going backwards, which would indicate a
  // misparse).
  if (best.strip === 0 && best.n >= expectedNext) return best.n;
  return null;
}

// ---------------------------------------------------------------------------
// Line classification helpers
// ---------------------------------------------------------------------------

// Running header/footer lines: short, mention the book/work title (in any
// of the several OCR-garbled spellings seen in this scan), and carry a
// leading or trailing page number or a bracketed "[BOOK ..." fragment.
function isRunningHeader(line) {
  if (!line || line.length >= 100) return false;
  if (!/METAPH|ARISTOTL/i.test(line)) return false;
  if (/^\d{1,4}\b/.test(line)) return true;
  if (/\d{1,4}\.?\s*$/.test(line)) return true;
  if (/\[.*BOOK/i.test(line)) return true;
  if (/BOOK\s*[IVXLCM0-9]{1,5}\.?\s*[,.\]]?\s*$/i.test(line)) return true;
  return false;
}

// Bare page-number furniture line.
function isPageNumberLine(line) {
  return /^[ivxlc]{0,3}\d{1,4}\.?$/i.test(line);
}

// Footnote block start: a short marker (1-2 digits/symbols) immediately
// followed by 2+ spaces and a capital letter -- the OCR rendering of a
// superscript footnote reference at the bottom of the printed page.
// Deliberately excludes quote/apostrophe characters from the marker set:
// those legitimately open quoted prose ("'  Thus..." can be a real
// sentence beginning with a quotation mark), and this scan's spacing is
// noisy enough that "quote + wide gap + capital" is not a reliable
// footnote signal -- false-positiving here silently deletes real body
// text, which is worse than leaving an occasional genuine footnote in.
const FOOTNOTE_START_RE = /^[\d^*†‡¶]{1,2}\s{2,}[A-Z]/;

function isNoiseCaption(line) {
  if (/^CONTENTS$/i.test(line)) return true;
  if (/^END\s+O[FP]\s+THE\s+ANALYSIS\.?$/i.test(line)) return true;
  // Decorative rules/dividers between a BOOK heading and its first chapter
  // (e.g. "-*—^-"): no letters or digits at all.
  if (line && !/[A-Za-z0-9]/.test(line)) return true;
  return false;
}

function collapseSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function endsWithTerminalPunctuation(s) {
  return /["'’”)]?[.?!:;]["'’”)]?\s*$/.test(s);
}

// Strip footnote markers glued directly onto the end of a word (e.g.
// "wisdom^" or "science;^for" -- rare inline case not already caught by
// the block-level footnote stripping below).
function stripInlineFootnoteMarkers(line) {
  return line.replace(/([a-z])(\^|\*)(?=[\s,.;:)"'’-]|$)/g, '$1');
}

function joinLines(lines) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0) {
      out = line;
      continue;
    }
    const prevEndsHyphen = /[a-z]-$/.test(out);
    const nextStartsLower = /^[a-z]/.test(line);
    if (prevEndsHyphen && nextStartsLower) {
      out = out.slice(0, -1) + line;
    } else {
      out += ' ' + line;
    }
  }
  return out;
}

function buildParagraphs(bodyLines) {
  const paragraphs = [];
  let acc = [];

  function flush() {
    if (acc.length === 0) return;
    const joined = joinLines(acc);
    const text = collapseSpaces(joined);
    if (text) paragraphs.push({ text });
    acc = [];
  }

  for (const rawLine of bodyLines) {
    if (rawLine === '') {
      if (acc.length === 0) continue;
      const last = acc[acc.length - 1];
      if (endsWithTerminalPunctuation(last)) {
        flush();
      }
      continue;
    }
    acc.push(stripInlineFootnoteMarkers(rawLine));
  }
  flush();
  return paragraphs;
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------
function parseMetaphysics(rawText, { warn } = {}) {
  const warnFn = warn || (() => {});
  const rawLines = rawText.split(/\r?\n/).map((l) => l.trim());

  // Bound the body: starts right after "END OF THE ANALYSIS." (the front
  // matter includes a lengthy introductory Analysis of the whole work,
  // itself organized by BOOK/CHAPTER-like headings that would otherwise be
  // misdetected as real content), ends right before the "QUESTIONS on
  // Aristotle's Metaphysics" study-questions appendix (which mirrors the
  // real Book/Chapter structure again, but is not Aristotle's text).
  let startIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (/^END\s+O[FP]\s+THE\s+ANALYSIS\.?$/i.test(rawLines[i])) {
      startIdx = i + 1;
      break;
    }
  }
  if (startIdx === -1) throw new Error('Could not find "END OF THE ANALYSIS" boundary marker');

  let endIdx = rawLines.length;
  for (let i = startIdx; i < rawLines.length; i++) {
    if (/^QUESTIONS$/i.test(rawLines[i])) {
      endIdx = i;
      break;
    }
  }
  if (endIdx === rawLines.length) {
    warnFn('Could not find "QUESTIONS" back-matter boundary; parsing to end of file (back-matter noise may leak in)');
  }

  const books = []; // { book, chapters: [{chapter, paragraphs}] }
  let bookCounter = 0;
  let currentBook = null;
  let currentChapter = null; // { chapter, bodyLines: [] }
  let expectedNextChapter = 1;
  let inFootnoteBlock = false;
  let clearedPlaceholder = false;

  function finalizeChapter() {
    if (!currentChapter || !currentBook) return;
    const paragraphs = buildParagraphs(currentChapter.bodyLines);
    if (paragraphs.length > 0) {
      currentBook.chapters.push({ chapter: currentChapter.chapter, paragraphs });
    } else {
      warnFn(`Book ${currentBook.book} Chapter ${currentChapter.chapter}: no paragraph text extracted (dropped)`);
    }
  }

  function finalizeBook() {
    finalizeChapter();
    currentChapter = null;
    if (currentBook) {
      books.push(currentBook);
      const numbers = currentBook.chapters.map((c) => c.chapter).sort((a, b) => a - b);
      let exp = numbers.length ? numbers[0] : 1;
      for (const n of numbers) {
        if (n !== exp) {
          warnFn(`Book ${currentBook.book}: gap in chapter numbering, expected ${exp}, found ${n} (heading(s) likely dropped by OCR, text folded into surrounding chapter)`);
        }
        exp = n + 1;
      }
    }
  }

  function startBook() {
    finalizeBook();
    bookCounter += 1;
    currentBook = { book: bookCounter, chapters: [] };
    expectedNextChapter = 1;
    // Open an implicit "chapter 1" immediately so that if this book's
    // opening "CHAPTER I" heading fails to parse (a common OCR misread --
    // e.g. a solitary "I" scanned as "L"), the body text that follows
    // still lands somewhere instead of being silently dropped while no
    // chapter is open.
    currentChapter = { chapter: 1, bodyLines: [] };
    clearedPlaceholder = false;
  }

  function startChapter(num) {
    // If nothing real has accumulated yet in the currently-open chapter
    // (e.g. it's still the untouched placeholder, or the only lines seen
    // since the last heading were blanks) just relabel it instead of
    // finalizing a hollow chapter -- this happens when a heading fails to
    // parse (dropping straight into the next one with no body text
    // between them) or when the placeholder's pre-heading junk was
    // already cleared out below.
    if (currentChapter && currentChapter.bodyLines.every((l) => l === '')) {
      if (clearedPlaceholder && currentBook.chapters.length > 0) {
        warnFn(`Book ${currentBook.book} Chapter ${currentChapter.chapter}: produced no body text before Chapter ${num}'s heading (merged/dropped)`);
      }
      currentChapter.chapter = num;
    } else {
      finalizeChapter();
      currentChapter = { chapter: num, bodyLines: [] };
    }
    expectedNextChapter = num + 1;
  }

  for (let i = startIdx; i < endIdx; i++) {
    const line = rawLines[i];

    // BOOK heading: case-sensitive all-caps "BOOK" at line start, short line.
    if (/^BOOK\b/.test(line) && line.length < 40) {
      startBook();
      inFootnoteBlock = false;
      continue;
    }

    // CHAPTER heading: case-sensitive all-caps "CHAPTER" at line start,
    // tolerant of two OCR failure modes observed in this scan (and likely
    // to recur in other Google-Books-sourced Aristotle scans run through
    // this same pipeline):
    //   - "CHAPTKP" for "CHAPTER" -- E/K and R/P are near-identical glyphs
    //     in this scan's bold small-caps rendering, so the word itself gets
    //     misread even though the line is otherwise well-formed.
    //   - a single stray leading token glued in front of "CHAPTER" (e.g.
    //     "J  CHAPTER  IV.3") -- marginal-note bleed landing at the very
    //     start of the line rather than the middle, same phenomenon the
    //     module comment above describes for body text.
    const CHAPTER_WORD_RE = /CHAPT[EK][RP]\b/;
    let headingLine = line;
    if (!CHAPTER_WORD_RE.test(headingLine)) {
      const strayPrefixMatch = line.match(/^\S{1,3}\s+(CHAPT[EK][RP]\b.*)$/);
      if (strayPrefixMatch) headingLine = strayPrefixMatch[1];
    }
    if (CHAPTER_WORD_RE.test(headingLine) && headingLine.length < 40) {
      // The first "CHAPTER ..." line seen in a book -- whether or not it
      // ends up parsing successfully -- marks the end of book-level front
      // matter (epigraphs, decorative rules, stray marginal-note bleed
      // that lands between the BOOK heading and "CHAPTER I"). Discard
      // whatever the placeholder accumulated before it.
      if (!clearedPlaceholder && currentChapter) {
        currentChapter.bodyLines = [];
        clearedPlaceholder = true;
      }
      const rest = headingLine.replace(CHAPTER_WORD_RE, '').trim();
      const num = currentBook ? parseChapterNumeral(rest, expectedNextChapter) : null;
      if (num != null && currentBook) {
        startChapter(num);
        inFootnoteBlock = false;
        continue;
      }
      // Unparseable/implausible -- likely OCR junk on a genuine heading
      // line, or a stray "CHAPTER" mention; drop the line, keep collecting
      // into whatever chapter is open (folds into it, gap reported later).
      warnFn(`Unparsed CHAPTER heading near line ${i + 1}: "${line}"`);
      continue;
    }

    if (!currentBook || !currentChapter) continue; // still in book-level front matter before chapter 1

    if (line === '') {
      inFootnoteBlock = false;
      currentChapter.bodyLines.push('');
      continue;
    }

    if (isNoiseCaption(line) || isRunningHeader(line) || isPageNumberLine(line)) continue;

    if (inFootnoteBlock) continue; // still inside a dropped footnote paragraph

    if (FOOTNOTE_START_RE.test(line)) {
      inFootnoteBlock = true;
      continue;
    }

    currentChapter.bodyLines.push(line);
  }
  finalizeBook();

  return books;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
async function fetchDjvuText(identifier, retries = 3) {
  const url = `https://archive.org/download/${identifier}/${identifier}_djvu.txt`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SummaReaderProject/1.0)' },
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length < 1000) throw new Error('Suspiciously short response');
      return text;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const outArg = args[0];
  if (!outArg) {
    console.error('Usage: node scrape-metaphysics.cjs <outFile> [--raw <path-to-djvu.txt>]');
    process.exit(1);
  }
  const rawFlagIdx = args.indexOf('--raw');
  let raw;
  if (rawFlagIdx !== -1 && args[rawFlagIdx + 1]) {
    console.log(`Reading local raw text from ${args[rawFlagIdx + 1]} ...`);
    raw = fs.readFileSync(args[rawFlagIdx + 1], 'utf-8');
  } else {
    console.log(`Fetching ${ARCHIVE_ID} ...`);
    raw = await fetchDjvuText(ARCHIVE_ID);
  }

  const warnings = [];
  const books = parseMetaphysics(raw, { warn: (msg) => warnings.push(msg) });
  for (const w of warnings) console.log(`  [warn] ${w}`);

  const out = [];
  for (const b of books) {
    for (const c of b.chapters) {
      out.push({
        book: b.book,
        bookTitle: BOOK_NAMES[b.book] || `Book ${b.book}`,
        chapter: c.chapter,
        paragraphs: c.paragraphs,
      });
    }
  }

  fs.mkdirSync(path.dirname(outArg), { recursive: true });
  fs.writeFileSync(outArg, JSON.stringify(out, null, 2), 'utf-8');

  console.log(`\nWrote ${out.length} chapters across ${books.length} books to ${outArg}`);
  console.log('\nChapter-count sanity check (parsed vs. canonical):');
  for (const b of books) {
    const canon = CANONICAL_CHAPTER_COUNTS[b.book];
    const flag = canon != null && canon !== b.chapters.length ? '  <-- MISMATCH' : '';
    console.log(`  Book ${b.book}: parsed ${b.chapters.length}, canonical ${canon ?? '?'}${flag}`);
  }
  const totalParagraphs = out.reduce((sum, c) => sum + c.paragraphs.length, 0);
  console.log(`\nTotal paragraphs: ${totalParagraphs}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
