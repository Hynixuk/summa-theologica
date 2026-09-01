// Pattern-based OCR correction for Metaphysics
// Targets obvious corruptions visible in the current text
//
// This complements the audio-based approach by fixing known patterns:
// - Garbled words with unusual character sequences
// - Common OCR errors (rn->m, 1->l, 0->o, etc)
// - Words with excessive special characters
//
// Usage:
//   node fix-ocr-patterns.mjs

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TEXT_FILE = path.join(ROOT, "data", "text", "metaphysics.json");
const OUT_FILE = path.join(ROOT, "app", "data-metaphysics.js");
const CORRECTIONS_LOG = path.join(ROOT, "data", "pattern-corrections.json");

// Known OCR error patterns found in the corpus
// Format: {pattern: regex to match, replacement: replacement string, confidence: high/medium}
const KNOWN_CORRECTIONS = [
  // Obvious garbled words (verified as errors)
  { pattern: /\btome\b/gi, replacement: "time", confidence: "high", reason: "context: 'tome of the senses' - OCR misread" },
  { pattern: /\bsdenee\b/gi, replacement: "science", confidence: "high", reason: "common OCR error: 'd' misread as 's'" },
  { pattern: /\bscienee\b/gi, replacement: "science", confidence: "high", reason: "OCR: 'c' misread as 'e'" },
  { pattern: /\bcorrcctlj\b/gi, replacement: "correctly", confidence: "high", reason: "OCR: 'y' misread as 'j'" },
  { pattern: /\bezpeiieiiee\b/gi, replacement: "experience", confidence: "high", reason: "OCR: multiple character errors" },
  { pattern: /\bczcu\b/gi, replacement: "even", confidence: "medium", reason: "OCR: garbled" },
  { pattern: /\bcvcu\b/gi, replacement: "even", confidence: "medium", reason: "OCR: garbled" },
  { pattern: /\bIcteneeffoMT\b/gi, replacement: "Ictendef", confidence: "low", reason: "OCR: very garbled - unclear" },
  { pattern: /\bWO\b\s+scc/gi, replacement: "also see", confidence: "medium", reason: "OCR: WO scc → 'also see'" },
  { pattern: /\bcvcu\b/gi, replacement: "even", confidence: "medium", reason: "OCR: likely 'even'" },
  { pattern: /\braakinriSi\b/gi, replacement: "participate", confidence: "low", reason: "OCR: severely garbled" },
  { pattern: /\bopiuious\b/gi, replacement: "opinions", confidence: "high", reason: "OCR: character transposition" },
  { pattern: /\bthosc\b/gi, replacement: "those", confidence: "high", reason: "OCR: 'e' misread as 'c'" },
  { pattern: /\bjjg\b/gi, replacement: "ting", confidence: "medium", reason: "OCR: unclear" },
  { pattern: /\bwhxoh\b/gi, replacement: "which", confidence: "high", reason: "OCR: character substitution" },
  { pattern: /\big\b/gi, replacement: "is", confidence: "medium", reason: "OCR context-dependent" },
  { pattern: /\bMaii\b/gi, replacement: "Man", confidence: "high", reason: "OCR: extra 'i'" },
  { pattern: /\bfinSiorfonmd\b/gi, replacement: "that", confidence: "low", reason: "OCR: severely corrupted" },
  { pattern: /\bcemere\b/gi, replacement: "see", confidence: "high", reason: "OCR: 'cemere' → 'see'" },
  { pattern: /\bvideanius\b/gi, replacement: "videamus", confidence: "high", reason: "OCR: character error" },
  { pattern: /\bremains\b/gi, replacement: "remains", confidence: "high", reason: "OCR: minor error" },

  // Words with leading carets (these are definite errors)
  { pattern: /\^the\b/gi, replacement: "the", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^that\b/gi, replacement: "that", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^but\b/gi, replacement: "but", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^and\b/gi, replacement: "and", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^in\b/gi, replacement: "in", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^as[,\s]/gi, replacement: "as", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^as\b/gi, replacement: "as", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^for\b/gi, replacement: "for", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^it\b/gi, replacement: "it", confidence: "high", reason: "cleanup: leading caret" },
  { pattern: /\^n\b/gi, replacement: "in", confidence: "high", reason: "cleanup: leading caret fragment" },

  // Carets in middle of text (often indicate page breaks or scanning artifacts)
  { pattern: /\s+\^\s+/g, replacement: " ", confidence: "high", reason: "cleanup: orphaned caret" },
  { pattern: /\^+/g, replacement: "", confidence: "high", reason: "cleanup: carets" },

  // Fix merged words / spacing issues
  { pattern: /\brience\.in\b/gi, replacement: "rience in", confidence: "high", reason: "space missing after period" },
  { pattern: /\brience\.in\s+regard\b/gi, replacement: "experience. As regards", confidence: "medium", reason: "OCR: merged words" },
  { pattern: /\bcomof\b/gi, replacement: "common", confidence: "medium", reason: "OCR: character missing" },
  { pattern: /\bcommon of\b/gi, replacement: "common", confidence: "high", reason: "OCR: extra word" },

  // Unusual character sequences
  { pattern: /\bMan'\s+of\b/gi, replacement: "Man's", confidence: "high", reason: "OCR: apostrophe render error" },
  { pattern: /fin&iorfonmd/gi, replacement: "find", confidence: "low", reason: "OCR: severely corrupted" },

  // Remove excess braces and brackets
  { pattern: /\{/g, replacement: "", confidence: "high", reason: "cleanup: orphaned opening brace" },
  { pattern: /\}/g, replacement: "", confidence: "high", reason: "cleanup: orphaned closing brace" },
  { pattern: /\[\s*\]/g, replacement: "", confidence: "high", reason: "cleanup: empty brackets" },
];

// Load and parse metaphysics text
function loadMetaphysicsText() {
  if (!fs.existsSync(TEXT_FILE)) {
    throw new Error(`Text file not found: ${TEXT_FILE}`);
  }
  const data = JSON.parse(fs.readFileSync(TEXT_FILE, "utf-8"));
  return data;
}

// Apply corrections to the JSON data
function applyPatternCorrections(allChapters) {
  const applied = [];

  for (const { pattern, replacement, confidence, reason } of KNOWN_CORRECTIONS) {
    // Only apply high-confidence corrections automatically by default
    if (confidence !== "high") continue;

    for (const chapter of allChapters) {
      for (const para of chapter.paragraphs || []) {
        const before = para.text;
        const after = para.text.replace(pattern, replacement);

        if (before !== after) {
          // Count how many replacements
          const matches = (before.match(pattern) || []).length;

          para.text = after;
          applied.push({
            book: chapter.book,
            chapter: chapter.chapter,
            pattern: pattern.toString(),
            replacement,
            confidence,
            reason,
            matchesInParagraph: matches,
            sampleBefore: before.substring(0, 100),
            sampleAfter: after.substring(0, 100),
          });
        }
      }
    }
  }

  return applied;
}

// Rebuild the output data file
function rebuildDataFile(allChapters) {
  const BOOK_COUNT = 14;
  const BOOK_ROMAN = {
    1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI", 7: "VII",
    8: "VIII", 9: "IX", 10: "X", 11: "XI", 12: "XII", 13: "XIII", 14: "XIV",
  };

  // Group chapters by book
  const chaptersByBook = {};
  for (const c of allChapters) {
    if (!chaptersByBook[c.book]) chaptersByBook[c.book] = new Map();
    chaptersByBook[c.book].set(c.chapter, c);
  }

  const textIndex = {};
  const books = [];
  let totalChapters = 0;

  for (let book = 1; book <= BOOK_COUNT; book++) {
    const chapterMap = chaptersByBook[book];
    if (!chapterMap || chapterMap.size === 0) {
      books.push({ book, bookTitle: null, roman: BOOK_ROMAN[book], chapters: [], hasAnyText: false });
      continue;
    }

    const sortedChapters = Array.from(chapterMap.values()).sort((a, b) => a.chapter - b.chapter);
    const bookTitle = sortedChapters[0].bookTitle || `Book ${BOOK_ROMAN[book]}`;

    const chapterList = sortedChapters.map((c) => {
      const key = `B${book}C${c.chapter}`;
      const entry = {
        book,
        chapter: c.chapter,
        title: null,
        paragraphs: c.paragraphs,
        hasAudio: false,
        audioFile: null,
        audioTrack: null,
        durationSeconds: null,
      };
      textIndex[key] = entry;
      totalChapters++;
      return {
        chapter: c.chapter,
        title: null,
        hasAudio: false,
        audioTrack: null,
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
  out.push("// Auto-generated by scripts/build-data-metaphysics.cjs — do not edit by hand.");
  out.push(`window.METAPHYSICS_BOOKS = ${JSON.stringify(books, null, 2)};`);
  out.push(`window.METAPHYSICS_TEXT = ${JSON.stringify(textIndex, null, 2)};`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out.join("\n") + "\n", "utf-8");

  console.log(`Rebuilt ${OUT_FILE}`);
}

// Main
async function main() {
  console.log("Pattern-Based OCR Correction for Metaphysics");
  console.log("===========================================\n");

  const allChapters = loadMetaphysicsText();
  console.log(`Loaded ${allChapters.length} chapters from ${TEXT_FILE}\n`);

  // Apply corrections
  console.log("Applying pattern-based corrections...");
  const applied = applyPatternCorrections(allChapters);

  console.log(`Applied ${applied.length} corrections across all chapters\n`);

  // Group by pattern
  const byPattern = {};
  for (const corr of applied) {
    if (!byPattern[corr.pattern]) byPattern[corr.pattern] = [];
    byPattern[corr.pattern].push(corr);
  }

  console.log("Corrections by pattern:");
  for (const [pattern, corrections] of Object.entries(byPattern).sort((a, b) => b[1].length - a[1].length)) {
    const totalMatches = corrections.reduce((sum, c) => sum + c.matchesInParagraph, 0);
    console.log(`  ${pattern}: ${corrections.length} paragraphs, ${totalMatches} total replacements`);

    const example = corrections[0];
    console.log(`    Reason: ${example.reason}`);
    console.log(`    Example: "${example.sampleBefore}" → "${example.sampleAfter}"`);
  }

  // Save corrected JSON
  fs.writeFileSync(TEXT_FILE, JSON.stringify(allChapters, null, 2) + "\n", "utf-8");
  console.log(`\nSaved corrected text to ${TEXT_FILE}`);

  // Rebuild output data file
  rebuildDataFile(allChapters);

  // Save detailed log
  fs.writeFileSync(CORRECTIONS_LOG, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalCorrectionsApplied: applied.length,
    patterns: Object.entries(byPattern).map(([pattern, corrections]) => ({
      pattern,
      count: corrections.length,
      totalMatches: corrections.reduce((sum, c) => sum + c.matchesInParagraph, 0),
      examples: corrections.slice(0, 3),
    })),
    allCorrections: applied,
  }, null, 2) + "\n", "utf-8");

  console.log(`\nDetailed log saved to ${CORRECTIONS_LOG}`);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
