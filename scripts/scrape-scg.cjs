// Scrapes Summa Contra Gentiles (English Dominican Fathers translation,
// Burns Oates & Washbourne, 1923-1929 / public domain) from raw OCR'd
// full-text scans hosted on archive.org, and parses it into the same
// general JSON shape used for the Summa Theologica text (see scrape-text.cjs),
// adapted for SCG's Book -> Chapter structure (no "articles").
//
// SCG has no clean HTML source like newadvent.org, so this script downloads
// the '_djvu.txt' OCR transcript for each archive.org item and runs a battery
// of heuristics to strip running headers/footers, footnote clutter, and
// reflow broken OCR line-wrapping into clean paragraphs. This is inherently
// imperfect (OCR never is), see the header comment in the output / README
// notes for known gaps.
//
// Usage:
//   node scrape-scg.cjs <book 1-4> <outFile>
//   node scrape-scg.cjs all <outDir>      (writes scg_book1.json .. scg_book4.json)

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Source configuration
// ---------------------------------------------------------------------------
// Each SCG book maps to one or more archive.org items whose djvu.txt files
// contain that book's chapters (Book Three was published in two physical
// volumes: chapters I-LXXXIII, and LXXXIV-CLXIII).
const BOOK_SOURCES = {
  1: {
    bookTitle: 'Book One: God',
    parts: ['summacontragenti01thomuoft'],
  },
  2: {
    bookTitle: 'Book Two: Creation',
    parts: ['summacontragenti02thomuoft'],
  },
  3: {
    bookTitle: 'Book Three: Providence',
    parts: ['summacontragenti0000lond', 'summacontragenti0000unse_l9e4'],
  },
  4: {
    bookTitle: 'Book Four: Salvation',
    parts: ['summacontragenti04thomuoft'],
  },
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

// ---------------------------------------------------------------------------
// Line classification helpers
// ---------------------------------------------------------------------------

// A line that starts with CHAPTER/CHAPTERS followed by roman-numeral-ish
// content. Used both to detect real chapter-boundary headings and to strip
// running headers ("CHAPTER  II  3", "CHAPTER  II  >", etc.) from body text.
const CHAPTER_LINE_RE = /^CHAPTERS?\s+[IVXLCM]/i;

// Does this "CHAPTER ..." line reduce to *pure* roman numeral(s) with
// nothing else on the line (allowing an "and"/"AND" joiner for combined
// chapters like "CHAPTERS LI and LII")? If so it's a genuine chapter-start
// marker; otherwise it's page-header noise (has a trailing page number,
// stray OCR junk, etc.) and should just be stripped.
function matchPureChapterHeading(line) {
  const m = line.match(/^CHAPTERS?\s+(.+)$/i);
  if (!m) return null;
  let rest = m[1].trim().replace(/\.+$/, '').trim();
  if (!rest) return null;
  const parts = rest.split(/\s+and\s+/i);
  const numerals = [];
  for (const part of parts) {
    const trimmedPart = part.trim();
    // Strip whitespace to repair a stray OCR-inserted space inside a roman
    // numeral (e.g. "XL VII" for "XLVII") -- but ONLY when this is a single
    // (non-combined) heading. When multiple parts are joined by "and" (a
    // combined-chapter heading like "CHAPTERS V AND VI"), a trailing
    // whitespace-separated fragment glued onto the last part is almost
    // always OCR page-number junk (e.g. "CHAPTERS V AND VI II" where "II"
    // is a garbled page number "11", not part of the numeral) -- collapsing
    // the space there would silently splice it into the roman numeral
    // (e.g. "VI"+"II" -> "VIII"). So for combined headings each part must
    // already be a single contiguous token.
    const candidate = parts.length > 1 ? trimmedPart : trimmedPart.replace(/\s+/g, '');
    let cleaned = candidate.toUpperCase();
    if (!cleaned) return null;
    if (!/^[IVXLCM]+$/.test(cleaned)) {
      // Common OCR misread: a tied "II" is frequently scanned as a single
      // "H" (two verticals + crossbar look-alike), e.g. "VH" for "VII",
      // "XH" for "XII". Try that one targeted correction before giving up.
      const fixed = cleaned.replace(/H/g, 'II');
      if (/^[IVXLCM]+$/.test(fixed)) cleaned = fixed;
      else return null;
    }
    const n = romanToInt(cleaned);
    if (!Number.isFinite(n) || n <= 0 || n > 300) return null;
    numerals.push(n);
  }
  return numerals;
}

// Lines that are pure running-header / page-furniture noise and should be
// dropped from the body text entirely (never contribute to paragraph text).
function isNoiseLine(line) {
  if (!line) return false;
  if (/SUMMA\s+CONTRA\s+GENTILES/i.test(line) && line.length < 60) return true;
  if (/^(FIRST|SECOND|THIRD|FOURTH)\s+BOOK\s*\d*\s*$/i.test(line)) return true;
  if (/^CONTENTS$/i.test(line)) return true;
  // Bare page numbers, optionally with a stray leading roman-numeral OCR
  // artifact glued on (e.g. "ii2" for page "112").
  if (/^[ivxlc]{0,3}\d{1,4}\.?$/i.test(line)) return true;
  // Footnote citation lines: "1 Ch. xliv." / "2 D. 3. iv. 27, 28." /
  // "1 2 Top. 1. 5. 2 1 Metaph. ii. 3." (sometimes several stacked on one
  // line) / etc. These always start with a footnote-marker digit, and are
  // otherwise mostly abbreviations + numerals + punctuation rather than
  // real prose: very few tokens that look like an actual (>=4-letter,
  // no trailing punctuation) English/Latin word.
  if (/^\d{1,2}\s/.test(line)) {
    const tokens = line.split(/\s+/);
    const wordyTokens = tokens.filter((t) => /^[A-Za-z]{4,}$/.test(t));
    if (wordyTokens.length <= 2) return true;
  }
  return false;
}

function isMostlyUpper(s) {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  const upper = letters.replace(/[^A-Z]/g, '');
  return upper.length / letters.length > 0.8;
}

function endsWithTerminalPunctuation(s) {
  return /["'’”)]?[.?!:;]["'’”)]?\s*$/.test(s);
}

// Strip footnote markers glued directly onto the end of a word (e.g.
// "Philosopher's1 opinion", "correctly.1") -- OCR renders the original
// superscript footnote number as an inline digit with no space.
function stripInlineFootnoteMarkers(line) {
  return line.replace(/([a-z])(\d{1,2})(?=[\s,.;:)"'’-]|$)/g, '$1');
}

function collapseSpaces(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Core parser: raw OCR text -> array of { chapter, title, paragraphs }
// ---------------------------------------------------------------------------
function parseVolume(rawText, { warn } = {}) {
  const warnFn = warn || (() => {});
  const rawLines = rawText.split(/\r?\n/).map((l) => l.trim());

  // Find the first genuine chapter-boundary marker; everything before it is
  // front matter / table of contents and is discarded. TOC lines never match
  // matchPureChapterHeading because they always carry trailing title text or
  // page numbers on the same "CHAPTER ..." line pattern only appears for the
  // real headings in this OCR text.
  let startIdx = -1;
  for (let i = 0; i < rawLines.length; i++) {
    if (CHAPTER_LINE_RE.test(rawLines[i]) && matchPureChapterHeading(rawLines[i])) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) {
    throw new Error('Could not locate start of body text (no chapter heading found)');
  }

  const chapters = [];
  const usedNumbers = new Set();
  let maxUsed = 0;

  let state = 'afterHeading'; // 'afterHeading' -> collecting title lines | 'body'
  let current = null; // { chapter, endChapter, title: [], bodyLines: [] }

  function finalizeCurrent() {
    if (!current) return;
    const title = collapseSpaces(current.titleLines.join(' '));
    const paragraphs = buildParagraphs(current.bodyLines);
    chapters.push({
      chapter: current.chapter,
      ...(current.endChapter ? { endChapter: current.endChapter } : {}),
      title: title || `Chapter ${current.chapter}`,
      paragraphs,
    });
  }

  function startChapter(numerals) {
    finalizeCurrent();
    current = {
      chapter: numerals[0],
      endChapter: numerals.length > 1 ? numerals[numerals.length - 1] : null,
      titleLines: [],
      bodyLines: [],
    };
    for (const n of numerals) usedNumbers.add(n);
    maxUsed = Math.max(maxUsed, ...numerals);
    state = 'afterHeading';
  }

  for (let i = startIdx; i < rawLines.length; i++) {
    const line = rawLines[i];

    if (CHAPTER_LINE_RE.test(line)) {
      const numerals = matchPureChapterHeading(line);
      // A single stray misread character can turn a legit numeral into a
      // wildly larger one (e.g. "LXXXI" (81) OCR'd as "LXXxXI" -> reads as
      // 91). Chapters proceed roughly sequentially with only occasional
      // small gaps (a handful of dropped headings at most), so a candidate
      // that jumps far past the highest chapter seen so far is far more
      // likely OCR noise than a genuine chapter -- reject it rather than
      // let it hijack the numbering.
      const plausible = numerals && (maxUsed === 0 || numerals[0] <= maxUsed + 8);
      if (numerals && plausible && !usedNumbers.has(numerals[0])) {
        startChapter(numerals);
      }
      // else: page-header junk ("CHAPTER II 3"), a duplicate/repeat of an
      // already-seen chapter number (running header on a later page), or an
      // implausible misread -- in all cases just drop the line.
      continue;
    }

    if (isNoiseLine(line)) continue;

    if (!current) continue; // shouldn't happen given startIdx logic

    if (state === 'afterHeading') {
      if (line === '') continue; // skip blank lines between marker/title/body
      if (isMostlyUpper(line)) {
        current.titleLines.push(line);
        continue;
      }
      // First non-uppercase, non-blank line: title has ended, body begins.
      state = 'body';
      current.bodyLines.push(line);
      continue;
    }

    // state === 'body'
    current.bodyLines.push(line); // '' (blank) lines are kept as paragraph separators
  }
  finalizeCurrent();

  // Sanity check: report gaps in the chapter sequence (chapters whose
  // heading line was dropped/garbled by the OCR and therefore silently
  // folded into the preceding chapter's text).
  const numbers = chapters
    .map((c) => [c.chapter, c.endChapter || c.chapter])
    .sort((a, b) => a[0] - b[0]);
  let expected = numbers.length ? numbers[0][0] : 1;
  for (const [start, end] of numbers) {
    if (start !== expected) {
      warnFn(`gap: expected chapter ${expected}, found ${start} (OCR likely dropped heading(s) ${expected}-${start - 1}, folded into previous chapter)`);
    }
    expected = end + 1;
  }

  return chapters;
}

// Turn a flat array of body lines (with '' entries marking blank-line
// breaks) into an array of { text } paragraph objects. Lines are rejoined
// with hyphenation-aware merging; a blank line only ends a paragraph if the
// text so far ends in terminal punctuation, since page breaks routinely
// interrupt a sentence mid-flow with a blank/removed-header gap in the OCR.
function buildParagraphs(bodyLines) {
  const paragraphs = [];
  let acc = []; // array of raw (already cleaned) lines forming current paragraph

  function flush(force) {
    if (acc.length === 0) return;
    const joined = joinLines(acc);
    const text = collapseSpaces(joined);
    if (text) paragraphs.push({ text });
    acc = [];
  }

  for (const rawLine of bodyLines) {
    if (rawLine === '') {
      const last = acc.length ? acc[acc.length - 1] : '';
      if (acc.length === 0) continue; // leading/duplicate blank, ignore
      if (endsWithTerminalPunctuation(last)) {
        flush();
      }
      // else: mid-sentence page break — swallow the blank and keep going
      continue;
    }
    const cleaned = stripInlineFootnoteMarkers(rawLine);
    acc.push(cleaned);
  }
  flush();

  return paragraphs;
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
      out = out.slice(0, -1) + line; // drop hyphen, no space: line-break word split
    } else {
      out += ' ' + line;
    }
  }
  return out;
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
// Book assembly
// ---------------------------------------------------------------------------
async function buildBook(bookNum) {
  const cfg = BOOK_SOURCES[bookNum];
  if (!cfg) throw new Error(`Unknown book ${bookNum}`);

  const allChapters = [];
  for (const identifier of cfg.parts) {
    console.log(`  fetching ${identifier} ...`);
    const raw = await fetchDjvuText(identifier);
    const warnings = [];
    const chapters = parseVolume(raw, { warn: (msg) => warnings.push(msg) });
    for (const w of warnings) console.log(`    [warn] ${identifier}: ${w}`);
    console.log(`    parsed ${chapters.length} chapters from ${identifier}`);
    allChapters.push(...chapters);
  }

  // De-duplicate in case of any overlap between parts, keep first occurrence,
  // and sort by chapter number.
  const seen = new Set();
  const deduped = [];
  for (const c of allChapters.sort((a, b) => a.chapter - b.chapter)) {
    if (seen.has(c.chapter)) continue;
    seen.add(c.chapter);
    deduped.push(c);
  }

  // The original print edition occasionally combines two very short
  // chapters under one shared heading (e.g. "CHAPTERS LI and LII"). For
  // book 1, the existing audiobook track listing in audio/scg_book1/ shows
  // these were still recorded as two separate numbered tracks sharing the
  // same title/content, so expand each combined entry into one object per
  // chapter number (duplicating the shared text) rather than emitting a
  // single object spanning a chapter range -- this keeps "chapter N" a
  // reliable 1:1 lookup key for downstream (e.g. audiobook-aligned) use.
  const expanded = [];
  for (const c of deduped) {
    const last = c.endChapter || c.chapter;
    for (let n = c.chapter; n <= last; n++) {
      expanded.push({ chapter: n, title: c.title, paragraphs: c.paragraphs });
    }
  }

  return expanded.map((c) => ({
    book: bookNum,
    bookTitle: cfg.bookTitle,
    chapter: c.chapter,
    title: c.title,
    paragraphs: c.paragraphs,
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const [, , bookArg, outArg] = process.argv;
  if (!bookArg || !outArg) {
    console.error('Usage: node scrape-scg.cjs <book 1-4|all> <outFile|outDir>');
    process.exit(1);
  }

  if (bookArg === 'all') {
    for (const bookNum of [1, 2, 3, 4]) {
      console.log(`Book ${bookNum}...`);
      const data = await buildBook(bookNum);
      const outFile = path.join(outArg, `scg_book${bookNum}.json`);
      fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`  wrote ${data.length} chapters to ${outFile}`);
    }
  } else {
    const bookNum = parseInt(bookArg, 10);
    console.log(`Book ${bookNum}...`);
    const data = await buildBook(bookNum);
    fs.writeFileSync(outArg, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Wrote ${data.length} chapters to ${outArg}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
