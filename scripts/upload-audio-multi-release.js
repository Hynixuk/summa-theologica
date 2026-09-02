#!/usr/bin/env node
/**
 * Upload audio files across multiple releases (max 1000 per release)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = 'Hynixuk';
const GITHUB_REPO = 'summa-theologica';
const AUDIO_DIR = path.join(__dirname, '..', 'audio');
const MAX_ASSETS_PER_RELEASE = 1000;

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

async function getOrCreateRelease(releaseTag) {
  try {
    return await apiCall('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/${releaseTag}`);
  } catch (e) {
    if (e.statusCode === 404) {
      console.log(`Creating release '${releaseTag}'...`);
      return await apiCall('POST', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases`, {
        tag_name: releaseTag,
        name: `Audio Files ${releaseTag}`,
        body: `Audio files part: ${releaseTag}`,
        draft: false,
        prerelease: false
      });
    }
    throw e;
  }
}

async function main() {
  try {
    console.log('Collecting audio files...');
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
    audioFiles.sort(); // Ensure consistent order
    console.log(`Found ${audioFiles.length} audio files\n`);

    // Determine which release each file belongs to
    const releaseAssignments = {};
    audioFiles.forEach((file, idx) => {
      const releaseIndex = Math.floor(idx / MAX_ASSETS_PER_RELEASE) + 1;
      const releaseTag = releaseIndex === 1 ? 'audio-v1' : `audio-v${releaseIndex}`;
      if (!releaseAssignments[releaseTag]) {
        releaseAssignments[releaseTag] = [];
      }
      releaseAssignments[releaseTag].push(file);
    });

    console.log('Release assignments:');
    Object.entries(releaseAssignments).forEach(([tag, files]) => {
      console.log(`  ${tag}: ${files.length} files`);
    });
    console.log();

    // Get or create each release and upload files
    const audioUrlMap = {};
    let totalUploaded = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const [releaseTag, filesForRelease] of Object.entries(releaseAssignments)) {
      console.log(`\n=== ${releaseTag} ===`);
      const release = await getOrCreateRelease(releaseTag);
      const releaseId = release.id;

      console.log(`Release ID: ${releaseId}`);
      console.log(`Current assets: ${release.assets.length}/${MAX_ASSETS_PER_RELEASE}\n`);

      for (let i = 0; i < filesForRelease.length; i++) {
        const file = filesForRelease[i];
        const fileName = path.basename(file);
        const fileNum = totalUploaded + totalSkipped + totalFailed + 1;
        process.stdout.write(`[${fileNum}/${audioFiles.length}] ${fileName}... `);

        try {
          const asset = await uploadFile(releaseId, file);
          console.log('✓');
          totalUploaded++;
          audioUrlMap[fileName] = asset.browser_download_url;
        } catch (e) {
          if (e.statusCode === 422 && e.response?.errors?.some(err => err.code === 'already_exists')) {
            console.log('(exists)');
            totalSkipped++;
            // Try to find existing asset URL
            const existingAsset = release.assets.find(a => a.name === fileName);
            if (existingAsset) {
              audioUrlMap[fileName] = existingAsset.browser_download_url;
            }
          } else {
            console.log(`✗ (${e.statusCode})`);
            totalFailed++;
          }
        }
      }
    }

    console.log(`\n✅ Upload complete!`);
    console.log(`  Uploaded: ${totalUploaded}`);
    console.log(`  Skipped: ${totalSkipped}`);
    console.log(`  Failed: ${totalFailed}`);

    // Update audio-urls.json with the new mappings
    console.log(`\nUpdating audio-urls.json...`);
    const existingAudioUrls = require('../app/audio-urls.json');

    // Map files back to chapters
    const metaphysicsFiles = [
      'metaphysics/01 - Book 1 Chapters 1-3.mp3',
      'metaphysics/02 - Book 1 Chapters 4-6.mp3',
      // ... add all metaphysics files here
    ];

    const updatedUrls = { ...existingAudioUrls };
    let urlsUpdated = 0;

    Object.entries(audioUrlMap).forEach(([fileName, url]) => {
      // Find chapter key for this file
      Object.entries(existingAudioUrls).forEach(([chapter, oldUrl]) => {
        if (oldUrl.includes(fileName)) {
          updatedUrls[chapter] = url;
          urlsUpdated++;
        }
      });
    });

    fs.writeFileSync(
      path.join(__dirname, '..', 'app', 'audio-urls.json'),
      JSON.stringify(updatedUrls, null, 2)
    );

    console.log(`Updated ${urlsUpdated} chapter mappings in audio-urls.json`);
    console.log(`\n📍 Releases:`);
    Object.keys(releaseAssignments).forEach(tag => {
      console.log(`  https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/tag/${tag}`);
    });

  } catch (error) {
    console.error('Fatal error:', error.message);
    if (error.response) {
      console.error('Response:', JSON.stringify(error.response, null, 2));
    }
    process.exit(1);
  }
}

main();
