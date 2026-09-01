// Lightweight watcher that keeps app/data-aquinas-commentary.js fresh as the
// per-book generation agents write data/aquinas-commentary/bookN.json over time.
//
// READ-ONLY with respect to data/aquinas-commentary/*.json — only reads those
// and writes app/data-aquinas-commentary.js. Cheap signature check per tick
// (file count + mtime sum + size sum) so idle ticks are nearly free, same
// trick as watch-metaphysics-data.cjs / watch-scg-data.cjs.
//
// Usage: node scripts/watch-aquinas-commentary.cjs [intervalMinutes]
//   intervalMinutes defaults to 1 (short, since this feature is actively
//   being generated right now). Runs indefinitely until killed (Ctrl+C).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'data', 'aquinas-commentary');
const BUILD_SCRIPT = path.join(__dirname, 'build-aquinas-commentary.cjs');

const INTERVAL_MINUTES = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 1;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

function computeSignature() {
  if (!fs.existsSync(SRC_DIR)) return '0:0:0';
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
  let mtimeSum = 0;
  let sizeSum = 0;
  files.forEach((f) => {
    try {
      const st = fs.statSync(path.join(SRC_DIR, f));
      mtimeSum += st.mtimeMs;
      sizeSum += st.size;
    } catch (e) {
      // race with a mid-write agent — ignore, picked up next tick
    }
  });
  return files.length + ':' + Math.round(mtimeSum) + ':' + sizeSum;
}

let lastSignature = null;

function tick() {
  const signature = computeSignature();
  if (signature === lastSignature) return; // nothing changed — stay quiet

  try {
    const output = execFileSync('node', [BUILD_SCRIPT], { cwd: ROOT, encoding: 'utf-8' });
    lastSignature = signature;
    const ts = new Date().toISOString();
    const totalLine = output.split('\n').find((l) => l.includes('Total chapters')) || '';
    console.log(`[${ts}] Refreshed data-aquinas-commentary.js. ${totalLine.trim()}`);
  } catch (e) {
    console.error(`[watch-aquinas-commentary] build failed: ${e.message}`);
  }
}

console.log(
  `[watch-aquinas-commentary] Starting. Watching ${SRC_DIR} every ${INTERVAL_MINUTES} minute(s). ` +
  `Writing app/data-aquinas-commentary.js. Ctrl+C to stop.`
);

tick();
setInterval(tick, INTERVAL_MS);
