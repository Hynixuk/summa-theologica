#!/usr/bin/env node
// Upload all audio files from audio/ to Supabase Storage
// Usage: node scripts/upload-audio-to-supabase.cjs

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = 'https://jwipfoqmxaedrvwhvsnn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3aXBmb3FteGFlZHJ2d2h2c25uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNzk2NjcsImV4cCI6MjEwMzg1NTY2N30.Ftv6JqlNvxs2khMEBoI8VcTeei7RE6VqzeZ6h1QXklw';
const BUCKET_NAME = 'summa-audio';

const ROOT = path.join(__dirname, '..');
const AUDIO_DIR = path.join(ROOT, 'audio');

// Helper to make HTTPS requests
function httpsRequest(method, pathname, headers, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'jwipfoqmxaedrvwhvsnn.supabase.co',
      port: 443,
      path: pathname,
      method: method,
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/octet-stream',
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Find all .mp3 files recursively
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

async function uploadAudio() {
  console.log('Finding audio files...');
  const audioFiles = findAudioFiles(AUDIO_DIR);
  console.log(`Found ${audioFiles.length} audio files\n`);

  if (audioFiles.length === 0) {
    console.log('No audio files to upload.');
    return;
  }

  const audioMap = {};
  let uploaded = 0;
  let failed = 0;

  for (const filePath of audioFiles) {
    const relativePath = path.relative(AUDIO_DIR, filePath);
    const fileName = relativePath.replace(/\\/g, '/'); // Windows path fix
    const fileSize = fs.statSync(filePath).size;

    try {
      console.log(`[${uploaded + failed + 1}/${audioFiles.length}] Uploading ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)...`);

      const fileContent = fs.readFileSync(filePath);
      const uploadPath = `/storage/v1/object/summa-audio/${fileName}`;

      const response = await httpsRequest(
        'POST',
        uploadPath,
        { 'Content-Length': fileSize },
        fileContent
      );

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/summa-audio/${fileName}`;
      audioMap[`audio/${fileName}`] = publicUrl;
      uploaded++;
      console.log(`✓ Uploaded: ${publicUrl}\n`);
    } catch (err) {
      failed++;
      console.error(`✗ Failed to upload ${fileName}: ${err.message}\n`);
    }
  }

  // Save the audio map
  const mapFile = path.join(ROOT, 'app', 'audio-urls.json');
  fs.writeFileSync(mapFile, JSON.stringify(audioMap, null, 2) + '\n');
  console.log(`\n✓ Saved audio URL map to ${mapFile}`);
  console.log(`\nSummary: ${uploaded} uploaded, ${failed} failed`);
}

uploadAudio().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
