#!/usr/bin/env node
// Generates TTS audio for ONE book of Aristotle's Metaphysics (Ross 1908 text).
// Designed to run as one of several parallel processes (one per book), each
// owning a disjoint, pre-assigned track-number range so manifest.json merges
// are safe across concurrent runs.
//
// Usage: node generate-metaphysics-tts-onebook.cjs <bookNum> <startTrack>

const fs = require('fs');
const path = require('path');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { MPEGDecoder } = require('mpg123-decoder');

const ROOT = path.join(__dirname, '..');
const TEXT_FILE = path.join(ROOT, 'data', 'text', 'metaphysics.json');
const AUDIO_DIR = path.join(ROOT, 'audio', 'metaphysics');
const MANIFEST_FILE = path.join(AUDIO_DIR, 'manifest.json');

const VOICE = 'en-GB-RyanNeural';
const OUTPUT_FORMAT_USED = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
const MAX_BATCH_CHARS = 3000;
const MAX_PARAGRAPH_CHARS = 3000;
const MAX_RETRIES = 4;

const bookNum = parseInt(process.argv[2], 10);
const startTrack = parseInt(process.argv[3], 10);
if (!bookNum || !startTrack) {
  console.error('Usage: node generate-metaphysics-tts-onebook.cjs <bookNum> <startTrack>');
  process.exit(1);
}

function xmlEscape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function groupChapters(chapters, trackNumStart) {
  const tracks = [];
  let trackNum = trackNumStart;
  let current = [];

  function flush() {
    if (current.length === 0) return;
    const book = current[0].book;
    const first = current[0].chapter;
    const last = current[current.length - 1].chapter;
    const title = first === last ? `Book ${book} Chapter ${first}` : `Book ${book} Chapters ${first}-${last}`;
    tracks.push({
      track: trackNum,
      title,
      file: `${String(trackNum).padStart(2, '0')} - ${title}.mp3`,
      questionStart: null,
      questionEnd: null,
      durationSeconds: null,
      sizeBytes: null,
      chapters: current.map(ch => ({ book: ch.book, chapter: ch.chapter })),
    });
    current = [];
    trackNum++;
  }

  for (const chapter of chapters) {
    if (current.length >= 3) flush();
    current.push(chapter);
  }
  flush();
  return tracks;
}

function buildBatches(paragraphs) {
  const units = paragraphs.map(p => p.text).filter(Boolean);
  const pieces = [];
  for (const unit of units) {
    if (unit.length <= MAX_PARAGRAPH_CHARS) { pieces.push(unit); continue; }
    const sentences = unit.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [unit];
    let cur = '';
    for (const s of sentences) {
      if ((cur + s).length > MAX_PARAGRAPH_CHARS && cur) { pieces.push(cur.trim()); cur = s; }
      else { cur += s; }
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  const batches = [];
  let cur = '';
  for (const piece of pieces) {
    const candidate = cur ? cur + '\n\n' + piece : piece;
    if (candidate.length > MAX_BATCH_CHARS && cur) { batches.push(cur); cur = piece; }
    else { cur = candidate; }
  }
  if (cur) batches.push(cur);
  return batches;
}

function synthOnce(tts, text) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    audioStream.on('data', (d) => chunks.push(d));
    audioStream.on('close', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    audioStream.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
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
      try { if (tts) tts.close(); } catch (_) {}
      console.warn(`    Retry ${attempt}/${MAX_RETRIES} after error: ${err.message}`);
      await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

async function synthTrack(trackChapters, textData) {
  const bufs = [];
  const allParagraphs = [];
  for (const trackCh of trackChapters) {
    const chapter = textData.find(c => c.book === trackCh.book && c.chapter === trackCh.chapter);
    if (chapter && chapter.paragraphs) allParagraphs.push(...chapter.paragraphs);
  }
  const batches = buildBatches(allParagraphs);
  console.log(`    Synthesizing ${batches.length} batches...`);
  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`    Batch ${i + 1}/${batches.length}... `);
    const buf = await synthBatchWithRetry(xmlEscape(batches[i]));
    process.stdout.write(`OK (${(buf.length / 1024).toFixed(1)}KB)\n`);
    bufs.push(buf);
  }
  return Buffer.concat(bufs);
}

function verifyAndGetDuration(buf) {
  const decoder = new MPEGDecoder();
  return decoder.ready.then(() => {
    try {
      const result = decoder.decode(buf);
      const samples = result.channelData[0]?.length || 0;
      if (samples === 0) throw new Error('Decoded to zero samples');
      return samples / result.sampleRate;
    } finally {
      decoder.free();
    }
  });
}

function mergeIntoManifest(bookTracks, ownStart, ownEnd) {
  const manifest = fs.existsSync(MANIFEST_FILE)
    ? JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'))
    : { identifier: 'metaphysics_books_1-14_mixed', volume: 201, tracks: [] };
  manifest.note = 'Books 1-14: TTS (Ross 1908 + msedge-tts)';
  const others = (manifest.tracks || []).filter(t => t.track < ownStart || t.track > ownEnd);
  manifest.tracks = [...others, ...bookTracks].sort((a, b) => a.track - b.track);
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

async function main() {
  console.log(`\n=== Metaphysics TTS: Book ${bookNum} (tracks starting at ${startTrack}) ===\n`);

  const textData = JSON.parse(fs.readFileSync(TEXT_FILE, 'utf-8'));
  const chapters = textData.filter(ch => ch.book === bookNum).sort((a, b) => a.chapter - b.chapter);
  console.log(`Found ${chapters.length} chapters in Book ${bookNum}`);

  const tracks = groupChapters(chapters, startTrack);
  const ownStart = tracks[0]?.track ?? startTrack;
  const ownEnd = tracks[tracks.length - 1]?.track ?? startTrack;
  console.log(`Will generate ${tracks.length} tracks (${ownStart}-${ownEnd})\n`);

  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  for (const track of tracks) {
    const filePath = path.join(AUDIO_DIR, track.file);
    console.log(`Track ${track.track}: ${track.title}`);
    try {
      const audioBuffer = await synthTrack(track.chapters, textData);
      fs.writeFileSync(filePath, audioBuffer);
      const duration = await verifyAndGetDuration(audioBuffer);
      track.durationSeconds = Math.round(duration);
      track.sizeBytes = audioBuffer.length;
      console.log(`  ✓ Wrote ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB (${track.durationSeconds}s)\n`);
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}\n`);
    }
    mergeIntoManifest(tracks, ownStart, ownEnd);
  }

  console.log(`✓ Book ${bookNum} done.`);
}

main().catch((err) => { console.error('Error:', err); process.exit(1); });
