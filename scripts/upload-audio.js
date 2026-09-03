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
  { tag: 'audio-v2', name: 'Audio Files v2' },
  { tag: 'audio-v3', name: 'Audio Files v3' }
];

async function getToken() {
  if (GITHUB_TOKEN) return GITHUB_TOKEN;

  // Fall back to a local, gitignored .env.local file (KEY=VALUE per line)
  // so the token never has to be typed into a shell command directly.
  const envLocalPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const contents = fs.readFileSync(envLocalPath, 'utf-8');
    const match = contents.match(/^GITHUB_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
    // Also accept a file containing just the raw token, no KEY= prefix
    const trimmed = contents.trim();
    if (trimmed && !trimmed.includes('\n')) return trimmed;
  }

  return new Promise((resolve) => {
    let token = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => { token += chunk; });
    process.stdin.on('end', () => { resolve(token.trim()); });
  });
}


function getHeaders() {
  return {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'summa-theologica-audio-upload'
  };
}

async function apiCall(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`https://api.github.com${path}`);
    const options = {
      method,
      headers: getHeaders(),
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
        ...getHeaders(),
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

async function listAllAssets(releaseId) {
  const names = new Set();
  let page = 1;
  for (;;) {
    const batch = await apiCall('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    batch.forEach(a => names.add(a.name));
    if (batch.length < 100) break;
    page++;
  }
  return names;
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

    // Check each release's existing assets (names + count) so we know real
    // remaining capacity — a release created in an earlier run may already be
    // full or partially full, and re-uploading files GitHub already has
    // wastes the 422 round-trip (and, worse, silently exhausts the 1000-file
    // cap before we ever reach later releases if we assumed it started empty).
    console.log(`\nChecking existing assets in each release...`);
    const existingNames = {};
    const existingCounts = {};
    for (const { tag } of RELEASES) {
      const names = await listAllAssets(releaseIds[tag]);
      existingNames[tag] = names;
      existingCounts[tag] = names.size;
      console.log(`  ${tag}: ${names.size}/${MAX_FILES_PER_RELEASE} assets already present`);
    }

    // Distribute only files that are genuinely new to a release with spare
    // capacity, filling releases in order.
    console.log(`\nDistributing ${audioFiles.length} files across releases...`);
    const filesByRelease = {};
    const releaseList = RELEASES.map(r => r.tag);
    const remaining = {};
    releaseList.forEach(tag => { remaining[tag] = MAX_FILES_PER_RELEASE - existingCounts[tag]; filesByRelease[tag] = []; });

    let alreadyPresent = 0;
    let unplaced = [];
    for (const file of audioFiles) {
      const fileName = path.basename(file);
      let placed = false;
      for (const tag of releaseList) {
        if (existingNames[tag].has(fileName)) { alreadyPresent++; placed = true; break; }
      }
      if (placed) continue;
      for (const tag of releaseList) {
        if (remaining[tag] > 0) {
          filesByRelease[tag].push(file);
          remaining[tag]--;
          placed = true;
          break;
        }
      }
      if (!placed) unplaced.push(file);
    }

    console.log(`  Already present (will skip): ${alreadyPresent}`);
    releaseList.forEach(tag => console.log(`  To upload to ${tag}: ${filesByRelease[tag].length}`));
    if (unplaced.length) {
      console.log(`  ⚠ ${unplaced.length} files have no room in any configured release. Add another RELEASES entry.`);
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
