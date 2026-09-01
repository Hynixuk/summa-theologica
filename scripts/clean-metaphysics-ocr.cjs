// Conservative post-processing cleanup pass for data/text/metaphysics.json
// (the raw scrape output of scrape-metaphysics.cjs). Does NOT touch the
// scrape script or its parsing logic -- this only cleans up the body text
// that has already been extracted into chapter/paragraph JSON.
//
// Two independent, deliberately conservative passes:
//
// 1. Dictionary-based character-level OCR correction: flags words not
//    found in a large English wordlist, and corrects them ONLY if they are
//    edit-distance-1 from a common dictionary word via a well-known OCR
//    glyph-confusion substitution (not just any near-miss -- this protects
//    real archaic/philosophical vocabulary and proper nouns like "Callias"
//    or "entelecheia" from being "corrected" into nonsense).
//
// 2. Sidenote-fragment removal: strips short tokens that match the
//    structural signature of marginal-note bleed (mixed internal case,
//    stray symbols like ^ * » «, digit-letter mashups) and are NOT real
//    dictionary words even after pass 1 -- never removes anything that is
//    a plain plausible English word.
//
// Every correction and removal is logged to stdout and to a JSON audit
// log file for review.
//
// Usage:
//   node clean-metaphysics-ocr.cjs <path-to-metaphysics.json> [--book N] [--dry-run] [--log <path>]

const fs = require('fs');
const path = require('path');

// Broad wordlist: used only to decide "is this token ALREADY a legitimate
// English word" (so we never flag/touch it). Being broad here is safe --
// it can only prevent action, never cause a bad correction.
const WORDLIST_URL = 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt';
const WORDLIST_CACHE = path.join(__dirname, '.wordlist-cache.txt');

// Narrow, high-frequency wordlist: the ONLY list a correction candidate is
// allowed to match against. Deliberately small (~10k common words) so that
// a "correction" can't land on some obscure/abbreviation entry the broad
// list happens to contain (e.g. "theb", "eos", "expo") -- if the intended
// word isn't common enough to be in this list, we skip rather than guess.
const COMMON_WORDLIST_URL = 'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt';
const COMMON_WORDLIST_CACHE = path.join(__dirname, '.wordlist-common-cache.txt');

async function loadWordlistFile(url, cachePath) {
  let text;
  if (fs.existsSync(cachePath)) {
    text = fs.readFileSync(cachePath, 'utf-8');
  } else {
    console.log(`Fetching wordlist from ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch wordlist: HTTP ${res.status}`);
    text = await res.text();
    fs.writeFileSync(cachePath, text, 'utf-8');
  }
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (w) set.add(w);
  }
  return set;
}

async function loadWordSet() {
  return loadWordlistFile(WORDLIST_URL, WORDLIST_CACHE);
}

async function loadCommonWordSet() {
  return loadWordlistFile(COMMON_WORDLIST_URL, COMMON_WORDLIST_CACHE);
}

// Exact-token denylist for the symbol-strip rescue path (see below). Every
// stray-symbol token in the actual source text was manually checked
// against its surrounding sentence; these specific tokens produced a
// coincidentally-real but CONTEXTUALLY WRONG word once the symbol was
// stripped (e.g. "g^nus," -> "gnus," (wildebeest!) when context makes
// clear the word is "genus,"; "l^ere" -> "lere" when context demands
// "there"; "man*s" -> "mans" when context demands the possessive "man's").
// In these cases the underlying OCR error was NOT a simple stray-symbol
// insertion (which is what the rescue safely undoes) -- it was a deeper
// substitution/deletion the rescue can't safely infer, so we leave the
// token as-is rather than "fix" it into the wrong word. This is a finite,
// manually-reviewed list specific to this one source text, not a general
// heuristic.
const SYMBOL_STRIP_REJECT = new Set([
  'n^ations', 's^pecting', 'ret^ard', 'l^ere', "one*s", 'a«mber', 'ti^nS',
  'sp^iks', 'regiu^s"^"', 'fin^i^^', "man*s", "l^asso*s", 'g^nus,', 'Se^at',
  'g^raS.*\'^"**', 'lea^t,',
]);

// Extra words legitimate to this text (archaic/philosophical vocabulary,
// proper nouns, terms that a general wordlist may lack) -- never flagged,
// never "corrected". Extend as needed; conservative by construction since
// adding here only PREVENTS action, never causes it.
const EXTRA_WHITELIST = new Set([
  'callias', 'coriscus', 'socrates', 'plato', 'aristotle', 'thales',
  'anaxagoras', 'empedocles', 'democritus', 'heraclitus', 'parmenides',
  'pythagoras', 'pythagoreans', 'anaximander', 'anaximenes', 'leucippus',
  'hippias', 'protagoras', 'xenophanes', 'melissus', 'zeno',
  'entelecheia', 'entelechy', 'hylomorphism', 'noesis', 'nous',
  'aquinas', 'bekker', 'bohn', 'mmahon', "m'mahon",
  'ousia', 'physis', 'telos', 'hypokeimenon', 'sophia',
]);

// ---------------------------------------------------------------------------
// OCR confusion-aware edit-distance-1 correction
// ---------------------------------------------------------------------------
// Known OCR glyph-confusion character classes for this scan (1857 Bohn
// edition Google Books scan). A substitution/insertion/deletion is only
// treated as "high confidence" if it matches one of these known confusion
// patterns -- this is what keeps the corrector from mangling real words
// that merely happen to be edit-distance-1 from something else.
const CONFUSION_PAIRS = [
  ['l', 'i'], ['i', 'l'],
  ['l', '1'], ['1', 'l'],
  ['I', 'l'], ['l', 'I'],
  ['l', 'U'], ['U', 'l'],   // lowercase l misread as capital U (glyph shape)
  ['I', 'U'], ['U', 'I'],
  ['n', 'u'], ['u', 'n'],   // classic serif n/u confusion
];

function isKnownConfusionSub(a, b) {
  return CONFUSION_PAIRS.some(([x, y]) => x === a && y === b);
}

// Returns { type: 'sub'|'ins'|'del', detail } if word1 -> word2 is a single
// edit AND that edit matches a known OCR confusion pattern; else null.
// Case-sensitive on the specific characters involved (so e.g. a capital
// mid-word like the "D" in "siDce" is part of the signal).
function classifyEdit(bad, good) {
  const la = bad.length, lb = good.length;
  if (la === lb) {
    // substitution: must differ in exactly one position
    let diffIdx = -1, diffCount = 0;
    for (let i = 0; i < la; i++) {
      if (bad[i] !== good[i]) { diffCount++; diffIdx = i; if (diffCount > 1) return null; }
    }
    if (diffCount !== 1) return null;
    const a = bad[diffIdx], b = good[diffIdx];
    if (isKnownConfusionSub(a, b)) return { type: 'substitution', detail: `'${a}'->'${b}' at position ${diffIdx}` };
    return null;
  }
  if (la === lb + 1) {
    // deletion from bad -> good (bad has one extra char)
    for (let i = 0; i < la; i++) {
      const candidate = bad.slice(0, i) + bad.slice(i + 1);
      if (candidate === good) {
        const removed = bad[i];
        // High-confidence only for known spurious-insertion chars (common
        // OCR speckle artifacts glued into a word) -- 'D' insertion is the
        // headline example from the task ("siDce" -> "since"), plus a
        // small set of other common single-glyph speckle noise.
        if (['D', 'U', 'l', 'I', "'", '^'].includes(removed)) {
          return { type: 'deletion', detail: `extra '${removed}' at position ${i}` };
        }
        return null;
      }
    }
    return null;
  }
  if (lb === la + 1) {
    // insertion needed to go from bad -> good (bad is missing one char)
    for (let i = 0; i < lb; i++) {
      const candidate = good.slice(0, i) + good.slice(i + 1);
      if (candidate === bad) {
        return null; // missing-letter OCR misreads are much less reliably
        // attributable to a specific known confusion; skip (conservative).
      }
    }
    return null;
  }
  // Special-cased multi-char confusions: 'rn' misread as 'm' and vice versa.
  if (bad.includes('rn') && bad.replace('rn', 'm') === good) {
    return { type: 'substitution', detail: `'rn'->'m'` };
  }
  if (good.includes('rn') && good.replace('rn', 'm') === bad) {
    return { type: 'substitution', detail: `'m'->'rn'` };
  }
  if (bad.includes('U') && bad.replace('U', 'll') === good) {
    return { type: 'substitution', detail: `'U'->'ll'` };
  }
  return null;
}

// High-priority special-case patterns, checked BEFORE generic edit-
// distance-1 substitution search. These target specific, extremely common
// multi-character OCR confusions in this scan where the naive single-
// letter-substitution search would either miss the real answer (distance
// >1) or, worse, land on a coincidentally-real but WRONG word. The
// headline case: this scan very frequently renders "h" as a broken "li" or
// "ii" glyph pair, so "the" comes out as "tlie"/"tiie", "which" as
// "wliich", etc. -- a plain distance-1 search over "tiie" finds "tile"
// (real word, wrong answer) and never finds "the" (which is 2 edits away
// under a naive count). Handling this as its own pattern fixes it, and
// takes priority over the generic search for any word it fires on.
function specialCasePattern(word, commonSet) {
  const lower = word.toLowerCase();
  for (const from of ['li', 'ii']) {
    if (lower.includes(from)) {
      const candidate = lower.replace(from, 'h');
      if (commonSet.has(candidate)) {
        return { candidate, edit: { type: 'substitution', detail: `'${from}'->'h' (broken-glyph 'h' misread)` } };
      }
    }
  }
  return null;
}

// Generate dictionary candidates within edit distance 1 of `word` (a
// smallish, targeted generation -- not a full dictionary scan -- restricted
// to substitutions/deletions since those are what classifyEdit accepts as
// high-confidence).
function generateEditDistance1Candidates(word) {
  const candidates = new Set();
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  // substitutions
  for (let i = 0; i < word.length; i++) {
    for (const c of chars) {
      if (c === word[i].toLowerCase()) continue;
      candidates.add(word.slice(0, i) + c + word.slice(i + 1));
    }
  }
  // deletions
  for (let i = 0; i < word.length; i++) {
    candidates.add(word.slice(0, i) + word.slice(i + 1));
  }
  // rn -> m, U -> ll special cases
  if (word.includes('rn')) candidates.add(word.replace('rn', 'm'));
  if (word.includes('U')) candidates.add(word.replace(/U/g, 'll'));
  return candidates;
}

function tryDictionaryCorrection(word, wordSet, commonSet) {
  const lower = word.toLowerCase();
  if (wordSet.has(lower) || EXTRA_WHITELIST.has(lower)) return null; // already fine
  if (word.length < 4) return null; // too short to safely correct (avoid coincidental short-word matches)
  if (!/^[A-Za-z]+$/.test(word)) return null; // only pure-alpha tokens

  // A capital letter appearing after position 0 is a strong signal this is
  // NOT an ordinary word -- it's a heading/running-header remnant (e.g.
  // "liOOK" from a garbled "BOOK X." chapter heading) or similar structural
  // debris. Skip correction entirely rather than risk "fixing" it into an
  // unrelated real word (observed in testing: "liOOK" -> "hook").
  if (/[A-Z]/.test(word.slice(1))) return null;

  // Try the high-priority special-case patterns (h->li/ii glyph breakage)
  // first -- and if one fires, use it exclusively rather than also
  // consulting the generic search, since a generic single-letter match
  // (e.g. "tiie" -> "tile") would otherwise create false ambiguity against
  // the correct, more specific answer ("tiie" -> "the").
  const special = specialCasePattern(word, commonSet);
  if (special) return special;

  // Generic single-edit search requires a longer word than the special-
  // case check above -- short words are much more likely to have a
  // coincidental, wrong, edit-distance-1 neighbor (observed in testing:
  // "Baid"->"Bald", "jnan"->"juan", "BOOI"->"BOOL", "sance"->"sauce" were
  // all wrong corrections of 4-5 letter tokens; "sance" was in fact half
  // of a hyphenation-split "cognisance" mangled by sidenote bleed).
  if (word.length < 6) return null;

  // Candidates must land on a COMMON word (small curated list) -- not just
  // anything in the broad dictionary -- to avoid "correcting" into obscure
  // or coincidental entries.
  const candidates = generateEditDistance1Candidates(word);
  const validMatches = [];
  for (const cand of candidates) {
    const candLower = cand.toLowerCase();
    if (commonSet.has(candLower)) {
      const edit = classifyEdit(word, cand);
      if (edit) validMatches.push({ candidate: cand, edit });
    }
  }
  if (validMatches.length !== 1) return null; // ambiguous (0 or >1) -- skip
  return validMatches[0];
}

// ---------------------------------------------------------------------------
// Sidenote-fragment detection
// ---------------------------------------------------------------------------
// Structural signature of marginal-note bleed fragments: mixed internal
// case that isn't ordinary sentence-capitalization, stray symbol clutter
// (^ * » « ~ etc.), or digit/letter mashups -- combined with NOT being a
// real dictionary word (checked by the caller after the dictionary-
// correction pass has already had a chance to fix genuine OCR misreads).
function looksLikeSidenoteFragment(token) {
  // Symbol clutter: contains any of the telltale marginal-note OCR symbols.
  if (/[\^\*»«¬~]/.test(token)) return 'stray-symbol';

  // Strip leading/trailing punctuation for the shape checks below.
  const core = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
  if (!core) return null;

  // Mostly non-alphabetic (digits mixed into what should be a word).
  const letters = (core.match(/[A-Za-z]/g) || []).length;
  if (letters > 0 && letters < core.length && /\d/.test(core)) {
    return 'digit-letter-mashup';
  }

  // NOTE: an earlier version of this heuristic also flagged "unnatural
  // internal case alternation" (>=2 case flips) as a fragment signal. That
  // was dropped after testing showed it can hit real words mangled by a
  // single glyph misread (e.g. "ability" OCR'd as "abUity", where the
  // capital U stands in for a lost "l") -- removing those would delete
  // real prose, which is exactly the failure mode we must avoid. Left as a
  // documented gap: some genuinely garbled mixed-case fragments (without
  // stray symbols or digits) will remain in the text uncleaned.

  return null;
}

// ---------------------------------------------------------------------------
// Paragraph text processing
// ---------------------------------------------------------------------------
// Tokenizes on whitespace, preserving the original whitespace layout, and
// processes each whitespace-delimited token as a unit (this matches how
// sidenote fragments and OCR misreads actually appear -- as standalone
// "words" in the space-joined text produced by the scraper).
function processText(text, wordSet, commonSet, logger) {
  const tokens = text.split(/(\s+)/); // keep whitespace as its own tokens
  const outTokens = [];

  for (const tok of tokens) {
    if (/^\s*$/.test(tok)) { outTokens.push(tok); continue; }

    // Separate a pure-alpha "core" word from surrounding punctuation so we
    // can test/correct just the word part.
    const m = tok.match(/^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/);
    if (!m) {
      // Token has no clean single alpha run (e.g. a stray symbol embedded
      // mid-word like "n^ations" or "Bekker^s"). Before treating this as
      // sidenote-fragment noise, try RESCUING it: strip out just the known
      // noise symbols (^ * » « etc. -- not other punctuation) and see if
      // what's left is a real word (or a real word + trailing possessive
      // "'s"/comma/etc.). If so this was a genuine word with a single
      // glued-in OCR artifact, not marginal-note bleed -- clean it instead
      // of deleting it.
      // Manually-reviewed reject list: for these specific tokens, symbol-
      // stripping lands on a real-but-wrong word, but the token also
      // contains real recognizable text -- so the safest action is neither
      // "correct" nor "delete", just leave it exactly as scraped (deleting
      // it as sidenote-fragment noise would be worse: it would silently
      // remove a real word like "there"/"man's"/"regard" from the prose).
      if (SYMBOL_STRIP_REJECT.has(tok)) {
        outTokens.push(tok);
        continue;
      }
      const rescued = tok.replace(/[\^\*»«¬~]/g, '');
      const rescuedCore = rescued.match(/^[^A-Za-z]*([A-Za-z]+)[^A-Za-z]*$/);
      // Require length >=4 -- the broad wordlist is noisy with short
      // abbreviation-like entries ("jct", "pis", "os", "fl"), so only trust
      // this rescue for words long enough that a false hit is unlikely.
      if (rescuedCore && rescuedCore[1].length >= 4 && wordSet.has(rescuedCore[1].toLowerCase())) {
        logger.corrections.push({ from: tok, to: rescued, edit: 'symbol-strip', detail: 'removed stray OCR symbol(s) glued into a real word' });
        outTokens.push(rescued);
        continue;
      }
      // Before deleting anything, make one more conservative check: does
      // stripping noise symbols yield ANY recognized word, even a short
      // one (below the length-4 threshold trusted for active correction)?
      // If so, this token carries real content (e.g. "ai^d" instead of
      // "and", "th«m" instead of "them") that outright deletion would
      // silently remove from the sentence -- worse than leaving a stray
      // symbol in place. Leave such tokens completely untouched.
      if (rescuedCore && rescuedCore[1].length >= 2 && wordSet.has(rescuedCore[1].toLowerCase())) {
        outTokens.push(tok);
        continue;
      }

      const reason = looksLikeSidenoteFragment(tok);
      if (reason && tok.length <= 12) {
        logger.removals.push({ token: tok, reason });
        continue; // drop entirely
      }
      outTokens.push(tok);
      continue;
    }
    const [, pre, core, post] = m;

    const lower = core.toLowerCase();
    if (wordSet.has(lower) || EXTRA_WHITELIST.has(lower)) {
      outTokens.push(tok);
      continue;
    }

    // Not a dictionary word. First try a high-confidence correction.
    const correction = tryDictionaryCorrection(core, wordSet, commonSet);
    if (correction) {
      // Preserve original capitalization style (all-caps / capitalized).
      let fixed = correction.candidate;
      if (core === core.toUpperCase()) fixed = fixed.toUpperCase();
      else if (/^[A-Z]/.test(core)) fixed = fixed[0].toUpperCase() + fixed.slice(1);
      logger.corrections.push({ from: core, to: fixed, edit: correction.edit.type, detail: correction.edit.detail });
      outTokens.push(pre + fixed + post);
      continue;
    }

    // Not correctable -- check whether it's a sidenote fragment (short,
    // symbol-cluttered, or unnaturally cased) and not a real word.
    const reason = looksLikeSidenoteFragment(core) || (pre + core + post !== tok ? null : null);
    const reasonFull = looksLikeSidenoteFragment(tok);
    if (reasonFull && core.length <= 6) {
      logger.removals.push({ token: tok, reason: reasonFull });
      continue; // drop entirely
    }

    // Otherwise: leave untouched (unknown word, but not confidently a
    // misread or a fragment -- could be archaic vocabulary, a proper noun,
    // or an OCR error we can't safely fix).
    outTokens.push(tok);
  }

  // Collapse now-empty gaps left by removed tokens (avoid double spaces).
  let result = outTokens.join('');
  result = result.replace(/[ \t]{2,}/g, ' ').trim();
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const inFile = args[0];
  if (!inFile) {
    console.error('Usage: node clean-metaphysics-ocr.cjs <path-to-metaphysics.json> [--book N] [--dry-run] [--log <path>]');
    process.exit(1);
  }
  const bookFlagIdx = args.indexOf('--book');
  const onlyBook = bookFlagIdx !== -1 ? parseInt(args[bookFlagIdx + 1], 10) : null;
  const dryRun = args.includes('--dry-run');
  const logFlagIdx = args.indexOf('--log');
  const logPath = logFlagIdx !== -1 ? args[logFlagIdx + 1] : path.join(__dirname, 'metaphysics-ocr-cleanup-log.json');

  const wordSet = await loadWordSet();
  const commonSet = await loadCommonWordSet();
  console.log(`Loaded broad wordlist: ${wordSet.size} words; common wordlist: ${commonSet.size} words`);

  const data = JSON.parse(fs.readFileSync(inFile, 'utf-8'));

  const logger = { corrections: [], removals: [] };
  let chaptersProcessed = 0;

  for (const chapter of data) {
    if (onlyBook != null && chapter.book !== onlyBook) continue;
    chaptersProcessed++;
    for (const para of chapter.paragraphs) {
      const before = para.text;
      const chapterTag = `Book ${chapter.book} Ch ${chapter.chapter}`;
      const startCorr = logger.corrections.length;
      const startRem = logger.removals.length;
      const after = processText(before, wordSet, commonSet, logger);
      for (let i = startCorr; i < logger.corrections.length; i++) logger.corrections[i].location = chapterTag;
      for (let i = startRem; i < logger.removals.length; i++) logger.removals[i].location = chapterTag;
      para.text = after;
    }
  }

  console.log(`\nProcessed ${chaptersProcessed} chapters.`);
  console.log(`Corrections made: ${logger.corrections.length}`);
  console.log(`Fragments removed: ${logger.removals.length}`);

  console.log('\nSample corrections:');
  for (const c of logger.corrections.slice(0, 30)) {
    console.log(`  [${c.location}] "${c.from}" -> "${c.to}" (${c.edit}: ${c.detail})`);
  }
  console.log('\nSample removals:');
  for (const r of logger.removals.slice(0, 30)) {
    console.log(`  [${r.location}] "${r.token}" (${r.reason})`);
  }

  fs.writeFileSync(logPath, JSON.stringify(logger, null, 2), 'utf-8');
  console.log(`\nFull audit log written to ${logPath}`);

  if (dryRun) {
    console.log('\nDry run -- not writing changes to input file.');
    return;
  }

  fs.writeFileSync(inFile, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\nWrote cleaned data back to ${inFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
