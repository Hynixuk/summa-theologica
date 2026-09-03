#!/usr/bin/env node
// Rebuilds app/audio-urls.js from the REAL assets currently uploaded to the
// audio-v1/v2/v3 GitHub Releases, matched back to local files by name.
//
// Why this exists: earlier generators wrote placeholder URLs (patterns like
// "st-P1-1.mp3") that were never actually uploaded anywhere — 89% of the
// previous audio-urls.js 404s. This version only ever writes a URL that was
// verified to exist in one of the release asset listings.
//
// Usage: node scripts/build-audio-urls.cjs <path-to-assets.json> [<path-to-assets.json> ...]
// Each assets.json is an array of {name, url} as returned by the GitHub
// Releases "list assets" API (browser_download_url as `url`).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');
const OUT_FILE = path.join(ROOT, 'app', 'audio-urls.js');

const assetFiles = process.argv.slice(2);
if (!assetFiles.length) {
  console.error('Usage: node build-audio-urls.cjs <assets.json> [<assets.json> ...]');
  process.exit(1);
}

// GitHub's own asset-name sanitization: every maximal run of characters
// outside [A-Za-z0-9-] collapses to a single '.'. Verified against real
// uploaded names, e.g. "01 - I. IN WHAT ... (preceded by Translator's
// Preface).mp3" -> "01.-.I.IN.WHAT...preceded.by.Translator.s.Preface.mp3".
function githubSanitize(name) {
  return name.replace(/[^A-Za-z0-9-]+/g, '.');
}

// Load and merge all provided asset listings into sanitizedName -> url.
const assetByName = new Map();
for (const f of assetFiles) {
  const list = JSON.parse(fs.readFileSync(f, 'utf-8'));
  list.forEach((a) => {
    if (!assetByName.has(a.name)) assetByName.set(a.name, a.url);
  });
}
console.log(`Loaded ${assetByName.size} unique uploaded asset names from ${assetFiles.length} listing(s).`);

const audioMap = {};
let matched = 0, missing = 0;
const missingList = [];

function resolveLocalFile(relPathFromAudioDir) {
  const localName = path.basename(relPathFromAudioDir);
  const sanitized = githubSanitize(localName);
  const url = assetByName.get(sanitized);
  if (!url) { missing++; missingList.push(relPathFromAudioDir); return null; }
  matched++;
  return url;
}

// ---- Metaphysics: "B{book}C{chapter}" ----
// The local audio/metaphysics files are finer-grained (52 files, mostly one
// per 1-3 chapters) than the 32-track LibriVox scheme build-data-metaphysics.cjs's
// header comment describes — that comment is stale. Rather than re-deriving
// chapter ranges here (a second place to get wrong), read the chapter ->
// audioTrack mapping straight out of the already-correct app/data-metaphysics.js.
const metaManifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'metaphysics', 'manifest.json'), 'utf-8'));
const metaTrackFile = {};
metaManifest.tracks.forEach((t) => { metaTrackFile[t.track] = t.file; });

const metaDataSrc = fs.readFileSync(path.join(ROOT, 'app', 'data-metaphysics.js'), 'utf-8');
const metaTextMatch = metaDataSrc.match(/window\.METAPHYSICS_TEXT\s*=\s*(\{[\s\S]*\});?\s*$/);
if (!metaTextMatch) throw new Error('Could not find METAPHYSICS_TEXT in data-metaphysics.js');
const metaText = JSON.parse(metaTextMatch[1]);

Object.keys(metaText).forEach((key) => {
  const entry = metaText[key];
  if (!entry || !entry.hasAudio || entry.audioTrack == null) return;
  const file = metaTrackFile[entry.audioTrack];
  if (!file) return;
  const url = resolveLocalFile(path.join('metaphysics', file));
  if (!url) return;
  audioMap[key] = url;
});

// ---- SCG: "SCG-B{book}C{chapter}" (track N = chapter N, 1:1) ----
for (let book = 1; book <= 4; book++) {
  const manifestPath = path.join(AUDIO_DIR, `scg_book${book}`, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.tracks.forEach((t) => {
    const url = resolveLocalFile(path.join(`scg_book${book}`, t.file));
    if (!url) return;
    audioMap[`SCG-B${book}C${t.track}`] = url;
  });
}

// ---- ST: "ST-VOL{vol}-T{index}" (index within manifest.tracks array,
// matching build-data.cjs's (i + 1) — NOT t.track, which isn't guaranteed
// unique within a volume) ----
for (let vol = 1; vol <= 14; vol++) {
  const volStr = String(vol).padStart(2, '0');
  const manifestPath = path.join(AUDIO_DIR, `vol${volStr}`, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.tracks.forEach((t, i) => {
    const url = resolveLocalFile(path.join(`vol${volStr}`, t.file));
    if (!url) return;
    audioMap[`ST-VOL${volStr}-T${String(i + 1).padStart(2, '0')}`] = url;
  });
}

console.log(`Matched ${matched} local files to real uploaded URLs.`);
if (missing) {
  console.log(`⚠ ${missing} local files had no matching uploaded asset:`);
  missingList.slice(0, 20).forEach((f) => console.log('   -', f));
  if (missingList.length > 20) console.log(`   ... and ${missingList.length - 20} more`);
}

const out = [];
out.push('// Auto-generated by scripts/build-audio-urls.cjs — do not edit by hand.');
out.push('// Every URL here was verified against a real GitHub Releases asset listing');
out.push('// (see the script for how) rather than assumed/pattern-generated.');
out.push(`window.AUDIO_URLS = ${JSON.stringify(audioMap, null, 2)};`);
fs.writeFileSync(OUT_FILE, out.join('\n') + '\n', 'utf-8');
console.log(`\nWrote ${Object.keys(audioMap).length} keys to ${OUT_FILE}`);
