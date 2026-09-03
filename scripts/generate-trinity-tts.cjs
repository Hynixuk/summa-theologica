// Generates one TTS narration MP3 per chapter for St. Augustine's "On the
// Trinity" (De Trinitate), all 15 books (no LibriVox or other free
// audiobook recording of this translation exists). Adapted directly from
// generate-scg-tts.cjs: same msedge-tts free neural TTS service, same voice
// (en-GB-RyanNeural, for narration consistency with the rest of the app),
// same manifest.json shape.
//
// Resumable: chapters whose output MP3 already exists (and is a plausible
// size) are skipped for synthesis, but the manifest is always rebuilt from
// whatever files exist on disk so a partial/interrupted run still leaves a
// valid, up-to-date manifest.json.
//
// Usage:
//   node generate-trinity-tts.cjs [book1|book2|...|book15|all]
//   TTS_LIMIT=2 node generate-trinity-tts.cjs book1   (first N chapters only, for testing)

const fs = require("fs");
const path = require("path");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const { MPEGDecoder } = require("mpg123-decoder");

const ROOT = path.join(__dirname, "..");
const VOICE = "en-GB-RyanNeural"; // matches SCG/Metaphysics narration voice
const OUTPUT_FORMAT_USED = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const MAX_BATCH_CHARS = 3000;
const MAX_PARAGRAPH_CHARS = 3000;
const MIN_VALID_FILE_BYTES = 20000;
const MAX_RETRIES = 4;

const BOOK_COUNT = 15;

function bookConfig(book) {
  const n = String(book).padStart(2, "0");
  return {
    textFile: path.join(ROOT, "data", "text", `trinity_book${book}.json`),
    outDir: path.join(ROOT, "audio", `trinity_book${n}`),
    volume: 200 + book, // arbitrary namespace distinct from ST(1-14)/SCG(101-104)/Metaphysics
    identifier: `trinity_book${n}_tts_msedge`,
  };
}

// msedge-tts wraps our text in an SSML template but does not escape it
// itself (its README explicitly warns callers to do this).
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

function buildBatches(introLine, paragraphs) {
  const units = [introLine, ...paragraphs.map((p) => p.text)].filter(Boolean);

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

function chapterIntroLine(ch) {
  if (ch.chapter === 0) {
    return ch.title ? `${ch.title}.` : "Introduction.";
  }
  return `Chapter ${ch.chapter}: ${ch.title}.`;
}

async function processBook(book) {
  const cfg = bookConfig(book);
  if (!fs.existsSync(cfg.textFile)) {
    console.log(`  Book ${book}: no text file at ${cfg.textFile}, skipping`);
    return;
  }
  let chapters = JSON.parse(fs.readFileSync(cfg.textFile, "utf-8"));
  if (process.env.TTS_LIMIT) {
    chapters = chapters.slice(0, parseInt(process.env.TTS_LIMIT, 10));
  }
  fs.mkdirSync(cfg.outDir, { recursive: true });

  console.log(`\n=== Book ${book}: ${chapters.length} chapters -> ${cfg.outDir} ===`);

  const padWidth = 2;
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
    const num = ch.chapter; // may be 0 for an Introduction/Preface lead section
    const shortTitle = slugify(ch.title || "");
    const numStr = String(num).padStart(padWidth, "0");
    const chapterLabel = num === 0 ? "Introduction" : `Chapter ${num}`;
    const fileBase = `${numStr} - ${chapterLabel} - ${shortTitle}`;
    const fname = `${fileBase}.mp3`.replace(/\s+\.mp3$/, ".mp3");
    const outPath = path.join(cfg.outDir, fname);

    const introLine = chapterIntroLine(ch);
    const fullTitle = `${numStr} - ${chapterLabel}: ${ch.title}`;

    let needsSynth = true;
    if (fs.existsSync(outPath) && fs.statSync(outPath).size >= MIN_VALID_FILE_BYTES) {
      needsSynth = false;
    }

    let durationSeconds = null;

    if (needsSynth) {
      console.log(`  [${i + 1}/${chapters.length}] Synthesizing ${chapterLabel} (book ${book}): "${ch.title}"...`);
      try {
        const buf = await synthChapter(introLine, ch.paragraphs);
        const duration = await verifyAndGetDuration(buf);
        fs.writeFileSync(outPath, buf);
        durationSeconds = Math.round(duration);
        console.log(`    -> ${fname} (${buf.length} bytes, ${duration.toFixed(1)}s)`);
      } catch (err) {
        console.error(`    FAILED book ${book} chapter ${num}: ${err.message}`);
        continue; // leave for a future resumed run
      }
    } else {
      console.log(`  [${i + 1}/${chapters.length}] Skipping existing ${fname}`);
      const prevKnown = knownByTrack.get(num);
      if (prevKnown && prevKnown.file === fname) {
        durationSeconds = prevKnown.durationSeconds;
      } else {
        try {
          const buf = fs.readFileSync(outPath);
          durationSeconds = Math.round(await verifyAndGetDuration(buf));
        } catch (err) {
          console.warn(`    WARNING: could not verify existing ${fname}: ${err.message}`);
          continue;
        }
      }
    }

    manifestTracksLive.push({
      track: num,
      title: fullTitle,
      file: fname,
      questionStart: null,
      questionEnd: null,
      durationSeconds,
      sizeBytes: fs.statSync(outPath).size,
    });
    writeManifestIncremental();
  }

  console.log(`  Book ${book} final manifest.json: ${manifestTracksLive.length}/${chapters.length} tracks.`);
}

async function main() {
  const arg = process.argv[2] || "all";
  let books;
  if (arg === "all") {
    books = Array.from({ length: BOOK_COUNT }, (_, i) => i + 1);
  } else {
    const m = arg.match(/^book(\d+)$/);
    if (!m) throw new Error(`Unrecognized argument: ${arg} (expected book1..book15 or all)`);
    books = [parseInt(m[1], 10)];
  }
  for (const book of books) {
    await processBook(book);
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
