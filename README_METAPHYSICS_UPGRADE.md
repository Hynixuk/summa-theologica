# Metaphysics Translation & Audio Upgrade

## Quick Summary

This upgrade replaces Aristotle's Metaphysics Books 3-14 with the **W.D. Ross 1908 translation** (cleaner, more scholarly) while keeping Books 1-2 from LibriVox's McMahon narration for continuity. New TTS audio is generated for Books 3-14 using Microsoft Edge Neural TTS.

### Why This Matters
- **Current McMahon text** (Books 3-14): Heavy OCR artifacts ("Dmibt-its", "yestigation", "drfferent", etc.)
- **New Ross text** (Books 3-14): Clean, scholarly, public-domain 1908 translation
- **Audio**: Consistent `en-GB-RyanNeural` voice for new Books 3-14 TTS

### Status
✓ Research complete — Ross 1908 is best choice  
✓ Scripts created for text extraction & TTS generation  
✓ Merge & build automation ready  
⏳ Awaiting manual text download & execution  

---

## Execution Quickstart (3 Steps)

### Step 1: Get the Ross Text

**Option A: Semi-automated fetch** (requires testing)
```bash
cd scripts
node fetch-ross-from-mit.cjs ../data/text/ross_books_3-14.json 3 14
```
This attempts to fetch from MIT Classics. If it fails, use Option B.

**Option B: Manual + convert** (most reliable)
1. Download from: https://archive.org/details/metaphysics-aristotle-w.d.ross
   - Click "Download Options" → "Full text"
2. Save as: `data/text/ross-raw.txt`
3. Convert:
   ```bash
   node scripts/convert-raw-text-to-json.cjs data/text/ross-raw.txt data/text/ross_books_3-14.json --books 3-14
   ```

### Step 2: Merge & Rebuild

```bash
# Merge Books 1-2 (McMahon) with Books 3-14 (Ross)
node scripts/merge-metaphysics-translations.cjs --backup

# Rebuild app data file
node scripts/build-data-metaphysics.cjs
```

### Step 3: Generate Audio (8-16 hours)

```bash
# Test first (dry-run shows what would be generated)
node scripts/generate-metaphysics-tts.cjs --dry-run

# Generate audio for Books 3-14
node scripts/generate-metaphysics-tts.cjs
```

This will take many hours. It's resumable; if interrupted, just run again.

---

## Complete Documentation

- **METAPHYSICS_UPGRADE_PLAN.md** — Full strategy and rationale
- **UPGRADE_EXECUTION_GUIDE.md** — Detailed step-by-step guide with troubleshooting
- **scripts/fetch-ross-from-mit.cjs** — Fetch from MIT Classics (HTML parsing)
- **scripts/convert-raw-text-to-json.cjs** — Convert raw text files to JSON (more robust)
- **scripts/merge-metaphysics-translations.cjs** — Merge two translations
- **scripts/generate-metaphysics-tts.cjs** — Generate TTS audio

---

## Files This Creates

### Data Files
- `data/text/ross_books_3-14.json` — Intermediate (Books 3-14 only, from Ross)
- `data/text/metaphysics.json` — **Final** (Books 1-2 McMahon + 3-14 Ross) [OVERWRITES ORIGINAL]
- `data/text/metaphysics.json.backup` — Backup of original (if --backup used)

### Audio Files
- `audio/metaphysics/07-32 - Book X Chapters 1-6.mp3` (and more) — New TTS files
- `audio/metaphysics/manifest.json` — **Updated** with all 32+ tracks

### App Files
- `app/data-metaphysics.js` — **Regenerated** with new structure

---

## Why This Approach?

| Aspect | Choice | Why |
|--------|--------|-----|
| **Books 1-2** | Keep McMahon + LibriVox | High-quality existing narration |
| **Books 3-14** | Switch to Ross 1908 | Cleaner OCR, scholarly standard |
| **Audio 1-2** | Keep LibriVox | Consistent narration already exists |
| **Audio 3-14** | New TTS | No LibriVox exists; consistent voice for new section |

---

## Key Numbers

- **14 books total**, 146+ chapters
- **Books 1-2**: 13 chapters (unchanged)
- **Books 3-14**: ~130 chapters (replacing McMahon with Ross)
- **Audio tracks**: 32 total (6 existing + ~26 new TTS)
- **Generation time**: 8-16 hours wall time (much is waiting for synthesis)
- **Disk space needed**: ~150MB for new audio

---

## Verification

After execution, verify:

```bash
# Check merged text
wc -l data/text/metaphysics.json  # Should be ~6000+ lines

# Check audio files
ls -lh audio/metaphysics/*.mp3 | wc -l  # Should be ~32 files

# Check manifest
head -20 audio/metaphysics/manifest.json  # Should list 32+ tracks

# Check app data
head -20 app/data-metaphysics.js  # Should show 14 books
```

Then test in browser:
- Navigate to Metaphysics reader
- Books 1-2: Should play LibriVox (unchanged)
- Books 3-14: Should display Ross text, play new TTS audio

---

## Troubleshooting

### "HTTP 404" from fetch script
- Archive.org URLs may change. Use Option B instead (manual download + convert).

### "0 chapters" after conversion
- Raw text format may not match parser expectations
- Try: `node scripts/convert-raw-text-to-json.cjs --help` for options
- May need manual text cleanup

### TTS generation stalls
- Interrupted by network issue? Just re-run; it resumes from last successful track.
- If persistent: Lower batch size in script (see comments at top of generate-metaphysics-tts.cjs)

### Audio quality issues
- Voice is Microsoft Edge neural `en-GB-RyanNeural` (fixed)
- Bitrate is 48kbps mono (can be tweaked in script if needed)
- Quality should be good for a free neural voice

---

## Support Resources

- **Archive.org**: https://archive.org/details/metaphysics-aristotle-w.d.ross
- **Wikisource** (partial): https://en.wikisource.org/wiki/Metaphysics_(Ross,_1908)
- **MIT Classics**: https://classics.mit.edu/Aristotle/metaphysics.html
- **W.D. Ross Wikipedia**: https://en.wikipedia.org/wiki/W._D._Ross

---

## Next Steps

1. Pick Step 1 option (fetch or manual download)
2. Run Step 2 (merge & rebuild)
3. Decide on Step 3 (TTS generation):
   - Start immediately: `node scripts/generate-metaphysics-tts.cjs`
   - Test first: `node scripts/generate-metaphysics-tts.cjs --limit 10 --dry-run`
   - Test then generate: `node scripts/generate-metaphysics-tts.cjs --limit 10`, then full: `node scripts/generate-metaphysics-tts.cjs`

---

**Created**: August 2026  
**Ross Translation**: W.D. Ross (1908), Oxford Clarendon Press, public domain  
**TTS Voice**: Microsoft Edge Neural TTS, `en-GB-RyanNeural`  
**Project**: Summa Theologiae & Metaphysics Read-Along Series  

