// Assembles scraped text + audio manifests into app/data.js for the reader app.
// Works incrementally: safe to run with only text data, only audio data, or both.
// Usage: node build-data.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEXT_DIR = path.join(ROOT, 'data', 'text');
const AUDIO_DIR = path.join(ROOT, 'audio');
const OUT_FILE = path.join(ROOT, 'app', 'data.js');

const PART_NAMES = {
  1: 'Prima Pars',
  2: 'Prima Secundae Partis',
  3: 'Secunda Secundae Partis',
  4: 'Tertia Pars',
};

// Static catalog of the 14 LibriVox volumes (archive.org identifiers + display titles).
const VOLUME_META = [
  { part: 1, volume: 1, identifier: 'summa_1_01_jr_0901_librivox', title: 'Initial Questions' },
  { part: 1, volume: 2, identifier: 'summa_1_02_jr_0907_librivox', title: 'Trinity and Creation' },
  { part: 1, volume: 3, identifier: 'summa_1_03_1112_librivox', title: 'The Angels and the Six Days' },
  { part: 1, volume: 4, identifier: 'summa_1_04_1312_librivox', title: 'On Man' },
  { part: 1, volume: 5, identifier: 'summa_1_05_1405_librivox', title: 'On the Divine Government' },
  { part: 2, volume: 6, identifier: 'summatheologica06_1507_librivox', title: 'On the Last End, On Human Acts' },
  { part: 2, volume: 7, identifier: 'summatheologica07_1503_librivox', title: 'Treatise on the Passions' },
  { part: 2, volume: 8, identifier: 'summatheologica08_1603_librivox', title: 'Treatise on Habits, Virtues and Vices' },
  { part: 2, volume: 9, identifier: 'summatheologica09_1601_librivox', title: 'Treatise on Law and Grace' },
  { part: 3, volume: 10, identifier: 'summatheologica10_1509_librivox', title: 'Theological Virtues: Faith, Hope, Charity' },
  { part: 3, volume: 11, identifier: 'summatheologica11_1909_librivox', title: 'Cardinal Virtues: Prudence, Justice, Fortitude, Temperance' },
  { part: 3, volume: 12, identifier: 'summatheologica12_1504_librivox', title: 'Gratuitous Graces and the States of Life' },
  { part: 4, volume: 13, identifier: 'summatheologica13_1907_librivox', title: 'The Incarnation and Salvific Acts' },
  { part: 4, volume: 14, identifier: 'summatheologica14_2101_librivox', title: 'The Sacraments' },
];

function loadTextByPart() {
  const byPart = {};
  if (!fs.existsSync(TEXT_DIR)) return byPart;
  for (const file of fs.readdirSync(TEXT_DIR)) {
    if (!file.endsWith('.json') || file.startsWith('test_')) continue;
    const m = file.match(/^part(\d)_/);
    if (!m) continue;
    const part = parseInt(m[1], 10);
    try {
      const arr = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, file), 'utf-8'));
      byPart[part] = arr;
    } catch (e) {
      console.error(`Failed to parse ${file}: ${e.message}`);
    }
  }
  // Fallback: also pick up the small test file if nothing else exists for part 1
  if (!byPart[1]) {
    const testFile = path.join(TEXT_DIR, 'test_vol01_q1-5.json');
    if (fs.existsSync(testFile)) {
      byPart[1] = JSON.parse(fs.readFileSync(testFile, 'utf-8'));
    }
  }
  return byPart;
}

function loadAudioManifest(volumeNum) {
  const dir = path.join(AUDIO_DIR, `vol${String(volumeNum).padStart(2, '0')}`);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse manifest for vol${volumeNum}: ${e.message}`);
    return null;
  }
}

function main() {
  const textByPart = loadTextByPart();

  // Build questions index: key "P{part}Q{question}" -> question object
  const questionsIndex = {};
  for (const part of Object.keys(textByPart)) {
    for (const q of textByPart[part]) {
      questionsIndex[`P${q.part}Q${q.question}`] = q;
    }
  }

  const volumes = VOLUME_META.map((v) => {
    const manifest = loadAudioManifest(v.volume);
    let questionStart = null;
    let questionEnd = null;
    let tracks = [];
    if (manifest) {
      tracks = manifest.tracks.map((t) => ({
        track: t.track,
        title: t.title,
        file: `../audio/vol${String(v.volume).padStart(2, '0')}/${t.file}`,
        questionStart: t.questionStart,
        questionEnd: t.questionEnd,
        durationSeconds: t.durationSeconds,
      }));
      const starts = tracks.map((t) => t.questionStart).filter((x) => x != null);
      const ends = tracks.map((t) => t.questionEnd).filter((x) => x != null);
      if (starts.length) questionStart = Math.min(...starts);
      if (ends.length) questionEnd = Math.max(...ends);
    }

    // Which questions (from scraped text) fall in this volume?
    let questionNumbers = [];
    if (questionStart != null && questionEnd != null) {
      questionNumbers = Object.values(questionsIndex)
        .filter((q) => q.part === v.part && q.question >= questionStart && q.question <= questionEnd)
        .map((q) => q.question)
        .sort((a, b) => a - b);
    } else {
      // No audio manifest yet: fall back to whatever text exists for this part,
      // only for volume 1 as a preview placeholder (avoids duplicating unknown ranges across volumes).
      if (v.volume === 1 && textByPart[1]) {
        questionNumbers = textByPart[1].map((q) => q.question).sort((a, b) => a - b);
      }
    }

    return {
      part: v.part,
      partName: PART_NAMES[v.part],
      volume: v.volume,
      title: v.title,
      identifier: v.identifier,
      questionStart,
      questionEnd,
      questionNumbers,
      tracks,
      hasAudio: tracks.length > 0,
    };
  });

  const out = [];
  out.push('// Auto-generated by scripts/build-data.cjs — do not edit by hand.');
  out.push(`window.SUMMA_VOLUMES = ${JSON.stringify(volumes, null, 2)};`);
  out.push(`window.SUMMA_TEXT = ${JSON.stringify(questionsIndex, null, 2)};`);
  fs.writeFileSync(OUT_FILE, out.join('\n'), 'utf-8');

  const totalQ = Object.keys(questionsIndex).length;
  const volsWithAudio = volumes.filter((v) => v.hasAudio).length;
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  Questions loaded: ${totalQ}`);
  console.log(`  Volumes with audio manifests: ${volsWithAudio}/14`);
}

main();
