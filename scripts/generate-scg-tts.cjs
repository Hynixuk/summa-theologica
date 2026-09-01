// Generates one TTS narration MP3 per chapter for Summa Contra Gentiles books 3 and 4
// (no LibriVox audiobook exists for these books). Uses msedge-tts (Microsoft Edge's free
// neural TTS service, no API key needed) and writes a manifest.json matching the shape of
// audio/scg_book1/manifest.json and audio/vol01/manifest.json so the app can consume it the
// same way as everything else.
//
// Resumable: chapters whose output MP3 already exists (and is a plausible size) are skipped
// for synthesis, but the manifest is always rebuilt from whatever files exist on disk so a
// partial/interrupted run still leaves a valid, up-to-date manifest.json.
//
// Usage: node generate-scg-tts.cjs [book3|book4|all]

const fs = require("fs");
const path = require("path");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const { MPEGDecoder } = require("mpg123-decoder");

const ROOT = path.join(__dirname, "..");
const VOICE = "en-GB-RyanNeural"; // steady, clear, natural neural voice, used consistently for both books
const OUTPUT_FORMAT_USED = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const MAX_BATCH_CHARS = 3000; // safe request size for the Edge TTS websocket (tested up to ~7000 OK, kept well under)
const MAX_PARAGRAPH_CHARS = 3000; // paragraphs longer than this get split by sentence
const MIN_VALID_FILE_BYTES = 20000; // below this, treat an existing file as incomplete/corrupt and redo it
const MAX_RETRIES = 4;

const BOOKS = {
  book3: {
    textFile: path.join(ROOT, "data", "text", "scg_book3.json"),
    outDir: path.join(ROOT, "audio", "scg_book3"),
    volume: 103,
    identifier: "scg_book3_tts_msedge",
  },
  book4: {
    textFile: path.join(ROOT, "data", "text", "scg_book4.json"),
    outDir: path.join(ROOT, "audio", "scg_book4"),
    volume: 104,
    identifier: "scg_book4_tts_msedge",
  },
};

// msedge-tts wraps our text in an SSML template but does not escape it itself
// (its README explicitly warns callers to do this). The scraped/OCR'd source
// text sometimes contains stray "&", "<", ">" (garbled footnote markers etc.)
// which otherwise break the SSML XML and silently kill the synthesis stream.
function xmlEscape(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(title) {
  return title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Split a chapter's paragraphs into TTS request batches, respecting paragraph
// boundaries where possible and falling back to sentence splitting for any
// single paragraph that alone exceeds the safe request size.
function buildBatches(introLine, paragraphs) {
  const units = [introLine, ...paragraphs.map((p) => p.text)].filter(Boolean);

  // Expand any oversized paragraph into sentence-level pieces first.
  const pieces = [];
  for (const unit of units) {
    if (unit.length <= MAX_PARAGRAPH_CHARS) {
      pieces.push(unit);
      continue;
    }
    const sentences = unit.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [unit];
    let cur = "";
    for (const s of sentences) {
      if ((cur + s).length > MAX_PARAGRAPH_CHARS && cur) {
        pieces.push(cur.trim());
        cur = s;
      } else {
        cur += s;
      }
    }
    if (cur.trim()) pieces.push(cur.trim());
  }

  // Pack pieces into batches up to MAX_BATCH_CHARS.
  const batches = [];
  let cur = "";
  for (const piece of pieces) {
    const candidate = cur ? cur + "\n\n" + piece : piece;
    if (candidate.length > MAX_BATCH_CHARS && cur) {
      batches.push(cur);
      cur = piece;
    } else {
      cur = candidate;
    }
  }
  if (cur) batches.push(cur);
  return batches;
}

function synthOnce(tts, text) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    audioStream.on("data", (d) => chunks.push(d));
    audioStream.on("close", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    audioStream.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}

async function synthBatchWithRetry(batch) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let tts;
    try {
      tts = new MsEdgeTTS();
      await tts.setMetadata(VOICE, OUTPUT_FORMAT_USED);
      const buf = await synthOnce(tts, batch);
      tts.close();
      return buf;
    } catch (err) {
      lastErr = err;
      try {
        if (tts) tts.close();
      } catch (_) {}
      console.warn(`    retry ${attempt}/${MAX_RETRIES} after error: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

async function synthChapter(introLine, paragraphs) {
  const batches = buildBatches(introLine, paragraphs);
  const bufs = [];
  for (const batch of batches) {
    const buf = await synthBatchWithRetry(xmlEscape(batch));
    bufs.push(buf);
  }
  return Buffer.concat(bufs);
}

// Decode an MP3 buffer to verify it's valid and to compute duration in seconds.
function verifyAndGetDuration(buf) {
  const decoder = new MPEGDecoder();
  return decoder.ready.then(() => {
    try {
      const result = decoder.decode(buf);
      const samples = result.channelData[0] ? result.channelData[0].length : 0;
      if (samples === 0) throw new Error("decoded to zero samples");
      const duration = samples / result.sampleRate;
      return duration;
    } finally {
      decoder.free();
    }
  });
}

async function processBook(key) {
  const cfg = BOOKS[key];
  if (!cfg) throw new Error(`Unknown book ${key}`);
  let chapters = JSON.parse(fs.readFileSync(cfg.textFile, "utf-8"));
  if (process.env.TTS_LIMIT) {
    chapters = chapters.slice(0, parseInt(process.env.TTS_LIMIT, 10));
  }
  fs.mkdirSync(cfg.outDir, { recursive: true });

  console.log(`\n=== ${key}: ${chapters.length} chapters -> ${cfg.outDir} ===`);

  const padWidth = String(Math.max(...chapters.map((c) => c.chapter))).length >= 3 ? 2 : 2;
  const tracks = [];

  // Load any existing manifest so already-known durations don't need re-decoding on every
  // incremental write below (only newly-appearing files get decoded).
  const manifestPath = path.join(cfg.outDir, "manifest.json");
  const knownByTrack = new Map();
  if (fs.existsSync(manifestPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const t of prev.tracks || []) knownByTrack.set(t.track, t);
    } catch {
      // ignore a corrupt/partial manifest, will be rebuilt from scratch below
    }
  }
  const manifestTracksLive = [];

  function writeManifestIncremental() {
    const sorted = [...manifestTracksLive].sort((a, b) => a.track - b.track);
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ identifier: cfg.identifier, volume: cfg.volume, tracks: sorted }, null, 2),
      "utf-8"
    );
  }

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const num = ch.chapter;
    const shortTitle = slugify(ch.title || "");
    const numStr = String(num).padStart(padWidth, "0");
    const fileBase = `${numStr} - Chapter ${num} - ${shortTitle}`;
    const fname = `${fileBase}.mp3`.replace(/\s+\.mp3$/, ".mp3");
    const outPath = path.join(cfg.outDir, fname);

    const introLine = `Chapter ${num}: ${ch.title}.`;
    const fullTitle = `${numStr} - Chapter ${num}: ${ch.title}`;

    let needsSynth = true;
    if (fs.existsSync(outPath) && fs.statSync(outPath).size >= MIN_VALID_FILE_BYTES) {
      needsSynth = false;
    }

    let durationSeconds = null;

    if (needsSynth) {
      console.log(`  [${i + 1}/${chapters.length}] Synthesizing chapter ${num}: "${ch.title}"...`);
      try {
        const buf = await synthChapter(introLine, ch.paragraphs);
        const duration = await verifyAndGetDuration(buf);
        fs.writeFileSync(outPath, buf);
        durationSeconds = Math.round(duration);
        console.log(`    -> ${fname} (${buf.length} bytes, ${duration.toFixed(1)}s)`);
      } catch (err) {
        console.error(`    FAILED chapter ${num}: ${err.message}`);
        continue; // leave for a future resumed run
      }
    } else {
      console.log(`  [${i + 1}/${chapters.length}] Skipping existing ${fname}`);
      const prevKnown = knownByTrack.get(num);
      if (prevKnown && prevKnown.file === fname) {
        durationSeconds = prevKnown.durationSeconds;
      } else {
        // first time this file's been seen (e.g. migrating from an older manifest) - decode once
        try {
          const buf = fs.readFileSync(outPath);
          durationSeconds = Math.round(await verifyAndGetDuration(buf));
        } catch (err) {
          console.warn(`    WARNING: could not verify existing ${fname}: ${err.message}`);
          continue;
        }
      }
    }

    tracks.push({ track: num, fileBase, fname, fullTitle, outPath });
    manifestTracksLive.push({
      track: num,
      title: fullTitle,
      file: fname,
      questionStart: null,
      questionEnd: null,
      durationSeconds,
      sizeBytes: fs.statSync(outPath).size,
    });
    // Write after every chapter (not just at the end) so the app can pick up newly-finished
    // chapters incrementally rather than waiting for the whole book to complete.
    writeManifestIncremental();
  }

  console.log(`  Final manifest.json: ${manifestTracksLive.length}/${chapters.length} tracks.`);
}

async function main() {
  const arg = process.argv[2] || "all";
  const keys = arg === "all" ? ["book3", "book4"] : [arg];
  for (const key of keys) {
    await processBook(key);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
