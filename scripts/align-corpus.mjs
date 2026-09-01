// Full-corpus article-boundary alignment pipeline for the Summa Theologica read-along project.
//
// Generalizes the vol01/Q1 pilot (see data/text/vol01_q1_alignment_pilot.json for the method
// writeup and schema this follows) to every downloaded audio file across all volumes:
//   - decode mp3 -> mono 16kHz PCM with mpg123-decoder (pure WASM, no ffmpeg)
//   - transcribe with transformers.js Whisper base.en on CPU (wasm backend), chunk_length_s=30,
//     stride_length_s=5, return_timestamps: true
//   - regex-match ordinal + "article" narrator headings against the ground-truth article list
//     for the matched question(s), interpolating a timestamp by character offset within the
//     matched ~30s chunk
//
// Resumable: progress is tracked in data/alignment/progress.json keyed by relative audio path.
// Re-running skips any file already marked "done" (success OR partial-match) there, so it only
// costs time for files that never finished a transcription attempt (crashed, killed, etc). Files
// whose article-count didn't match ground truth are additionally listed in progress.failures for
// manual follow-up, but are NOT re-attempted automatically since Whisper on CPU is deterministic
// (a retry of unmodified code produces the same result).
//
// Usage:
//   node align-corpus.mjs                 process everything not yet done
//   node align-corpus.mjs --limit 3        process at most 3 files (for smoke-testing)
//   node align-corpus.mjs --dry-run        just resolve file -> question mapping, no ASR
//   node align-corpus.mjs --file <substr>  only process files whose path contains <substr>

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MPEGDecoder } from "mpg123-decoder";
import { pipeline } from "@huggingface/transformers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const AUDIO_DIR = path.join(ROOT, "audio");
const TEXT_DIR = path.join(ROOT, "data", "text");
const ALIGN_DIR = path.join(ROOT, "data", "alignment");
const PROGRESS_PATH = path.join(ALIGN_DIR, "progress.json");

const MODEL = "Xenova/whisper-base.en";

// Same volume -> part catalog as scripts/build-data.cjs (duplicated here so this pipeline has
// no dependency on that CommonJS file / the app build).
const VOLUME_META = [
  { part: 1, volume: 1 },
  { part: 1, volume: 2 },
  { part: 1, volume: 3 },
  { part: 1, volume: 4 },
  { part: 1, volume: 5 },
  { part: 2, volume: 6 },
  { part: 2, volume: 7 },
  { part: 2, volume: 8 },
  { part: 2, volume: 9 },
  { part: 3, volume: 10 },
  { part: 3, volume: 11 },
  { part: 3, volume: 12 },
  { part: 4, volume: 13 },
  { part: 4, volume: 14 },
];
const PART_OF_VOLUME = new Map(VOLUME_META.map((v) => [v.volume, v.part]));

const TEXT_FILES = {
  1: "part1_prima_pars.json",
  2: "part2_prima_secundae.json",
  3: "part3_secunda_secundae.json",
  4: "part4_tertia_pars.json",
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(argv[limitIdx + 1], 10) : null;
const fileIdx = argv.indexOf("--file");
const FILE_FILTER = fileIdx !== -1 ? argv[fileIdx + 1] : null;
const shardIdx = argv.indexOf("--shard");
let SHARD_I = null, SHARD_N = null;
if (shardIdx !== -1) {
  const m = /^(\d+)\/(\d+)$/.exec(argv[shardIdx + 1] || "");
  if (!m) throw new Error("--shard expects the form i/n, e.g. --shard 0/4");
  SHARD_I = parseInt(m[1], 10);
  SHARD_N = parseInt(m[2], 10);
  if (SHARD_I < 0 || SHARD_I >= SHARD_N) throw new Error("--shard i must satisfy 0 <= i < n");
}

// ---------------------------------------------------------------------------
// Ordinal words (supports up to 25 articles; the largest known question, II-II q83, has 17)
// ---------------------------------------------------------------------------
const ORDINAL_NAMES = [
  null, "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth",
  "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth",
  "seventeenth", "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second",
  "twenty-third", "twenty-fourth", "twenty-fifth",
];

function ordinalForms(n) {
  const forms = [];
  if (ORDINAL_NAMES[n]) forms.push(ORDINAL_NAMES[n].replace("-", "[\\s-]?"));
  forms.push(`${n}(?:st|nd|rd|th)`); // "10th", "1st", etc — Whisper sometimes renders digits
  return forms;
}

function findOrdinalArticleMatch(text, ordinal, fromCharOffset) {
  const lower = text.toLowerCase();
  const searchSpace = lower.slice(fromCharOffset);
  let best = null;
  for (const form of ordinalForms(ordinal)) {
    const re = new RegExp(`\\b${form}\\b\\s*(article)`, "i");
    const m = re.exec(searchSpace);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index + fromCharOffset, matched: m[0], form };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ground truth text
// ---------------------------------------------------------------------------
function loadGroundTruth() {
  const byPartQuestion = new Map(); // key `${part}:${question}` -> question object
  for (const [part, file] of Object.entries(TEXT_FILES)) {
    const p = path.join(TEXT_DIR, file);
    if (!fs.existsSync(p)) continue;
    const arr = JSON.parse(fs.readFileSync(p, "utf-8"));
    for (const q of arr) {
      byPartQuestion.set(`${q.part}:${q.question}`, q);
    }
  }
  return byPartQuestion;
}

// ---------------------------------------------------------------------------
// Audio file -> question(s) resolution
// ---------------------------------------------------------------------------
function slugFromTrackFilename(filename) {
  const m = filename.match(/^(\d+)\s*-/);
  return m ? `track${m[1].padStart(2, "0")}` : `file-${filename.replace(/[^a-z0-9]/gi, "").slice(0, 20)}`;
}

function parseQuestionRangeFromTitle(title) {
  const m = title.match(/Questions?\.?\s+(\d+)(?:\s*(?:-|to|through)\s*(\d+))?/i);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : start;
  return { start, end };
}

function discoverAudioFiles() {
  const items = [];
  if (!fs.existsSync(AUDIO_DIR)) return items;
  const volDirs = fs
    .readdirSync(AUDIO_DIR)
    .filter((d) => /^vol\d+$/.test(d))
    .sort();

  for (const volDir of volDirs) {
    const volume = parseInt(volDir.replace("vol", ""), 10);
    const part = PART_OF_VOLUME.get(volume);
    const dirPath = path.join(AUDIO_DIR, volDir);
    const manifestPath = path.join(dirPath, "manifest.json");
    let manifestByFile = new Map();
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        for (const t of manifest.tracks || []) {
          manifestByFile.set(t.file, t);
        }
      } catch (e) {
        console.error(`  WARN: failed to parse ${manifestPath}: ${e.message}`);
      }
    }

    const mp3Files = fs
      .readdirSync(dirPath)
      .filter((f) => f.toLowerCase().endsWith(".mp3"))
      .sort();

    for (const file of mp3Files) {
      const relPath = `${volDir}/${file}`;
      const track = manifestByFile.get(file);
      let questionStart = null;
      let questionEnd = null;
      if (track && track.questionStart != null) {
        questionStart = track.questionStart;
        questionEnd = track.questionEnd ?? track.questionStart;
      } else {
        const range = parseQuestionRangeFromTitle(file);
        if (range) {
          questionStart = range.start;
          questionEnd = range.end;
        }
      }

      items.push({
        relPath,
        absPath: path.join(dirPath, file),
        volume,
        part,
        file,
        slug: slugFromTrackFilename(file),
        questionStart,
        questionEnd,
        knownDurationSec: track ? track.durationSeconds : null,
      });
    }
  }
  return items;
}

// dedupe: vol02 has exact byte-identical duplicate mp3s under two different naming schemes
// (a download-script re-run artifact, not something to "fix" here) — same track number +
// same size => same content, only process one, but still map both filenames to the same
// output slug so whichever is seen first "wins" and the other is a no-op on future runs.
function dedupeBySizeAndSlug(items) {
  const seen = new Map(); // `${volume}:${slug}` -> size
  const out = [];
  for (const it of items) {
    const key = `${it.volume}:${it.slug}`;
    const size = fs.statSync(it.absPath).size;
    if (seen.has(key)) {
      // already have an item for this slug; skip only if same byte size (true duplicate)
      if (seen.get(key) === size) continue;
      // different content under same track number (shouldn't normally happen) — disambiguate
      it.slug = `${it.slug}-${path.basename(it.file, ".mp3").replace(/[^a-z0-9]/gi, "").slice(-8)}`;
    }
    seen.set(key, size);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------
function loadProgress() {
  if (fs.existsSync(PROGRESS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf-8"));
    } catch {
      // fall through to fresh
    }
  }
  return { done: {}, failures: [] };
}

// Merge this process's own progress state on top of whatever is currently on disk, so parallel
// shards (each holding their own in-memory `progress` object, updated only with their own files)
// don't clobber each other's entries with a stale full-object overwrite.
function saveProgress(progress) {
  fs.mkdirSync(ALIGN_DIR, { recursive: true });
  const onDisk = loadProgress();
  const merged = {
    done: { ...onDisk.done, ...progress.done },
    doneSlugs: { ...(onDisk.doneSlugs || {}), ...(progress.doneSlugs || {}) },
    failures: [...(onDisk.failures || [])],
  };
  for (const f of progress.failures || []) {
    const i = merged.failures.findIndex((x) => x.file === f.file);
    if (i !== -1) merged.failures[i] = f;
    else merged.failures.push(f);
  }
  merged.updatedAt = new Date().toISOString();
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(merged, null, 2), "utf-8");
  // keep this process's in-memory view consistent with what's now on disk
  progress.done = merged.done;
  progress.doneSlugs = merged.doneSlugs;
  progress.failures = merged.failures;
}

// ---------------------------------------------------------------------------
// Audio decode
// ---------------------------------------------------------------------------
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

async function decodeMp3To16k(absPath) {
  const buf = fs.readFileSync(absPath);
  const decoder = new MPEGDecoder();
  await decoder.ready;
  const result = decoder.decode(buf);
  decoder.free();
  const ch0 = result.channelData[0];
  const ch1 = result.channelData.length > 1 ? result.channelData[1] : null;
  let mono = new Float32Array(ch0.length);
  if (ch1) {
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  } else {
    mono = ch0;
  }
  return resampleLinear(mono, result.sampleRate, 16000);
}

// ---------------------------------------------------------------------------
// Boundary detection for one question's articles, scanning forward from a chunk/char cursor.
// Returns { articles: [...], cursor: {chunkIndex, charOffset} }
// ---------------------------------------------------------------------------
function alignQuestionArticles(chunks, articleTitles, startCursor) {
  let cursor = { ...startCursor };
  const results = [];

  for (let n = 1; n <= articleTitles.length; n++) {
    let found = null;
    for (let ci = cursor.chunkIndex; ci < chunks.length; ci++) {
      const text = chunks[ci].text;
      const fromOffset = ci === cursor.chunkIndex ? cursor.charOffset : 0;
      const m = findOrdinalArticleMatch(text, n, fromOffset);
      if (m) {
        const frac = m.index / Math.max(text.length, 1);
        const [start, end] = chunks[ci].timestamp;
        const interpolated = start + frac * (end - start);
        found = {
          chunkIndex: ci,
          charOffset: m.index + m.matched.length,
          approxStartSec: Math.round(interpolated * 100) / 100,
          sourceChunkTimestamp: chunks[ci].timestamp,
          asrMatchedText: text.trim(),
        };
        break;
      }
    }

    if (found) {
      cursor = { chunkIndex: found.chunkIndex, charOffset: found.charOffset };
      results.push({
        articleNumber: n,
        groundTruthTitle: articleTitles[n - 1],
        asrMatchedText: found.asrMatchedText,
        approxStartSec: found.approxStartSec,
        approxStartHMS: new Date(found.approxStartSec * 1000).toISOString().substr(11, 8),
        sourceChunkTimestamp: found.sourceChunkTimestamp,
        matched: true,
      });
    } else {
      results.push({
        articleNumber: n,
        groundTruthTitle: articleTitles[n - 1],
        matched: false,
      });
      // cursor intentionally NOT advanced — next article's search still starts from the
      // last successful match, so one garbled heading doesn't sink every article after it.
    }
  }

  return { articles: results, cursor };
}

// ---------------------------------------------------------------------------
// Per-file pipeline
// ---------------------------------------------------------------------------
async function alignFile(item, groundTruth, transcriber) {
  const questions = [];
  for (let q = item.questionStart; q <= item.questionEnd; q++) {
    const gt = groundTruth.get(`${item.part}:${q}`);
    if (gt) questions.push(gt);
  }
  if (questions.length === 0) {
    throw new Error(
      `No ground-truth text found for part ${item.part} question(s) ${item.questionStart}-${item.questionEnd} (file: ${item.relPath})`
    );
  }

  const tDecodeStart = Date.now();
  const pcm16k = await decodeMp3To16k(item.absPath);
  const mp3DecodeSec = (Date.now() - tDecodeStart) / 1000;
  const audioDurationSec = pcm16k.length / 16000;

  const tInferStart = Date.now();
  const output = await transcriber(pcm16k, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  });
  const inferenceSec = (Date.now() - tInferStart) / 1000;
  const chunks = output.chunks || [];

  let cursor = { chunkIndex: 0, charOffset: 0 };
  const perQuestion = [];
  let expectedTotal = 0;
  let matchedTotal = 0;

  for (const gt of questions) {
    const titles = gt.articles.map((a) => a.title);
    const { articles, cursor: nextCursor } = alignQuestionArticles(chunks, titles, cursor);
    cursor = nextCursor;
    expectedTotal += titles.length;
    matchedTotal += articles.filter((a) => a.matched).length;
    perQuestion.push({
      part: gt.part,
      question: gt.question,
      questionTitle: gt.title,
      articles,
    });
  }

  const singleQuestion = perQuestion.length === 1;

  const record = {
    volume: item.volume,
    part: item.part,
    audioFile: item.file,
    audioRelPath: item.relPath,
    audioDurationSec: Math.round(audioDurationSec * 100) / 100,
    method: {
      pipeline: "transformers.js (@huggingface/transformers) ASR pipeline, Whisper base.en, CPU (wasm) backend",
      mp3Decode: "mpg123-decoder (pure WASM, no ffmpeg needed)",
      timestampGranularity: "chunk-level (chunk_length_s=30, stride_length_s=5), NOT word-level",
      boundaryMethod:
        "regex search for narrator-read ordinal + 'article' (e.g. 'Second article') in ASR transcript chunks, scanning monotonically forward; timestamp linearly interpolated by character offset within the matched ~30s chunk",
      note:
        "Unlike the vol01/Q1 pilot, article 1's timestamp here is the actual ASR-detected heading position (not forced to 0:00) since most files don't carry the LibriVox-intro + Prologue boilerplate that only precedes the very first track of the corpus.",
    },
    timing: {
      fullFileInferenceSec: Math.round(inferenceSec * 100) / 100,
      audioProcessedSec: Math.round(audioDurationSec * 100) / 100,
      realtimeFactor: Math.round((inferenceSec / audioDurationSec) * 1000) / 1000,
      mp3DecodeSec: Math.round(mp3DecodeSec * 100) / 100,
    },
    expectedArticleCount: expectedTotal,
    matchedArticleCount: matchedTotal,
    status: matchedTotal === expectedTotal ? "ok" : "partial",
  };

  if (singleQuestion) {
    record.question = { part: perQuestion[0].part, question: perQuestion[0].question, title: perQuestion[0].questionTitle };
    record.articles = perQuestion[0].articles;
  } else {
    record.questions = perQuestion;
  }

  return record;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  fs.mkdirSync(ALIGN_DIR, { recursive: true });
  const groundTruth = loadGroundTruth();
  let items = discoverAudioFiles();
  items = dedupeBySizeAndSlug(items);

  if (FILE_FILTER) items = items.filter((it) => it.relPath.includes(FILE_FILTER));

  const progress = loadProgress();
  progress.doneSlugs = progress.doneSlugs || {};

  // A file counts as done if either its own relPath was processed, or another filename
  // that resolved to the same (volume, slug) — e.g. a duplicate download under a
  // different name — already produced this output.
  let dedupedTodo = items.filter((it) => {
    if (progress.done[it.relPath]) return false;
    const slugKey = `vol${String(it.volume).padStart(2, "0")}::${it.slug}`;
    if (progress.doneSlugs[slugKey]) return false;
    return true;
  });

  // Shard AFTER filtering already-done work, and index by each item's stable relPath (sorted)
  // rather than array position, so shards stay well-defined even as other shards mark files done
  // out from under this list on a shared progress.json between runs.
  if (SHARD_N !== null) {
    const sortedPaths = items.map((it) => it.relPath).sort();
    const rankOf = new Map(sortedPaths.map((p, idx) => [p, idx]));
    dedupedTodo = dedupedTodo.filter((it) => rankOf.get(it.relPath) % SHARD_N === SHARD_I);
    console.log(`Shard ${SHARD_I}/${SHARD_N}: this process owns ${dedupedTodo.length} of the remaining file(s).`);
  }

  console.log(`Discovered ${items.length} audio file(s) across downloaded volumes.`);
  console.log(`Already done: ${Object.keys(progress.done).length}. Remaining: ${dedupedTodo.length}.`);

  if (DRY_RUN) {
    for (const it of dedupedTodo) {
      console.log(
        `  [would process] ${it.relPath}  slug=${it.slug}  part=${it.part}  Q${it.questionStart}${
          it.questionEnd !== it.questionStart ? "-" + it.questionEnd : ""
        }`
      );
    }
    return;
  }

  const toRun = LIMIT ? dedupedTodo.slice(0, LIMIT) : dedupedTodo;
  if (toRun.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(`Loading ${MODEL} (CPU/wasm)...`);
  const tModelStart = Date.now();
  const transcriber = await pipeline("automatic-speech-recognition", MODEL, { dtype: "fp32" });
  console.log(`Model loaded in ${((Date.now() - tModelStart) / 1000).toFixed(1)}s`);

  for (let i = 0; i < toRun.length; i++) {
    const it = toRun[i];
    const label = `[${i + 1}/${toRun.length}] ${it.relPath}`;
    console.log(`\n${label}`);
    const startedAt = new Date().toISOString();
    try {
      const record = await alignFile(it, groundTruth, transcriber);
      const outDir = path.join(ALIGN_DIR, `vol${String(it.volume).padStart(2, "0")}`);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${it.slug}.json`);
      fs.writeFileSync(outFile, JSON.stringify(record, null, 2), "utf-8");

      const relOut = path.relative(ROOT, outFile).replace(/\\/g, "/");
      progress.done[it.relPath] = {
        status: record.status,
        outputFile: relOut,
        matched: record.matchedArticleCount,
        expected: record.expectedArticleCount,
        realtimeFactor: record.timing.realtimeFactor,
        finishedAt: new Date().toISOString(),
      };
      progress.doneSlugs[`vol${String(it.volume).padStart(2, "0")}::${it.slug}`] = true;

      if (record.status !== "ok") {
        progress.failures = progress.failures.filter((f) => f.file !== it.relPath);
        progress.failures.push({
          file: it.relPath,
          reason: `matched ${record.matchedArticleCount}/${record.expectedArticleCount} article headings`,
          outputFile: relOut,
          at: new Date().toISOString(),
        });
        console.log(`  PARTIAL: matched ${record.matchedArticleCount}/${record.expectedArticleCount} -> ${relOut}`);
      } else {
        console.log(
          `  OK: ${record.matchedArticleCount}/${record.expectedArticleCount} articles, realtime factor ${record.timing.realtimeFactor}x -> ${relOut}`
        );
      }
      saveProgress(progress);
    } catch (e) {
      console.error(`  FAILED: ${e.message}`);
      progress.failures = progress.failures.filter((f) => f.file !== it.relPath);
      progress.failures.push({ file: it.relPath, reason: e.message, startedAt, at: new Date().toISOString() });
      saveProgress(progress);
      // do not mark as done — a crash should be retried on a future run
      continue;
    }
  }

  console.log("\nBatch run complete.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
