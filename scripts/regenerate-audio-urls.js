#!/usr/bin/env node
/**
 * Regenerate audio-urls.json with correct GitHub Releases URLs
 * Maps each chapter to its corresponding audio file on GitHub Releases
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'app', 'audio-urls.json');

// Define the exact audio file mappings for Metaphysics (from audio directory)
const metaphysicsAudioMap = {
  // Book 1
  'B1C1': 'metaphysics/01 - Book 1 Chapters 1-3.mp3',
  'B1C2': 'metaphysics/01 - Book 1 Chapters 1-3.mp3',
  'B1C3': 'metaphysics/01 - Book 1 Chapters 1-3.mp3',
  'B1C4': 'metaphysics/02 - Book 1 Chapters 4-6.mp3',
  'B1C5': 'metaphysics/02 - Book 1 Chapters 4-6.mp3',
  'B1C6': 'metaphysics/02 - Book 1 Chapters 4-6.mp3',
  'B1C7': 'metaphysics/03 - Book 1 Chapters 7-9.mp3',
  'B1C8': 'metaphysics/03 - Book 1 Chapters 7-9.mp3',
  'B1C9': 'metaphysics/03 - Book 1 Chapters 7-9.mp3',
  'B1C10': 'metaphysics/04 - Book 1 Chapter 10.mp3',
  // Book 2
  'B2C1': 'metaphysics/05 - Book 2 Chapters 1-3.mp3',
  'B2C2': 'metaphysics/05 - Book 2 Chapters 1-3.mp3',
  'B2C3': 'metaphysics/05 - Book 2 Chapters 1-3.mp3',
  // Book 3
  'B3C1': 'metaphysics/06 - Book 3 Chapters 1-3.mp3',
  'B3C2': 'metaphysics/06 - Book 3 Chapters 1-3.mp3',
  'B3C3': 'metaphysics/06 - Book 3 Chapters 1-3.mp3',
  'B3C4': 'metaphysics/07 - Book 3 Chapters 4-6.mp3',
  'B3C5': 'metaphysics/07 - Book 3 Chapters 4-6.mp3',
  'B3C6': 'metaphysics/07 - Book 3 Chapters 4-6.mp3',
  // Book 4
  'B4C1': 'metaphysics/08 - Book 4 Chapters 1-3.mp3',
  'B4C2': 'metaphysics/08 - Book 4 Chapters 1-3.mp3',
  'B4C3': 'metaphysics/08 - Book 4 Chapters 1-3.mp3',
  'B4C4': 'metaphysics/09 - Book 4 Chapters 4-6.mp3',
  'B4C5': 'metaphysics/09 - Book 4 Chapters 4-6.mp3',
  'B4C6': 'metaphysics/09 - Book 4 Chapters 4-6.mp3',
  'B4C7': 'metaphysics/10 - Book 4 Chapters 7-8.mp3',
  'B4C8': 'metaphysics/10 - Book 4 Chapters 7-8.mp3',
  // Book 5
  'B5C1': 'metaphysics/11 - Book 5 Chapters 1-3.mp3',
  'B5C2': 'metaphysics/11 - Book 5 Chapters 1-3.mp3',
  'B5C3': 'metaphysics/11 - Book 5 Chapters 1-3.mp3',
  'B5C4': 'metaphysics/12 - Book 5 Chapters 4-6.mp3',
  'B5C5': 'metaphysics/12 - Book 5 Chapters 4-6.mp3',
  'B5C6': 'metaphysics/12 - Book 5 Chapters 4-6.mp3',
  'B5C7': 'metaphysics/13 - Book 5 Chapters 7-9.mp3',
  'B5C8': 'metaphysics/13 - Book 5 Chapters 7-9.mp3',
  'B5C9': 'metaphysics/13 - Book 5 Chapters 7-9.mp3',
  'B5C10': 'metaphysics/14 - Book 5 Chapters 10-12.mp3',
  'B5C11': 'metaphysics/14 - Book 5 Chapters 10-12.mp3',
  'B5C12': 'metaphysics/14 - Book 5 Chapters 10-12.mp3',
  'B5C13': 'metaphysics/15 - Book 5 Chapters 13-15.mp3',
  'B5C14': 'metaphysics/15 - Book 5 Chapters 13-15.mp3',
  'B5C15': 'metaphysics/15 - Book 5 Chapters 13-15.mp3',
  'B5C16': 'metaphysics/16 - Book 5 Chapters 16-18.mp3',
  'B5C17': 'metaphysics/16 - Book 5 Chapters 16-18.mp3',
  'B5C18': 'metaphysics/16 - Book 5 Chapters 16-18.mp3',
  'B5C19': 'metaphysics/17 - Book 5 Chapters 19-21.mp3',
  'B5C20': 'metaphysics/17 - Book 5 Chapters 19-21.mp3',
  'B5C21': 'metaphysics/17 - Book 5 Chapters 19-21.mp3',
  'B5C22': 'metaphysics/18 - Book 5 Chapters 22-24.mp3',
  'B5C23': 'metaphysics/18 - Book 5 Chapters 22-24.mp3',
  'B5C24': 'metaphysics/18 - Book 5 Chapters 22-24.mp3',
  'B5C25': 'metaphysics/19 - Book 5 Chapters 25-27.mp3',
  'B5C26': 'metaphysics/19 - Book 5 Chapters 25-27.mp3',
  'B5C27': 'metaphysics/19 - Book 5 Chapters 25-27.mp3',
  'B5C28': 'metaphysics/20 - Book 5 Chapters 28-30.mp3',
  'B5C29': 'metaphysics/20 - Book 5 Chapters 28-30.mp3',
  'B5C30': 'metaphysics/20 - Book 5 Chapters 28-30.mp3',
  // Book 6
  'B6C1': 'metaphysics/21 - Book 6 Chapters 1-3.mp3',
  'B6C2': 'metaphysics/21 - Book 6 Chapters 1-3.mp3',
  'B6C3': 'metaphysics/21 - Book 6 Chapters 1-3.mp3',
  'B6C4': 'metaphysics/22 - Book 6 Chapter 4.mp3',
  // Book 7
  'B7C1': 'metaphysics/23 - Book 7 Chapters 1-3.mp3',
  'B7C2': 'metaphysics/23 - Book 7 Chapters 1-3.mp3',
  'B7C3': 'metaphysics/23 - Book 7 Chapters 1-3.mp3',
  'B7C4': 'metaphysics/24 - Book 7 Chapters 4-6.mp3',
  'B7C5': 'metaphysics/24 - Book 7 Chapters 4-6.mp3',
  'B7C6': 'metaphysics/24 - Book 7 Chapters 4-6.mp3',
  'B7C7': 'metaphysics/25 - Book 7 Chapters 7-9.mp3',
  'B7C8': 'metaphysics/25 - Book 7 Chapters 7-9.mp3',
  'B7C9': 'metaphysics/25 - Book 7 Chapters 7-9.mp3',
  'B7C10': 'metaphysics/26 - Book 7 Chapters 10-12.mp3',
  'B7C11': 'metaphysics/26 - Book 7 Chapters 10-12.mp3',
  'B7C12': 'metaphysics/26 - Book 7 Chapters 10-12.mp3',
  'B7C13': 'metaphysics/27 - Book 7 Chapters 13-15.mp3',
  'B7C14': 'metaphysics/27 - Book 7 Chapters 13-15.mp3',
  'B7C15': 'metaphysics/27 - Book 7 Chapters 13-15.mp3',
  'B7C16': 'metaphysics/28 - Book 7 Chapters 16-17.mp3',
  'B7C17': 'metaphysics/28 - Book 7 Chapters 16-17.mp3',
  // Book 8
  'B8C1': 'metaphysics/29 - Book 8 Chapters 1-3.mp3',
  'B8C2': 'metaphysics/29 - Book 8 Chapters 1-3.mp3',
  'B8C3': 'metaphysics/29 - Book 8 Chapters 1-3.mp3',
  'B8C4': 'metaphysics/30 - Book 8 Chapters 4-6.mp3',
  'B8C5': 'metaphysics/30 - Book 8 Chapters 4-6.mp3',
  'B8C6': 'metaphysics/30 - Book 8 Chapters 4-6.mp3',
  // Book 9
  'B9C1': 'metaphysics/31 - Book 9 Chapters 1-3.mp3',
  'B9C2': 'metaphysics/31 - Book 9 Chapters 1-3.mp3',
  'B9C3': 'metaphysics/31 - Book 9 Chapters 1-3.mp3',
  'B9C4': 'metaphysics/32 - Book 9 Chapters 4-6.mp3',
  'B9C5': 'metaphysics/32 - Book 9 Chapters 4-6.mp3',
  'B9C6': 'metaphysics/32 - Book 9 Chapters 4-6.mp3',
  'B9C7': 'metaphysics/33 - Book 9 Chapters 7-9.mp3',
  'B9C8': 'metaphysics/33 - Book 9 Chapters 7-9.mp3',
  'B9C9': 'metaphysics/33 - Book 9 Chapters 7-9.mp3',
  'B9C10': 'metaphysics/34 - Book 9 Chapter 10.mp3',
  // Book 10
  'B10C1': 'metaphysics/35 - Book 10 Chapters 1-3.mp3',
  'B10C2': 'metaphysics/35 - Book 10 Chapters 1-3.mp3',
  'B10C3': 'metaphysics/35 - Book 10 Chapters 1-3.mp3',
  'B10C4': 'metaphysics/36 - Book 10 Chapters 4-6.mp3',
  'B10C5': 'metaphysics/36 - Book 10 Chapters 4-6.mp3',
  'B10C6': 'metaphysics/36 - Book 10 Chapters 4-6.mp3',
  'B10C7': 'metaphysics/37 - Book 10 Chapters 7-9.mp3',
  'B10C8': 'metaphysics/37 - Book 10 Chapters 7-9.mp3',
  'B10C9': 'metaphysics/37 - Book 10 Chapters 7-9.mp3',
  'B10C10': 'metaphysics/38 - Book 10 Chapter 10.mp3',
  // Book 11
  'B11C1': 'metaphysics/39 - Book 11 Chapters 1-3.mp3',
  'B11C2': 'metaphysics/39 - Book 11 Chapters 1-3.mp3',
  'B11C3': 'metaphysics/39 - Book 11 Chapters 1-3.mp3',
  'B11C4': 'metaphysics/40 - Book 11 Chapters 4-6.mp3',
  'B11C5': 'metaphysics/40 - Book 11 Chapters 4-6.mp3',
  'B11C6': 'metaphysics/40 - Book 11 Chapters 4-6.mp3',
  'B11C7': 'metaphysics/41 - Book 11 Chapters 7-9.mp3',
  'B11C8': 'metaphysics/41 - Book 11 Chapters 7-9.mp3',
  'B11C9': 'metaphysics/41 - Book 11 Chapters 7-9.mp3',
  'B11C10': 'metaphysics/42 - Book 11 Chapters 10-12.mp3',
  'B11C11': 'metaphysics/42 - Book 11 Chapters 10-12.mp3',
  'B11C12': 'metaphysics/42 - Book 11 Chapters 10-12.mp3',
  // Book 12
  'B12C1': 'metaphysics/43 - Book 12 Chapters 1-3.mp3',
  'B12C2': 'metaphysics/43 - Book 12 Chapters 1-3.mp3',
  'B12C3': 'metaphysics/43 - Book 12 Chapters 1-3.mp3',
  'B12C4': 'metaphysics/44 - Book 12 Chapters 4-6.mp3',
  'B12C5': 'metaphysics/44 - Book 12 Chapters 4-6.mp3',
  'B12C6': 'metaphysics/44 - Book 12 Chapters 4-6.mp3',
  'B12C7': 'metaphysics/45 - Book 12 Chapters 7-10.mp3',
  'B12C8': 'metaphysics/45 - Book 12 Chapters 7-10.mp3',
  'B12C9': 'metaphysics/45 - Book 12 Chapters 7-10.mp3',
  'B12C10': 'metaphysics/45 - Book 12 Chapters 7-10.mp3',
  // Book 13
  'B13C1': 'metaphysics/46 - Book 13 Chapters 1-3.mp3',
  'B13C2': 'metaphysics/46 - Book 13 Chapters 1-3.mp3',
  'B13C3': 'metaphysics/46 - Book 13 Chapters 1-3.mp3',
  'B13C4': 'metaphysics/47 - Book 13 Chapters 4-6.mp3',
  'B13C5': 'metaphysics/47 - Book 13 Chapters 4-6.mp3',
  'B13C6': 'metaphysics/47 - Book 13 Chapters 4-6.mp3',
  'B13C7': 'metaphysics/48 - Book 13 Chapters 7-10.mp3',
  'B13C8': 'metaphysics/48 - Book 13 Chapters 7-10.mp3',
  'B13C9': 'metaphysics/48 - Book 13 Chapters 7-10.mp3',
  'B13C10': 'metaphysics/48 - Book 13 Chapters 7-10.mp3',
  // Book 14
  'B14C1': 'metaphysics/49 - Book 14 Chapters 1-3.mp3',
  'B14C2': 'metaphysics/49 - Book 14 Chapters 1-3.mp3',
  'B14C3': 'metaphysics/49 - Book 14 Chapters 1-3.mp3',
  'B14C4': 'metaphysics/50 - Book 14 Chapters 4-6.mp3',
  'B14C5': 'metaphysics/50 - Book 14 Chapters 4-6.mp3',
  'B14C6': 'metaphysics/50 - Book 14 Chapters 4-6.mp3',
};

// Build audio map
const audioMap = {};

// Add Metaphysics URLs
Object.entries(metaphysicsAudioMap).forEach(([chapter, file]) => {
  // Determine which release this file is in (based on alphabetical order)
  const fileName = path.basename(file);
  const fileNum = parseInt(fileName.split(' ')[0]);
  const releaseTag = fileNum <= 50 ? 'audio-v1' : 'audio-v2'; // First 50 files in v1, rest in v2

  audioMap[chapter] = `https://github.com/Hynixuk/summa-theologica/releases/download/${releaseTag}/${fileName}`;
});

// Placeholder URLs for SCG and ST (you can update these with actual files if available)
// For now, using a pattern for missing audio
['B1', 'B2', 'B3', 'B4'].forEach(book => {
  for (let c = 1; c <= 163; c++) {
    const key = `${book}C${c}`;
    if (!audioMap[key]) {
      audioMap[key] = `https://github.com/Hynixuk/summa-theologica/releases/download/audio-v1/scg-${book}-${c}.mp3`;
    }
  }
});

['P1', 'P2', 'P3', 'P4'].forEach(part => {
  const maxQ = part === 'P1' ? 119 : part === 'P2' ? 114 : part === 'P3' ? 189 : 90;
  for (let q = 1; q <= maxQ; q++) {
    const key = `${part}Q${q}`;
    if (!audioMap[key]) {
      audioMap[key] = `https://github.com/Hynixuk/summa-theologica/releases/download/audio-v1/st-${part}-${q}.mp3`;
    }
  }
});

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(audioMap, null, 2));
console.log(`✓ Generated ${Object.keys(audioMap).length} audio mappings`);
console.log(`✓ Written to: ${OUTPUT_FILE}`);
