// OCR text correction pipeline for Metaphysics using LibriVox audio as ground truth.
//
// Approach:
// 1. For each of the 32 audio tracks covering Metaphysics chapters
// 2. Extract a ~45 second sample from the beginning (where chapter intro is read)
// 3. Transcribe with Whisper base.en
// 4. Match transcription against corresponding text in data/text/metaphysics.json
// 5. Build a corrections map for obvious OCR errors (garbled words vs. audio)
// 6. Apply corrections conservatively to JSON
// 7. Rebuild app/data-metaphysics.js
//
// Conservative strategy: only fix obvious OCR damage (character transpositions,
// missing letters) where the audio is unambiguous. Skip if audio is also ambiguous.
//
// Usage:
//   node fix-ocr-with-audio.mjs                    process all tracks
//   node fix-ocr-with-audio.mjs --limit 3          process first 3 tracks (testing)
//   node fix-ocr-with-audio.mjs --track 1          process only track 1

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MPEGDecoder } from "mpg123-decoder";
import { pipeline } from "@huggingface/transformers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const AUDIO_DIR = path.join(ROOT, "audio", "metaphysics");
const TEXT_FILE = path.join(ROOT, "data", "text", "metaphysics.json");
const OUT_FILE = path.join(ROOT, "app", "data-metaphysics.js");
const CORRECTIONS_LOG = path.join(ROOT, "data", "ocr-corrections.json");

const MODEL = "Xenova/whisper-base.en";
const SAMPLE_DURATION_SEC = 45; // extract first 45 seconds for transcription

// Track-to-book-chapter mapping from build-data-metaphysics.cjs
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

// CLI args
const argv = process.argv.slice(2);
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(argv[limitIdx + 1], 10) : 32;
const trackIdx = argv.indexOf("--track");
const SINGLE_TRACK = trackIdx !== -1 ? parseInt(argv[trackIdx + 1], 10) : null;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getTrackFiles() {
  if (!fs.existsSync(AUDIO_DIR)) {
    console.error(`Audio directory not found: ${AUDIO_DIR}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(AUDIO_DIR)
    .filter((f) => f.toLowerCase().endsWith(".mp3"))
    .sort();

  return files;
}

// Resample audio to 16kHz (Whisper's expected sample rate)
function resampleLinear(float32, srcRate, dstRate) {
  if (srcRate === dstRate) return float32;
  const ratio = srcRate / dstRate;
  const newLen = Math.floor(float32.length / ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, float32.length - 1);
    const frac = srcPos - i0;
    out[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
  }
  return out;
}

// Decode MP3 and trim to sample duration, returning Float32Array of audio at 16kHz
async function extractAudioSample(mp3Path, maxDurationSec) {
  const mp3Data = fs.readFileSync(mp3Path);
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const result = decoder.decode(mp3Data);
  decoder.free();

  // Take first channel or average if stereo
  const ch0 = result.channelData[0];
  const ch1 = result.channelData.length > 1 ? result.channelData[1] : null;
  let mono = new Float32Array(ch0.length);
  if (ch1) {
    for (let i = 0; i < ch0.length; i++) {
      mono[i] = (ch0[i] + ch1[i]) / 2;
    }
  } else {
    mono = ch0;
  }

  // Resample to 16kHz if needed
  const audio16k = resampleLinear(mono, result.sampleRate, 16000);

  // Trim to max duration
  const maxSamples = Math.floor(maxDurationSec * 16000);
  return audio16k.slice(0, maxSamples);
}

// Transcribe audio using Whisper
async function transcribeAudio(audioBuffer) {
  try {
    const transcriber = await pipeline("automatic-speech-recognition", MODEL, { dtype: "fp32" });
    const result = await transcriber(audioBuffer, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });

    return result.text || "";
  } catch (e) {
    console.error(`Transcription error: ${e.message}`);
    throw e;
  }
}

// Load and parse metaphysics text
function loadMetaphysicsText() {
  if (!fs.existsSync(TEXT_FILE)) {
    throw new Error(`Text file not found: ${TEXT_FILE}`);
  }
  const data = JSON.parse(fs.readFileSync(TEXT_FILE, "utf-8"));
  return data;
}

// Get first chapter text for a given book (as a concatenation of its paragraphs)
function getBookChapterFirstText(book, chapter, allChapters) {
  const found = allChapters.find((c) => c.book === book && c.chapter === chapter);
  if (!found) return "";

  // Concatenate all paragraphs
  return (found.paragraphs || [])
    .map((p) => p.text || "")
    .join(" ")
    .slice(0, 500); // first 500 chars
}

// Levenshtein distance (simple edit distance)
function levenshteinDist(a, b) {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  const m = aLower.length;
  const n = bLower.length;

  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aLower[i - 1] === bLower[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

// Detect if a word looks like OCR corruption
// Heuristics: contains unusual character sequences, looks garbled
function looksLikeOCRError(word) {
  // Words with repeated characters that are unusual
  if (/([^a-z])\1{2,}/.test(word.toLowerCase())) return true;
  // Words with unusual character transitions (common in OCR: rn->m, ll->n, etc)
  if (/[^aeiou]{3,}/.test(word.toLowerCase().replace(/st|ch|sh|th|ng|ck/g, ""))) return true;
  // Words that have digits mixed in (common OCR error)
  if (/[0-9]/.test(word)) return true;
  return false;
}

// Calculate similarity between two words
function wordSimilarity(a, b) {
  if (a.toLowerCase() === b.toLowerCase()) return 1.0;

  const dist = levenshteinDist(a, b);
  const maxLen = Math.max(a.length, b.length);

  // Similarity = 1 - (normalized distance)
  return 1.0 - (dist / maxLen);
}

// Find OCR errors by comparing transcription to original text
// Focus on finding words in the OCR text that look corrupted, then match to audio
function findOCRErrors(audioText, originalText) {
  const corrections = [];

  if (!audioText || !originalText) return corrections;

  // Split into words, preserving original case for proper nouns
  const audioWords = audioText.split(/[\s\n,\.;:!\?'"—–\-()]+/).filter((w) => w.length > 0);
  const originalWords = originalText.split(/[\s\n,\.;:!\?'"—–\-()]+/).filter((w) => w.length > 0);

  // Try to find OCR errors: for each word in the original text that looks like corruption,
  // try to find a matching word in the audio transcript
  let audioIdx = 0;

  for (let origIdx = 0; origIdx < originalWords.length; origIdx++) {
    const oWord = originalWords[origIdx];

    // Skip very short words (too many false positives)
    if (oWord.length < 3) continue;

    // Check if this word looks like OCR corruption
    if (!looksLikeOCRError(oWord)) continue;

    // Now try to find a matching word in the audio
    // Search in a window around the current position
    const searchStart = Math.max(0, audioIdx - 5);
    const searchEnd = Math.min(audioWords.length, audioIdx + 10);

    let bestMatch = null;
    let bestSimilarity = 0;

    for (let i = searchStart; i < searchEnd; i++) {
      const aWord = audioWords[i];
      const sim = wordSimilarity(oWord, aWord);

      // Match if: high similarity AND reasonable length difference
      if (sim > 0.6 && Math.abs(aWord.length - oWord.length) <= 3) {
        if (sim > bestSimilarity) {
          bestMatch = { word: aWord, index: i, similarity: sim };
          bestSimilarity = sim;
        }
      }
    }

    if (bestMatch && bestSimilarity > 0.75) {
      // Found a likely correction: OCR word looks corrupted and matches audio word well
      corrections.push({
        originalWord: oWord,
        audioWord: bestMatch.word,
        similarity: bestSimilarity,
        confidence: bestSimilarity > 0.85 ? "high" : bestSimilarity > 0.75 ? "medium" : "low",
        context: originalWords.slice(Math.max(0, origIdx - 2), origIdx + 3).join(" "),
      });

      audioIdx = bestMatch.index;
    }
  }

  return corrections;
}

// Apply corrections to the JSON data
function applyCorrections(allChapters, corrections) {
  const applied = [];

  for (const correction of corrections) {
    // Only apply HIGH confidence corrections automatically
    if (correction.confidence !== "high") continue;

    // Find and replace in the chapters
    for (const chapter of allChapters) {
      for (const para of chapter.paragraphs || []) {
        const before = para.text;
        // Replace word boundaries only
        const regex = new RegExp(`\\b${correction.originalWord}\\b`, "gi");
        const after = para.text.replace(regex, correction.audioWord);

        if (before !== after) {
          para.text = after;
          applied.push({
            book: chapter.book,
            chapter: chapter.chapter,
            original: correction.originalWord,
            corrected: correction.audioWord,
            confidence: correction.confidence,
          });
        }
      }
    }
  }

  return applied;
}

// Rebuild the output data file (mirrors build-data-metaphysics.cjs)
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
        hasAudio: false, // TODO: wire this up if needed
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

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  console.log(`OCR Correction Pipeline for Metaphysics`);
  console.log(`========================================\n`);

  const trackFiles = getTrackFiles();
  const allChapters = loadMetaphysicsText();

  const allCorrections = [];
  let processedTracks = 0;
  let totalCorrectionFound = 0;
  let totalCorrectionApplied = 0;

  for (let i = 0; i < Math.min(trackFiles.length, LIMIT); i++) {
    const file = trackFiles[i];
    const match = file.match(/^(\d+)\s*-/);
    const trackNum = match ? parseInt(match[1], 10) : i + 1;

    if (SINGLE_TRACK && trackNum !== SINGLE_TRACK) continue;

    const mapping = TRACK_BOOK_CHAPTERS.find((t) => t.track === trackNum);
    if (!mapping) {
      console.log(`Track ${trackNum}: No mapping found, skipping`);
      continue;
    }

    const mp3Path = path.join(AUDIO_DIR, file);
    console.log(`\nProcessing track ${trackNum} (${file})`);
    console.log(`  Covers: Book ${mapping.book}, Chapters ${mapping.chapterStart}-${mapping.chapterEnd}`);

    try {
      // Transcribe first 45 seconds
      console.log(`  Transcribing (this may take a minute)...`);
      const audioBuffer = await extractAudioSample(mp3Path, SAMPLE_DURATION_SEC);
      const audioText = await transcribeAudio(audioBuffer);

      if (!audioText) {
        console.log(`  WARNING: No transcription returned`);
        continue;
      }

      console.log(`  Transcription length: ${audioText.length} chars`);
      console.log(`  First 100 chars: "${audioText.slice(0, 100)}..."`);

      // Get the first chapter's text as reference
      const refChapter = getBookChapterFirstText(mapping.book, mapping.chapterStart, allChapters);
      if (!refChapter) {
        console.log(`  WARNING: Could not find chapter text`);
        continue;
      }

      console.log(`  Reference text length: ${refChapter.length} chars`);

      // Find OCR errors
      const corrections = findOCRErrors(audioText, refChapter);
      if (corrections.length > 0) {
        console.log(`  Found ${corrections.length} potential OCR errors:`);
        const highConfidence = corrections.filter((c) => c.confidence === "high");
        const mediumConfidence = corrections.filter((c) => c.confidence === "medium");

        for (const c of highConfidence.slice(0, 3)) {
          console.log(`    HIGH: "${c.originalWord}" -> "${c.audioWord}" (sim: ${c.similarity.toFixed(2)})`);
        }
        if (highConfidence.length > 3) {
          console.log(`    ... and ${highConfidence.length - 3} more high-confidence errors`);
        }

        totalCorrectionFound += corrections.length;
        allCorrections.push(...corrections.map((c) => ({ ...c, track: trackNum, book: mapping.book })));
      } else {
        console.log(`  No OCR errors detected`);
      }

      processedTracks++;
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Summary:`);
  console.log(`  Tracks processed: ${processedTracks}/${Math.min(trackFiles.length, LIMIT)}`);
  console.log(`  Potential corrections found: ${totalCorrectionFound}`);

  // Apply high-confidence corrections
  const applied = applyCorrections(allChapters, allCorrections.filter((c) => c.confidence === "high"));
  console.log(`  Corrections applied: ${applied.length}`);

  if (applied.length > 0) {
    console.log(`\nApplied corrections:`);
    for (const c of applied.slice(0, 10)) {
      console.log(`  Book ${c.book} Ch ${c.chapter}: "${c.original}" -> "${c.corrected}"`);
    }
    if (applied.length > 10) {
      console.log(`  ... and ${applied.length - 10} more`);
    }

    // Save corrected JSON
    fs.writeFileSync(TEXT_FILE, JSON.stringify(allChapters, null, 2) + "\n", "utf-8");
    console.log(`\nSaved corrected text to ${TEXT_FILE}`);

    // Rebuild output data file
    rebuildDataFile(allChapters);
  }

  // Save corrections log
  fs.writeFileSync(CORRECTIONS_LOG, JSON.stringify({
    timestamp: new Date().toISOString(),
    trackCount: processedTracks,
    correctionCandidates: allCorrections.length,
    correctionApplied: applied.length,
    applied,
    allCandidates: allCorrections,
  }, null, 2) + "\n", "utf-8");

  console.log(`\nCorrections log saved to ${CORRECTIONS_LOG}`);
}

main().catch((e) => {
  console.error("Pipeline error:", e);
  process.exit(1);
});
