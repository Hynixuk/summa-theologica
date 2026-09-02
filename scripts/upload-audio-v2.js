#!/usr/bin/env node
/**
 * Upload audio files to GitHub Releases using the GitHub API (v2)
 * Handles 422 errors and provides diagnostics
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = 'Hynixuk';
const GITHUB_REPO = 'summa-theologica';
const RELEASE_TAG = 'audio-v1';
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
            const error = new Error(`${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.response = parsed;
            reject(error);
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

async function checkAssetExists(releaseId, fileName) {
  try {
    const assets = await apiCall('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/${releaseId}/assets`);
    return assets.some(a => a.name === fileName);
  } catch (e) {
    return false;
  }
}

async function deleteAsset(assetId) {
  try {
    await apiCall('DELETE', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/assets/${assetId}`);
    return true;
  } catch (e) {
    return false;
  }
}

async function uploadFile(releaseId, filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const fileSize = fs.statSync(filePath).size;
    const fileName = path.basename(filePath);

    const uploadHeaders = {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileSize
    };

    const options = {
      method: 'POST',
      headers: uploadHeaders,
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
            const error = new Error(`${res.statusCode}`);
            error.statusCode = res.statusCode;
            error.response = parsed;
            reject(error);
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    fileStream.on('error', reject);
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
    console.log(`Found ${audioFiles.length} audio files\n`);

    // Get release info
    console.log(`Getting release info for '${RELEASE_TAG}'...`);
    let release;
    try {
      release = await apiCall('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/${RELEASE_TAG}`);
    } catch (e) {
      if (e.statusCode === 404) {
        console.error('Release not found. Please create it first at:');
        console.error(`https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/new`);
        process.exit(1);
      }
      throw e;
    }

    const releaseId = release.id;
    console.log(`✓ Release found (ID: ${releaseId})`);
    console.log(`  Draft: ${release.draft}`);
    console.log(`  URL: ${release.html_url}`);
    console.log(`  Current assets: ${release.assets.length}\n`);

    // Test upload with first file
    console.log('Testing upload with first file...');
    const testFile = audioFiles[0];
    const testFileName = path.basename(testFile);
    const testSize = fs.statSync(testFile).size;

    console.log(`  File: ${testFileName}`);
    console.log(`  Size: ${(testSize / 1024 / 1024).toFixed(2)} MB`);

    try {
      const result = await uploadFile(releaseId, testFile);
      console.log(`✓ Test upload succeeded!`);
      console.log(`  Asset ID: ${result.id}`);
      console.log(`  URL: ${result.browser_download_url}\n`);
    } catch (e) {
      console.log(`✗ Test upload failed (${e.statusCode})`);
      if (e.response) {
        console.log(`  Response:`, JSON.stringify(e.response, null, 2));
      }
      console.log();

      if (e.statusCode === 422) {
        console.log('Diagnostic info:');
        console.log('  - The 422 error usually means:');
        console.log('    1. Token is missing full "repo" scope');
        console.log('    2. File already exists with same name');
        console.log('    3. Release is in draft mode');
        console.log('    4. File is too large for GitHub');
        console.log();
        console.log('  - To check your token permissions:');
        console.log('    https://github.com/settings/tokens');
        console.log();
        console.log('  - To delete existing files on the release:');
        console.log(`    https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/edit/${RELEASE_TAG}`);
      }
      process.exit(1);
    }

    // Upload remaining files
    console.log(`Uploading remaining ${audioFiles.length - 1} files...`);
    let uploaded = 1;
    let skipped = 0;
    let failed = 0;

    for (let i = 1; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const fileName = path.basename(file);
      process.stdout.write(`[${i + 1}/${audioFiles.length}] ${fileName}... `);

      try {
        await uploadFile(releaseId, file);
        console.log('✓');
        uploaded++;
      } catch (e) {
        if (e.statusCode === 422 && e.response?.errors?.[0]?.code === 'already_exists') {
          console.log('(exists)');
          skipped++;
        } else {
          console.log(`✗ (${e.statusCode})`);
          failed++;
        }
      }
    }

    console.log(`\n✓ Upload complete!`);
    console.log(`  Uploaded: ${uploaded}`);
    console.log(`  Skipped: ${skipped}`);
    console.log(`  Failed: ${failed}`);
    console.log(`\n📍 Release: https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/tag/${RELEASE_TAG}`);

  } catch (error) {
    console.error('Fatal error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response, null, 2));
    }
    process.exit(1);
  }
}

main();
