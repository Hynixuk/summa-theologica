#!/usr/bin/env node
/**
 * Generates TTS audio for Aristotle's Metaphysics Books 3-14
 * (Books 1-2 keep LibriVox McMahon narration for continuity).
 *
 * Uses Microsoft Edge TTS (en-GB-RyanNeural) for consistent voice,
 * matching the voice used for SCG Books 3-4.
 *
 * Outputs MP3 files to audio/metaphysics/ and updates manifest.json.
 *
 * Resumable: chapters whose output MP3 exists and has plausible size
 * are skipped; run this multiple times if interrupted.
 *
 * Usage:
 *   node generate-metaphysics-tts.cjs [options]
 *
 * Options:
 *   --limit N          Only synthesize first N chapters (for testing)
 *   --start-track N    Start numbering tracks from N (default: 7, after Books 1-2)
 *   --dry-run          Show what would be generated without doing it
 */

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
const MIN_VALID_FILE_BYTES = 20000;
const MAX_RETRIES = 4;

// Parse command-line arguments
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
const startTrackIdx = args.indexOf('--start-track');
const startTrackNum = startTrackIdx >= 0 ? parseInt(args[startTrackIdx + 1], 10) : 7;

function xmlEscape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Group chapters into tracks (matching the existing scheme)
// Books 1-2 have 6 tracks; Books 3-14 will be appended
function groupChaptersIntoTracks(chapters) {
  // Load existing manifest to see the grouping pattern
  const tracks = [];

  if (fs.existsSync(MANIFEST_FILE)) {
    const existing = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
    tracks.push(...existing.tracks || []);
  }

  // Group books 3-14 chapters into logical track bundles
  const books3_14 = chapters.filter(ch => ch.book >= 3);

  let trackNum = Math.max(...tracks.map(t => t.track || 0)) + 1 || startTrackNum;
  let currentTrackChapters = [];

  function flush() {
    if (currentTrackChapters.length === 0) return;
    const book = currentTrackChapters[0].book;
    const first = currentTrackChapters[0].chapter;
    const last = currentTrackChapters[currentTrackChapters.length - 1].chapter;
    const trackTitle = first === last
      ? `Book ${book} Chapter ${first}`
      : `Book ${book} Chapters ${first}-${last}`;
    tracks.push({
      track: trackNum,
      title: trackTitle,
      file: `${String(trackNum).padStart(2, '0')} - ${trackTitle}.mp3`,
      questionStart: null,
      questionEnd: null,
      durationSeconds: null,
      sizeBytes: null,
      chapters: currentTrackChapters.map(ch => ({ book: ch.book, chapter: ch.chapter })),
    });
    currentTrackChapters = [];
    trackNum++;
  }

  for (const chapter of books3_14) {
    const bookChanged = currentTrackChapters.length > 0 && chapter.book !== currentTrackChapters[0].book;
    if (bookChanged || currentTrackChapters.length >= 3) {
      flush();
    }
    currentTrackChapters.push(chapter);
  }
  flush();

  return tracks;
}

function buildBatches(paragraphs) {
  const units = paragraphs.map(p => p.text).filter(Boolean);
  const pieces = [];

  for (const unit of units) {
    if (unit.length <= MAX_PARAGRAPH_CHARS) {
      pieces.push(unit);
      continue;
    }
    // Split long paragraphs by sentence
    const sentences = unit.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || [unit];
    let cur = '';
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
  let cur = '';
  for (const piece of pieces) {
    const candidate = cur ? cur + '\n\n' + piece : piece;
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
    audioStream.on('data', (d) => chunks.push(d));
    audioStream.on('close', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    audioStream.on('error', (e) => {
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
    if (chapter && chapter.paragraphs) {
      allParagraphs.push(...chapter.paragraphs);
    }
  }

  const batches = buildBatches(allParagraphs);
  console.log(`    Synthesizing ${batches.length} batches...`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`    Batch ${i + 1}/${batches.length}... `);
    const buf = await synthBatchWithRetry(xmlEscape(batch));
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

async function main() {
  console.log(`\n=== Metaphysics TTS Generation (Books 3-14) ===`);
  console.log(`Voice: ${VOICE}`);
  console.log(`Format: MP3 (24kHz, 48kbps mono)`);
  console.log(`Output: ${AUDIO_DIR}\n`);

  // Read text data
  let textData = JSON.parse(fs.readFileSync(TEXT_FILE, 'utf-8'));
  if (limit) {
    textData = textData.slice(0, limit);
  }

  // Filter to Books 3-14
  const books3_14 = textData.filter(ch => ch.book >= 3);
  console.log(`Found ${books3_14.length} chapters (Books 3-14)\n`);

  // Create audio directory
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  // Group into tracks
  const tracks = groupChaptersIntoTracks(books3_14);
  const newTracks = tracks.filter(t => t.chapters?.length > 0);

  console.log(`Will generate ${newTracks.length} tracks\n`);

  if (dryRun) {
    console.log('DRY RUN - showing what would be generated:\n');
    for (const track of newTracks) {
      console.log(`  Track ${track.track}: ${track.title}`);
      console.log(`    File: ${track.file}`);
      const chapters = track.chapters || [];
      console.log(`    Chapters: ${chapters.map(c => `${c.book}.${c.chapter}`).join(', ')}`);
    }
    console.log('\n(Use without --dry-run to actually generate audio)');
    return;
  }

  // Generate audio for each track
  for (const track of newTracks) {
    if (!track.chapters || track.chapters.length === 0) continue;

    const filePath = path.join(AUDIO_DIR, track.file);
    const exists = fs.existsSync(filePath);
    const size = exists ? fs.statSync(filePath).size : 0;
    const valid = size >= MIN_VALID_FILE_BYTES;

    console.log(`Track ${track.track}: ${track.title}`);

    if (valid) {
      console.log(`  (Already exists, skipping synthesis)\n`);
      continue;
    }

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
  }

  // Update manifest
  const manifest = {
    identifier: 'metaphysics_books_1-14_mixed',
    volume: 201,
    note: 'Books 1-2: LibriVox (McMahon 1857), Books 3-14: TTS (Ross 1908 + msedge-tts)',
    tracks: tracks,
  };

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  console.log(`✓ Updated manifest.json with ${tracks.length} tracks`);
  console.log(`\nNext: node scripts/build-data-metaphysics.cjs`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
