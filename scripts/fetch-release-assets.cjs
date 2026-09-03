// One-off helper: fetches the asset listing (name + browser_download_url) for each of
// audio-v1/v2/v3 from GitHub Releases and writes it to a local JSON file, in the shape
// scripts/build-audio-urls.cjs expects as input. Reuses the same GITHUB_TOKEN resolution
// (.env.local fallback) as scripts/upload-audio.js.
const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_USER = 'Hynixuk';
const GITHUB_REPO = 'summa-theologica';
const RELEASES = ['audio-v1', 'audio-v2', 'audio-v3'];
const OUT_DIR = path.join(__dirname, '..', '.release-assets-cache');

function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const envLocalPath = path.join(__dirname, '..', '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const contents = fs.readFileSync(envLocalPath, 'utf-8');
    const match = contents.match(/^GITHUB_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  }
  return null;
}

function apiCall(token, apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'summa-theologica-audio-upload'
      },
      hostname: 'api.github.com',
      path: apiPath,
      port: 443
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : null;
          if (res.statusCode >= 400) reject(new Error(`${res.statusCode}: ${JSON.stringify(parsed)}`));
          else resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAllAssets(token, releaseId) {
  const all = [];
  let page = 1;
  for (;;) {
    const batch = await apiCall(token, `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/${releaseId}/assets?per_page=100&page=${page}`);
    if (!batch || !batch.length) break;
    batch.forEach((a) => all.push({ name: a.name, url: a.browser_download_url }));
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

async function main() {
  const token = getToken();
  if (!token) { console.error('No GITHUB_TOKEN found'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const tag of RELEASES) {
    console.log(`Fetching release '${tag}'...`);
    const release = await apiCall(token, `/repos/${GITHUB_USER}/${GITHUB_REPO}/releases/tags/${tag}`);
    const assets = await fetchAllAssets(token, release.id);
    const outFile = path.join(OUT_DIR, `${tag}.json`);
    fs.writeFileSync(outFile, JSON.stringify(assets, null, 2), 'utf-8');
    console.log(`  ${assets.length} assets -> ${outFile}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
