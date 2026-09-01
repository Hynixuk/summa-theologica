# Metaphysics Upgrade Execution Guide

This guide walks through upgrading Books 3-14 from the McMahon 1857 translation (OCR artifacts) to the W.D. Ross 1908 translation (clean, scholarly).

## Prerequisites

- Node.js installed (your scripts directory already uses it)
- `msedge-tts` and `mpg123-decoder` npm packages (already in package.json)
- Internet access (to fetch from archive.org / MIT Classics)

## Execution Steps

### Step 1: Fetch the Ross Translation (Books 3-14)

This script fetches clean HTML from MIT Classics Archive and converts it to JSON.

```bash
cd scripts
node fetch-ross-from-mit.cjs ../data/text/ross_books_3-14.json 3 14
```

**What it does:**
- Downloads HTML for Books 3-14 from https://classics.mit.edu/Aristotle/metaphysics
- Parses chapter boundaries and paragraphs
- Outputs `data/text/ross_books_3-14.json`

**Expected output:**
```
=== Fetching Ross translation (Books 3-14) ===
Fetching Book 3 from https://classics.mit.edu/Aristotle/metaphysics.3.iii.html...
  Book 3: 6 chapters
...
Wrote 130 chapters to data/text/ross_books_3-14.json
```

**Troubleshooting:**
- If fetch fails: Check your internet connection, or manually download from https://archive.org/details/metaphysics-aristotle-w.d.ross
- If parsing produces 0 chapters: The HTML structure may have changed; see notes at end

### Step 2: Merge Translations (Books 1-2 McMahon + Books 3-14 Ross)

This merges your existing metaphysics.json with the new Ross books, keeping Books 1-2 unchanged.

```bash
node merge-metaphysics-translations.cjs --backup
```

**What it does:**
- Extracts Books 1-2 from your current metaphysics.json (McMahon)
- Combines with Books 3-14 from ross_books_3-14.json (Ross)
- Replaces metaphysics.json with the merged version
- Backs up the original to metaphysics.json.backup

**Expected output:**
```
=== Merging Metaphysics Translations ===
Books 1-2:  McMahon 1857 (original)
Books 3-14: W.D. Ross 1908 (new)

✓ Found Books 1-2: 13 chapters (McMahon)
✓ Total books: 14 (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14)

=== Chapter Counts ===
  Book  1: 10 chapters ✓ (expected 10)
  Book  2:  3 chapters ✓ (expected 3)
  Book  3:  6 chapters ✓ (expected 6)
  ...
  Book 14:  6 chapters ✓ (expected 6)

Total: 146 chapters
✓ Wrote merged metaphysics.json
```

**Verify quality:**
- Check `data/text/metaphysics.json` manually (should look cleaner than before)
- Example: Book III Chapter 1 should start with something like "We must, with a view to the science which we are seeking..." (no garbage like "Dmibt-its")

### Step 3: Rebuild App Data File

This regenerates `app/data-metaphysics.js` (which loads at runtime) from the new metaphysics.json.

```bash
node build-data-metaphysics.cjs
```

**What it does:**
- Reads the merged metaphysics.json
- Extracts chapter count and book structure
- Writes `app/data-metaphysics.js` with metadata (titles, chapter counts, audio track pointers)

**Expected output:**
```
Loading books from data/text/metaphysics.json...
Found 14 books, 146 chapters total

Writing app/data-metaphysics.js...
✓ Complete
```

### Step 4: Generate TTS Audio for Books 3-14 (OPTIONAL - Can Take 12-20 Hours)

This is the longest step. It uses Microsoft Edge TTS to generate MP3 files for Books 3-14.

**Option A: Dry-run first (to preview without generating)**
```bash
node generate-metaphysics-tts.cjs --dry-run
```

**Option B: Full generation**
```bash
node generate-metaphysics-tts.cjs
```

**Option C: Test with limited chapters first**
```bash
node generate-metaphysics-tts.cjs --limit 10
```
This generates TTS for only the first 10 chapters, taking ~20-30 minutes. Useful for testing before committing to the full run.

**What it does:**
- Reads text from Books 3-14 in metaphysics.json
- Groups chapters into ~3-chapter-per-track bundles
- Synthesizes each track using `en-GB-RyanNeural` voice
- Writes MP3 files to `audio/metaphysics/` (tracks 07-32)
- Updates `audio/metaphysics/manifest.json`

**Expected output (partial):**
```
=== Metaphysics TTS Generation (Books 3-14) ===
Voice: en-GB-RyanNeural
Format: MP3 (24kHz, 48kbps mono)
Output: audio/metaphysics

Found 130 chapters (Books 3-14)

Will generate 26 tracks

Track 7: Book 3 Chapters 1-4
  Synthesizing 15 batches...
    Batch 1/15... OK (245.3KB)
    Batch 2/15... OK (251.8KB)
    ...
  ✓ Wrote 5.2MB (413s)

Track 8: Book 3 Chapters 5-6
  ...
```

**Estimated time:**
- ~50-100 characters per second of synthesis
- Books 3-14 ≈ 350,000 characters → 3,500-7,000 seconds (1-2 hours wall time, but with batching and retries)
- **Estimated total: 8-16 hours** (varies with network, system load)

**Resume capability:**
- If interrupted, just run the script again
- Tracks that have valid MP3 files are skipped
- Partial run will still produce a valid manifest.json

### Step 5: Verify in App

Once TTS is generated, rebuild and test the app:

```bash
# Terminal 1: Start the dev server
node scripts/serve.cjs

# Terminal 2 (or browser): Open http://localhost:3000
# Navigate to Metaphysics reader
# Test Books 1-2 (should play LibriVox audio)
# Test Books 3-14 (should play new TTS audio with Ross text)
```

Check:
- ✓ Books 1-2 play LibriVox audio (unchanged)
- ✓ Books 3-14 display Ross text (no OCR artifacts)
- ✓ Books 3-14 play new TTS audio
- ✓ Text matches audio playback position

## What Each File Does

### Input Files
- `data/text/metaphysics.json` — Your current merged text (will be replaced)

### Temporary Files (created during execution)
- `data/text/ross_books_3-14.json` — Intermediate: Ross Books 3-14 only
- `data/text/metaphysics.json.backup` — Backup of original (if --backup flag used)

### Output Files (after execution)
- `data/text/metaphysics.json` — Updated with Books 1-2 McMahon + Books 3-14 Ross
- `audio/metaphysics/*.mp3` — New TTS audio files (tracks 07-32)
- `audio/metaphysics/manifest.json` — Updated manifest with new tracks
- `app/data-metaphysics.js` — Regenerated app data (auto-loaded at startup)

## Rollback

If something goes wrong:

```bash
# Restore original metaphysics.json
cp data/text/metaphysics.json.backup data/text/metaphysics.json

# Rebuild app data
node build-data-metaphysics.cjs

# Restart server/app
```

The new audio files (tracks 07-32) can be deleted, or just leave them; the old manifest will simply not reference them.

## Troubleshooting

### Script fails at fetch step
- **Issue**: "HTTP 404" on MIT Classics URL
- **Solution**: MIT Classics URLs may have changed. Try downloading from archive.org instead:
  ```
  https://archive.org/details/metaphysics-aristotle-w.d.ross
  ```
  Download the "Full text" file and save as `data/text/ross-raw.txt`, then manually parse into JSON using the merge script logic as a template.

### Merge produces 0 chapters
- **Issue**: One of the input files wasn't found or is empty
- **Solution**: 
  - Verify `data/text/metaphysics.json` exists and is valid JSON
  - Verify `data/text/ross_books_3-14.json` was created in step 1
  - Check file sizes: should both be >10KB

### TTS generation stalls
- **Issue**: Network timeout or Edge TTS connection dropped
- **Solution**: 
  - Retry the command; it will resume from where it left off
  - If persistent, reduce batch size in the script (change `MAX_BATCH_CHARS = 3000` to 1500)

### Audio quality sounds wrong
- **Issue**: TTS voice is too fast/slow, or quality is poor
- **Solution**:
  - This is the Microsoft Edge neural voice; quality is good by default
  - Voice can't be changed without editing the script (line: `const VOICE = ...`)
  - Bitrate can be tuned (currently 48kbps; try `OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3` for higher quality)

## Success Criteria

After all steps:
- ✓ `data/text/metaphysics.json` contains Books 1-14 with no OCR artifacts (Books 1-2 unchanged, 3-14 clean Ross)
- ✓ `audio/metaphysics/` contains MP3 files for all chapters (mix of LibriVox + new TTS)
- ✓ `audio/metaphysics/manifest.json` lists all 32+ tracks
- ✓ App loads both text and audio without errors
- ✓ Playback is synchronized: text highlights as audio plays

## Additional Notes

### Why This Approach?
- **Books 1-2 unchanged**: Preserves existing LibriVox narration for those chapters (high quality, consistent narration)
- **Books 3-14 Ross + TTS**: Cleaner text than McMahon, new audio matches new text translation
- **Resumable**: TTS generation can take hours; if interrupted, just re-run and it picks up where it left off

### Quality Comparison
- **McMahon (current)**: 1857 scan, heavy OCR artifacts, but has LibriVox narration for Books 1-2
- **Ross 1908 (new)**: Cleaner OCR, scholarly standard, consistent with modern Aristotle scholarship
- **TTS audio (new)**: Neural TTS is good for Books 3-14 where no high-quality recording exists

## Support

If you encounter issues not covered above, check:
1. Script permissions (chmod +x generate-*.cjs on Linux/Mac)
2. Node modules installed (npm install in scripts/ if needed)
3. Disk space (TTS generates ~5-6MB per track, ~150MB total for Books 3-14)
4. Network connectivity (for archive.org and Edge TTS)

