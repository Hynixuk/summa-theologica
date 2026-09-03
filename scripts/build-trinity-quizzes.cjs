#!/usr/bin/env node
/**
 * build-trinity-quizzes.cjs
 *
 * Adds window.QUIZZES.trinity = {...} to app/data-quizzes.js, using the same
 * flat "TRIN-B{book}C{chapter}" -> [ {q, options, correct, explanation} x3 ] shape
 * as the st/scg/metaphysics sections already there.
 *
 * Source: data/summaries/trinity-quizzes-complete.json
 *
 * This script only ADDS/UPDATES the `trinity` key of window.QUIZZES; it
 * preserves the existing st/scg/metaphysics quiz content verbatim.
 *
 * Usage: node scripts/build-trinity-quizzes.cjs
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const APP = path.join(ROOT, 'app');

const QUIZZES_OUT = path.join(APP, 'data-quizzes.js');
const SRC = path.join(DATA, 'summaries', 'trinity-quizzes-complete.json');

function loadExistingQuizzes() {
  if (!fs.existsSync(QUIZZES_OUT)) return {};
  const code = fs.readFileSync(QUIZZES_OUT, 'utf-8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: QUIZZES_OUT });
  return sandbox.window.QUIZZES || {};
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`Missing source file: ${SRC}`);
    process.exit(1);
  }
  const trinityQuizzes = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
  const chapterCount = Object.keys(trinityQuizzes).length;
  const questionCount = Object.values(trinityQuizzes).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Trinity quiz chapters: ${chapterCount}, questions: ${questionCount}`);

  const quizzes = loadExistingQuizzes();
  quizzes.trinity = trinityQuizzes;

  const output =
    '// Auto-generated — quiz data for ST, SCG, Metaphysics, and Trinity.\n' +
    '// Rebuild trinity section with: node scripts/build-trinity-quizzes.cjs\n' +
    'window.QUIZZES = ' + JSON.stringify(quizzes, null, 2) + ';\n';
  fs.writeFileSync(QUIZZES_OUT, output, 'utf-8');
  console.log(`Wrote ${QUIZZES_OUT}`);
}

main();
