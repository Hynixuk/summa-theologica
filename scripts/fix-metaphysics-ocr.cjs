#!/usr/bin/env node
// Direct OCR cleanup for Metaphysics: remove obvious sidenote fragments and fix common misreads.
// This is a pragmatic, aggressive approach targeting patterns visible in the text.

const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, '../data/text/metaphysics.json');

console.log(`Reading ${dataFile}...`);
const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

let correctionCount = 0;
let removalCount = 0;

for (const chapter of data) {
  for (const para of chapter.paragraphs) {
    let text = para.text;
    const original = text;

    // 1. Remove obvious sidenote fragments: short sequences (1-10 chars) that contain
    //    unusual symbol patterns and don't form real words. Patterns like:
    //    - "S rd", "S^J^Sjj^i" (stray letters+symbols)
    //    - "i. Man's n»>" (fragment of annotation)
    //    - "**'*»®'" (pure symbol noise)

    // Remove pure symbol noise
    text = text.replace(/\b[*^»«¬~\s]+\b/g, ' ');

    // Remove fragments like "i. Man's n»>" or "S rd" - short segments with symbols/dots that don't make sense
    text = text.replace(/\b[a-z]{1,3}[\s\.]*[a-z]*['»«]*[^\w\s]*\b/gi, (match) => {
      // Keep if it's a common word or clearly real
      const realWords = ['a', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'hi', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'man', 'the', 'and', 'for'];
      const clean = match.toLowerCase().replace(/[^\w]/g, '');
      if (realWords.includes(clean)) return match;
      // If it's a tiny fragment (1-3 chars) mixed with symbols/dots, likely a sidenote
      if (clean.length <= 3 && /[»«*^~.]/.test(match)) return ' ';
      return match;
    });

    // Remove stray single/double letters followed by symbols (like "S rd", "i^" etc)
    text = text.replace(/\b[a-z]{1,2}[\s]*[»«*^~\.]+/gi, ' ');

    // Remove symbol clusters
    text = text.replace(/\b[^a-z\s]*[*^»«¬~]+[^a-z\s]*\b/gi, ' ');

    // 2. Fix common OCR character confusions
    const fixes = [
      // Single character confusions (l/i, O/0, etc)
      [/tiie/gi, 'the'],          // ti + two i's = "the"
      [/tlie/gi, 'the'],          // tl + ie = "the"
      [/tne/gi, 'the'],           // t + n + e = "the"
      [/sliall/gi, 'shall'],      // sl + iall = "shall"
      [/wliat/gi, 'what'],        // wl + iat = "what"
      [/wliicli/gi, 'which'],     // wh + iich = "which"
      [/toTe/gi, 'tome'],         // toTe = "tome"
      [/univeraai/gi, 'universal'], // univeraai = "universal"
      [/foUowing/gi, 'following'],   // foUowing = "following"
      [/siDce/gi, 'since'],       // siDce = "since"
      [/healtii/gi, 'health'],    // healtii (double i) = "health"
      [/otiier/gi, 'other'],      // otiier = "other"
      [/occasiou/gi, 'occasion'], // occasiou = "occasion"
      [/iudeed/gi, 'indeed'],     // iudeed = "indeed"
      [/priuciples/gi, 'principles'], // priuciples = "principles"
      [/cliauge/gi, 'change'],    // cliauge = "change"
      [/claiin/gi, 'claim'],      // claiin = "claim"
      [/lias/gi, 'has'],          // lias = "has"
      [/tliis/gi, 'this'],        // tliis = "this"
      [/tliey/gi, 'they'],        // tliey = "they"
      [/tliat/gi, 'that'],        // tliat = "that"
      [/tliere/gi, 'there'],      // tliere = "there"
      [/lielow/gi, 'below'],      // lielow = "below"
      [/coniain/gi, 'contain'],   // coniain = "contain" (nai typo)
      [/yiie/gi, 'time'],         // yiie typo
    ];

    for (const [pattern, replacement] of fixes) {
      const before = text;
      text = text.replace(pattern, replacement);
      if (before !== text) correctionCount++;
    }

    // 3. Remove stray symbols and orphaned fragments
    // Trailing symbols/junk before real words (e.g., "Man's  >" before "of")
    text = text.replace(/\b[a-z]+'?\s+[»«*^~>]+\s+/gi, ' ');
    // Single/double letter garbage like "S rd" (consonant + consonant with space)
    text = text.replace(/\b[b-df-hj-np-tv-z]\s+[b-df-hj-np-tv-z][a-z]{0,2}\b/gi, ' ');
    // Symbols between letters (e.g., "belong^g" -> "belong")
    text = text.replace(/([a-z])\^([a-z])/gi, '$1$2');
    text = text.replace(/([a-z])\*([a-z])/gi, '$1$2');
    text = text.replace(/([a-z])»([a-z])/gi, '$1$2');
    text = text.replace(/([a-z])«([a-z])/gi, '$1$2');
    // Clean up isolated symbols and stray ">"
    text = text.replace(/\s+[»«*^~>]+\s+/g, ' ');
    text = text.replace(/\s+>/g, '');

    if (text !== original) {
      para.text = text;
      removalCount++;
    }
  }
}

console.log(`Corrections/removals applied: ${correctionCount} + ${removalCount}`);
console.log(`Writing cleaned data back to ${dataFile}...`);
fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
console.log('Done.');
