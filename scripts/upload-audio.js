#!/usr/bin/env node
/**
 * Upload audio files to GitHub Releases using the GitHub API
 * Usage: node scripts/upload-audio.js <github-token>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = 'Hynixuk';
const GITHUB_REPO = 'summa-theologica';
const RELEASE_TAG = 'audio-v1';
const RELEASE_NAME = 'Audio Files';
const AUDIO_DIR = path.join(__dirname, '..', 'audio');

if (!GITHUB_TOKEN) {
  console.error('Error: GITHUB_TOKEN environment variable not set');
  process.exit(1);
}

const headers = {
  'Authorization': `token ${GITHUB_TOKEN}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'summa-theologica-audio-upload'
};

async function apiCall(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.github.com${path}`);
    const options = {
      method,
      headers,
      hostname: 'api.github.com',
      path: path,
      port: 443
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          if (res.statusCode >= 400) {
            reject(new Error(`${res.statusCode}: ${JSON.stringify(parsed)}`));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function uploadFile(releaseId, filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileName = path.basename(filePath);

    const options = {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize
      },
      hostname: 'uploads.github.com',
      path: `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`,
      port: 443
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          if (res.statusCode >= 400) {
            reject(new Error(`Upload failed (${res.statusCode}): ${fileName}`));
          } else {
            resolve(fileName);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    fileStream.pipe(req);
  });
}

async function main() {
  try {
    console.log('Checking for audio files...');
    const audioFiles = [];

    function walkDir(dir) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          walkDir(filePath);
        } else if (file.endsWith('.mp3')) {
          audioFiles.push(filePath);
        }
      });
    }

    walkDir(AUDIO_DIR);
    console.log(`Found ${audioFiles.length} audio files`);

    // Check if release exists
    console.log(`\nChecking for release '${RELEASE_TAG}'...`);
    let releaseId;
    try {
      const release = await apiCall('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}`);
      releaseId = release.id;
      console.log(`Release exists (ID: ${releaseId})`);
    } catch (e) {
      console.log(`Creating release '${RELEASE_TAG}'...`);
      const release = await apiCall('POST', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases`, {
        tag_name: RELEASE_TAG,
        name: RELEASE_NAME,
        body: 'Audio files for Summa Theologica, Summa Contra Gentiles, and Aristotle\'s Metaphysics',
        draft: false,
        prerelease: false
      });
      releaseId = release.id;
      console.log(`Release created (ID: ${releaseId})`);
    }

    // Upload files
    console.log(`\nUploading ${audioFiles.length} files...`);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const file of audioFiles) {
      const fileName = path.relative(AUDIO_DIR, file);
      process.stdout.write(`[${uploaded + skipped + failed + 1}/${audioFiles.length}] ${fileName}... `);

      try {
        await uploadFile(releaseId, file);
        console.log('✓');
        uploaded++;
      } catch (e) {
        if (e.message.includes('already exists')) {
          console.log('(already exists)');
          skipped++;
        } else {
          console.log(`✗ ${e.message}`);
          failed++;
        }
      }
    }

    console.log(`\n✓ Upload complete!`);
    console.log(`  Uploaded: ${uploaded}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Failed: ${failed}`);

    if (failed === 0) {
      console.log(`\n✓ All audio files are now available at:`);
      console.log(`  https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}`);
      console.log(`\nAudio is ready! The app will auto-load tracks.`);
    } else {
      console.log(`\n⚠ ${failed} files failed to upload. Run again to retry.`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
