#!/usr/bin/env node
// Upload audio files to GitHub Releases
// Uses gh CLI to create a release and upload audio as assets
// Usage: node scripts/upload-audio-to-github-releases.cjs

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');
const RELEASE_TAG = 'audio-v1';
const RELEASE_NAME = 'Audio Files';

function findAudioFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findAudioFiles(fullPath));
    } else if (item.endsWith('.mp3')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function uploadToGitHub() {
  console.log('Finding audio files...');
  const audioFiles = findAudioFiles(AUDIO_DIR);
  console.log(`Found ${audioFiles.length} audio files\n`);

  if (audioFiles.length === 0) {
    console.log('No audio files to upload.');
    return;
  }

  try {
    // Check if release exists
    console.log(`Checking if release "${RELEASE_TAG}" exists...`);
    try {
      execSync(`gh release view ${RELEASE_TAG}`, { stdio: 'ignore' });
      console.log(`✓ Release "${RELEASE_TAG}" already exists\n`);
    } catch {
      // Release doesn't exist, create it
      console.log(`Creating release "${RELEASE_TAG}"...`);
      execSync(`gh release create ${RELEASE_TAG} --title "${RELEASE_NAME}" --notes "Audio files for Summa Theologica app"`, {
        stdio: 'inherit',
        cwd: ROOT
      });
      console.log(`✓ Created release\n`);
    }

    // Upload files
    const audioMap = {};
    let uploaded = 0;
    let failed = 0;

    for (let i = 0; i < audioFiles.length; i++) {
      const filePath = audioFiles[i];
      const relativePath = path.relative(AUDIO_DIR, filePath);
      const fileName = relativePath.replace(/\\/g, '/');
      const fileSize = fs.statSync(filePath).size;

      try {
        console.log(`[${i + 1}/${audioFiles.length}] Uploading ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)...`);

        execSync(
          `gh release upload ${RELEASE_TAG} "${filePath}" --clobber`,
          {
            stdio: 'pipe',
            cwd: ROOT
          }
        );

        const publicUrl = `https://github.com/Hynixuk/summa-theologica/releases/download/${RELEASE_TAG}/${encodeURIComponent(path.basename(filePath))}`;
        audioMap[`audio/${fileName}`] = publicUrl;
        uploaded++;
        console.log(`✓ Uploaded\n`);
      } catch (err) {
        failed++;
        console.error(`✗ Failed: ${err.message.split('\n')[0]}\n`);
      }
    }

    // Save the audio map
    const mapFile = path.join(ROOT, 'app', 'audio-urls.json');
    fs.writeFileSync(mapFile, JSON.stringify(audioMap, null, 2) + '\n');
    console.log(`\n✓ Saved audio URL map to ${mapFile}`);
    console.log(`\nSummary: ${uploaded} uploaded, ${failed} failed`);
    console.log(`\nRelease: https://github.com/Hynixuk/summa-theologica/releases/tag/${RELEASE_TAG}`);
  } catch (err) {
    console.error('Fatal error:', err.message);
    process.exit(1);
  }
}

uploadToGitHub();
