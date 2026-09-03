#!/usr/bin/env node
/**
 * Upload audio files to GitHub Releases using the GitHub API
 * Usage: node scripts/upload-audio.js <github-token>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

let GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = 'Hynixuk';
const GITHUB_REPO = 'summa-theologica';
const AUDIO_DIR = path.join(__dirname, '..', 'audio');
const MAX_FILES_PER_RELEASE = 1000;
const RELEASES = [
  { tag: 'audio-v1', name: 'Audio Files v1' },
  { tag: 'audio-v2', name: 'Audio Files v2' }
];

async function getToken() {
  if (GITHUB_TOKEN) return GITHUB_TOKEN;

  return new Promise((resolve) => {
    let token = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { token += chunk; });
    process.stdin.on('end', () => { resolve(token.trim()); });
  });
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
    GITHUB_TOKEN = await getToken();
    if (!GITHUB_TOKEN) {
      console.error('Error: GITHUB_TOKEN not provided');
      process.exit(1);
    }
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
    audioFiles.sort();
    console.log(`Found ${audioFiles.length} audio files\n`);

    const releaseIds = {};
    for (const { tag, name } of RELEASES) {
      console.log(`Checking for release '${tag}'...`);
      try {
        const release = await apiCall('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/${tag}`);
        releaseIds[tag] = release.id;
        console.log(`  ✓ Release exists (ID: ${release.id})`);
      } catch (e) {
        console.log(`  Creating release '${tag}'...`);
        const release = await apiCall('POST', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases`, {
          tag_name: tag,
          name: name,
          body: 'Audio files for Summa Theologica, Summa Contra Gentiles, and Aristotle\'s Metaphysics',
          draft: false,
          prerelease: false
        });
        releaseIds[tag] = release.id;
        console.log(`  ✓ Release created (ID: ${release.id})`);
      }
    }

    // Distribute files across releases (up to MAX_FILES_PER_RELEASE per release)
    console.log(`\nDistributing ${audioFiles.length} files across releases...`);
    const filesByRelease = {};
    const releaseList = RELEASES.map(r => r.tag);

    for (let i = 0; i < audioFiles.length; i++) {
      const releaseIdx = Math.floor(i / MAX_FILES_PER_RELEASE);
      const tag = releaseList[releaseIdx];
      if (!filesByRelease[tag]) filesByRelease[tag] = [];
      filesByRelease[tag].push(audioFiles[i]);
    }

    let totalUploaded = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const { tag } of RELEASES) {
      const files = filesByRelease[tag] || [];
      if (files.length === 0) continue;

      console.log(`\nUploading to ${tag} (${files.length} files)...`);
      const releaseId = releaseIds[tag];

      for (const file of files) {
        const fileName = path.relative(AUDIO_DIR, file);
        process.stdout.write(`  [${totalUploaded + totalSkipped + totalFailed + 1}/${audioFiles.length}] ${fileName}... `);

        try {
          await uploadFile(releaseId, file);
          console.log('✓');
          totalUploaded++;
        } catch (e) {
          if (e.message.includes('already exists')) {
            console.log('(already exists)');
            totalSkipped++;
          } else {
            console.log(`✗ ${e.message}`);
            totalFailed++;
          }
        }
      }
    }

    console.log(`\n✓ Upload complete!`);
    console.log(`  Uploaded: ${totalUploaded}`);
    console.log(`  Skipped: ${totalSkipped}`);
    console.log(`  Failed: ${totalFailed}`);

    if (totalFailed === 0) {
      console.log(`\n✓ All audio files are now available at:`);
      RELEASES.forEach(({ tag }) => {
        if (filesByRelease[tag] && filesByRelease[tag].length > 0) {
          console.log(`  https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/tag/${tag}`);
        }
      });
      console.log(`\nAudio is ready! The app will auto-load tracks from all releases.`);
    } else {
      console.log(`\n⚠ ${totalFailed} files failed to upload. Run again to retry.`);
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
