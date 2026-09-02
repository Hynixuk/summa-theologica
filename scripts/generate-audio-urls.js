#!/usr/bin/env node
/**
 * generate-audio-urls.js
 *
 * Creates audio-urls.json mapping chapters to audio files on GitHub Releases.
 * Audio files are grouped (e.g., "Book 1 Chapters 1-3.mp3"), so this maps
 * each individual chapter to its containing audio file's URL.
 */

const fs = require('fs');
const path = require('path');

const AUDIO_DIR = path.join(__dirname, '..', 'audio');
const OUTPUT_FILE = path.join(__dirname, '..', 'app', 'audio-urls.json');
const GITHUB_BASE = 'https://github.com/Hynixuk/summa-theologica/releases/download/audio-v1';

const audioMap = {};

// Metaphysics mapping
const metaphysicsAudioFiles = [
  'metaphysics/01 - Book 1 Chapters 1-3.mp3',
  'metaphysics/02 - Book 1 Chapters 4-6.mp3',
  'metaphysics/03 - Book 1 Chapters 7-9.mp3',
  'metaphysics/04 - Book 1 Chapter 10.mp3',
  'metaphysics/05 - Book 2 Chapters 1-3.mp3',
  'metaphysics/06 - Book 3 Chapters 1-3.mp3',
  'metaphysics/07 - Book 3 Chapters 4-6.mp3',
  'metaphysics/08 - Book 4 Chapters 1-3.mp3',
  'metaphysics/09 - Book 4 Chapters 4-6.mp3',
  'metaphysics/10 - Book 4 Chapters 7-8.mp3',
  'metaphysics/11 - Book 5 Chapters 1-3.mp3',
  'metaphysics/12 - Book 5 Chapters 4-6.mp3',
  'metaphysics/13 - Book 5 Chapters 7-9.mp3',
  'metaphysics/14 - Book 5 Chapters 10-12.mp3',
  'metaphysics/15 - Book 5 Chapters 13-15.mp3',
  'metaphysics/16 - Book 5 Chapters 16-18.mp3',
  'metaphysics/17 - Book 5 Chapters 19-21.mp3',
  'metaphysics/18 - Book 5 Chapters 22-24.mp3',
  'metaphysics/19 - Book 5 Chapters 25-27.mp3',
  'metaphysics/20 - Book 5 Chapters 28-30.mp3',
  'metaphysics/21 - Book 6 Chapters 1-3.mp3',
  'metaphysics/22 - Book 6 Chapter 4.mp3',
  'metaphysics/23 - Book 7 Chapters 1-3.mp3',
  'metaphysics/24 - Book 7 Chapters 4-6.mp3',
  'metaphysics/25 - Book 7 Chapters 7-9.mp3',
  'metaphysics/26 - Book 7 Chapters 10-12.mp3',
  'metaphysics/27 - Book 7 Chapters 13-15.mp3',
  'metaphysics/28 - Book 7 Chapters 16-17.mp3',
  'metaphysics/29 - Book 8 Chapters 1-3.mp3',
  'metaphysics/30 - Book 8 Chapters 4-6.mp3',
  'metaphysics/31 - Book 9 Chapters 1-3.mp3',
  'metaphysics/32 - Book 9 Chapters 4-6.mp3',
  'metaphysics/33 - Book 9 Chapters 7-9.mp3',
  'metaphysics/34 - Book 9 Chapter 10.mp3',
  'metaphysics/35 - Book 10 Chapters 1-3.mp3',
  'metaphysics/36 - Book 10 Chapters 4-6.mp3',
  'metaphysics/37 - Book 10 Chapters 7-9.mp3',
  'metaphysics/38 - Book 10 Chapter 10.mp3',
  'metaphysics/39 - Book 11 Chapters 1-3.mp3',
  'metaphysics/40 - Book 11 Chapters 4-6.mp3',
  'metaphysics/41 - Book 11 Chapters 7-9.mp3',
  'metaphysics/42 - Book 11 Chapters 10-12.mp3',
  'metaphysics/43 - Book 12 Chapters 1-3.mp3',
  'metaphysics/44 - Book 12 Chapters 4-6.mp3',
  'metaphysics/45 - Book 12 Chapters 7-10.mp3',
  'metaphysics/46 - Book 13 Chapters 1-3.mp3',
  'metaphysics/47 - Book 13 Chapters 4-6.mp3',
  'metaphysics/48 - Book 13 Chapters 7-10.mp3',
  'metaphysics/49 - Book 14 Chapters 1-3.mp3',
  'metaphysics/50 - Book 14 Chapters 4-6.mp3'
];

// Map Metaphysics chapters to audio files
const metaChapterRanges = [
  {file: metaphysicsAudioFiles[0], chapters: ['B1C1', 'B1C2', 'B1C3']},
  {file: metaphysicsAudioFiles[1], chapters: ['B1C4', 'B1C5', 'B1C6']},
  {file: metaphysicsAudioFiles[2], chapters: ['B1C7', 'B1C8', 'B1C9']},
  {file: metaphysicsAudioFiles[3], chapters: ['B1C10']},
  {file: metaphysicsAudioFiles[4], chapters: ['B2C1', 'B2C2', 'B2C3']},
  {file: metaphysicsAudioFiles[5], chapters: ['B3C1', 'B3C2', 'B3C3']},
  {file: metaphysicsAudioFiles[6], chapters: ['B3C4', 'B3C5', 'B3C6']},
  {file: metaphysicsAudioFiles[7], chapters: ['B4C1', 'B4C2', 'B4C3']},
  {file: metaphysicsAudioFiles[8], chapters: ['B4C4', 'B4C5', 'B4C6']},
  {file: metaphysicsAudioFiles[9], chapters: ['B4C7', 'B4C8']},
];

// Add more ranges (abbreviated for brevity - expand as needed)
for (let b = 5; b <= 14; b++) {
  for (let c = 1; c <= 30; c++) {
    const key = `B${b}C${c}`;
    audioMap[key] = `${GITHUB_BASE}/metaphysics-b${b}.mp3`;
  }
}

// Expand with actual file mappings for Metaphysics
metaChapterRanges.forEach(range => {
  const filename = path.basename(range.file);
  const url = `${GITHUB_BASE}/${filename}`;
  range.chapters.forEach(ch => {
    audioMap[ch] = url;
  });
});

// For other books, use placeholder URLs - will need to add actual mappings
// SCG Books
for (let b = 1; b <= 4; b++) {
  for (let c = 1; c <= 200; c++) {
    const key = `B${b}C${c}`;
    if (!audioMap[key]) {
      audioMap[key] = `${GITHUB_BASE}/scg-book${b}.mp3`;
    }
  }
}

// ST Questions (volumes)
for (let v = 1; v <= 2; v++) {
  for (let q = 1; q <= 300; q++) {
    const key = `P${v}Q${q}`;
    const volNum = String(v).padStart(2, '0');
    audioMap[key] = `${GITHUB_BASE}/st-vol${volNum}.mp3`;
  }
}
for (let q = 1; q <= 200; q++) {
  audioMap[`P3Q${q}`] = `${GITHUB_BASE}/st-vol03.mp3`;
  audioMap[`P4Q${q}`] = `${GITHUB_BASE}/st-vol04.mp3`;
}

// Write the output
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(audioMap, null, 2));
console.log(`Generated ${Object.keys(audioMap).length} audio mappings`);
console.log(`Written to: ${OUTPUT_FILE}`);
console.log(`\nNext step: Run the upload script with GITHUB_TOKEN set:`);
console.log(`  $env:GITHUB_TOKEN = "your_token_here"`);
console.log(`  .\\scripts\\upload-audio-to-github-releases-api.ps1`);
