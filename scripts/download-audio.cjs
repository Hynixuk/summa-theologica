// Downloads the 64kbps per-track MP3s for a LibriVox Summa Theologica volume from archive.org
// and writes a manifest.json describing each track (title, file, question range, duration).
// Usage: node download-audio.cjs <archiveIdentifier> <volumeNum> <outDir>

const fs = require('fs');
const path = require('path');

function slugify(title) {
  return title
    .replace(/^\s*\d+\s*-\s*/, '') // strip a leading "NN - " the title already carries
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function parseDuration(length) {
  if (length == null) return null;
  const s = String(length);
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  const f = parseFloat(s);
  return isNaN(f) ? null : Math.round(f);
}

function parseQuestionRange(title) {
  const m = title.match(/Questions?\s+(\d+)(?:\s*(?:-|to|through)\s*(\d+))?/i);
  if (!m) return { start: null, end: null };
  const start = parseInt(m[1], 10);
  const end = m[2] ? parseInt(m[2], 10) : start;
  return { start, end };
}

async function main() {
  const [, , identifier, volumeArg, outDir] = process.argv;
  const volume = parseInt(volumeArg, 10);
  if (!identifier || !volume || !outDir) {
    console.error('Usage: node download-audio.cjs <archiveIdentifier> <volumeNum> <outDir>');
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Fetching metadata for ${identifier}...`);
  const metaRes = await fetch(`https://archive.org/metadata/${identifier}`);
  const meta = await metaRes.json();
  const files = meta.files || [];

  // Original VBR mp3 files carry the authoritative track order.
  const originals = files.filter((f) => f.format === 'VBR MP3' && f.track);
  const orderByOriginalName = new Map();
  for (const o of originals) {
    const trackNum = parseInt(o.track.split('/')[0], 10);
    orderByOriginalName.set(o.name, trackNum);
  }

  // 64kbps derivatives are what we actually download (much smaller, same title tag).
  let derivatives = files.filter((f) => f.format === '64Kbps MP3');

  derivatives = derivatives.map((d) => {
    const trackNum = orderByOriginalName.get(d.original) ?? null;
    return { ...d, trackNum };
  });

  derivatives.sort((a, b) => {
    if (a.trackNum != null && b.trackNum != null) return a.trackNum - b.trackNum;
    return a.name.localeCompare(b.name);
  });

  if (derivatives.length === 0) {
    console.error('No 64Kbps MP3 derivatives found — dumping available formats:');
    console.error([...new Set(files.map((f) => f.format))]);
    process.exit(1);
  }

  console.log(`Found ${derivatives.length} tracks. Downloading...`);

  const tracks = [];
  let i = 0;
  for (const d of derivatives) {
    i++;
    const title = d.title || d.name;
    const { start, end } = parseQuestionRange(title);
    const trackNum = d.trackNum ?? i;
    const fname = `${String(trackNum).padStart(2, '0')} - ${slugify(title)}.mp3`;
    const outPath = path.join(outDir, fname);

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 100000) {
      console.log(`[${i}/${derivatives.length}] Skipping existing ${fname}`);
    } else {
      const url = `https://archive.org/download/${identifier}/${encodeURIComponent(d.name)}`;
      console.log(`[${i}/${derivatives.length}] Downloading ${fname} ...`);
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  FAILED HTTP ${res.status} for ${url}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, buf);
    }

    tracks.push({
      track: trackNum,
      title,
      file: fname,
      questionStart: start,
      questionEnd: end,
      durationSeconds: parseDuration(d.length),
      sizeBytes: d.size ? parseInt(d.size, 10) : null,
    });
  }

  tracks.sort((a, b) => a.track - b.track);

  const manifest = { identifier, volume, tracks };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`\nWrote manifest with ${tracks.length} tracks to ${manifestPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
