#!/usr/bin/env node
// Supervises align-corpus.mjs: restarts it, and if it stalls (no new log
// output for STALL_MINUTES) it kills the child, figures out which file was
// stuck from the log, marks that file "skipped" in progress.json, and
// relaunches — so the corpus finishes without a human babysitting it.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PROGRESS_FILE = path.join(ROOT, "data", "alignment", "progress.json");
const LOG_FILE = path.join(__dirname, "align_supervised.log");

const STALL_MINUTES = 15;
const CHECK_INTERVAL_MS = 60 * 1000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + "\n");
}

function loadProgress() {
  return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
}
function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2));
}

function markSkipped(relPath, reason) {
  const p = loadProgress();
  if (p.done[relPath]) return false; // already handled
  p.done[relPath] = { status: "skipped", reason, skippedAt: new Date().toISOString() };
  saveProgress(p);
  log(`Marked skipped: ${relPath} (${reason})`);
  return true;
}

async function runOnce() {
  return new Promise((resolve) => {
    let buf = "";
    let lastOutputAt = Date.now();
    let currentFile = null; // last "[N/M] relPath" seen without a following result line

    const child = spawn("node", [path.join(__dirname, "align-corpus.mjs")], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const onData = (chunk) => {
      const text = chunk.toString();
      buf += text;
      lastOutputAt = Date.now();
      fs.appendFileSync(LOG_FILE, text);

      // Track the most recent "[i/n] relPath" line
      const lines = text.split("\n");
      for (const line of lines) {
        const m = line.match(/^\[\d+\/\d+\]\s+(.+)$/);
        if (m) currentFile = m[1].trim();
        if (/^\s*(OK:|PARTIAL:|FAILED:)/.test(line)) currentFile = null; // that file resolved
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      resolve(result);
    };

    const watchdog = setInterval(() => {
      const idleMin = (Date.now() - lastOutputAt) / 60000;
      if (idleMin >= STALL_MINUTES) {
        log(`STALL DETECTED: no output for ${idleMin.toFixed(1)} min. Stuck file: ${currentFile || "(unknown)"}`);
        try {
          child.kill("SIGKILL");
        } catch (_) {}
        if (currentFile) {
          markSkipped(currentFile, `Stalled the WASM whisper pipeline for ${STALL_MINUTES}+ min with no progress`);
        }
        finish({ stalled: true, stuckFile: currentFile });
      }
    }, CHECK_INTERVAL_MS);

    child.on("exit", (code) => {
      log(`Child exited with code ${code}.`);
      finish({ exitCode: code });
    });
  });
}

async function main() {
  log("=== Alignment supervisor starting ===");
  // Safety cap so a persistent bug can't loop forever without visibility
  for (let attempt = 1; attempt <= 400; attempt++) {
    const p = loadProgress();
    const doneCount = Object.keys(p.done || {}).length;
    log(`Attempt ${attempt}: ${doneCount} files done/skipped so far. Launching align-corpus.mjs...`);

    const result = await runOnce();

    if (result.exitCode === 0) {
      log("align-corpus.mjs completed normally (batch run complete). Supervisor exiting.");
      return;
    }
    if (result.stalled) {
      log(`Recovered from stall (stuck on ${result.stuckFile || "unknown file"}). Relaunching...`);
      continue;
    }
    // Non-zero, non-stall exit (real crash) — brief pause then retry, resume via progress.json
    log(`Child crashed (exit code ${result.exitCode}). Retrying in 10s...`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  log("Hit max supervisor attempts (400). Stopping — check logs.");
}

main().catch((e) => {
  log(`Supervisor fatal error: ${e.stack || e.message}`);
  process.exit(1);
});
