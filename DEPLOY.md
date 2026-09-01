# Deployment Guide: Summa Theologica to Vercel

## Quick Start

### 1. Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Repository name: `summa-theologica` (or your choice)
3. Description: "Interactive reader for Aristotle's Metaphysics, Summa Theologica, and Summa Contra Gentiles with Aquinas commentary"
4. **Do NOT** initialize with README (we already have one)
5. Click **Create repository**

### 2. Push Code to GitHub

In PowerShell/Terminal in the project directory:

```bash
git remote add origin https://github.com/YOUR_USERNAME/summa-theologica.git
git branch -M main
git push -u origin main
```

(Replace `YOUR_USERNAME` with your GitHub username)

### 3. Deploy to Vercel

#### Option A: Via GitHub (Recommended)

1. Go to [vercel.com](https://vercel.com)
2. Sign up with GitHub (or log in if you have an account)
3. Click **Import Project**
4. Select **Import Git Repository**
5. Paste: `https://github.com/YOUR_USERNAME/summa-theologica`
6. Click **Import**
7. Vercel auto-detects settings from `vercel.json`
8. Click **Deploy**

Done! Your app will be live at `summa-theologica.vercel.app` (or custom domain if you set one).

#### Option B: Via Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
```

Follow the prompts, select "Y" to link to Git repo.

### 4. Custom Domain (Optional)

1. In Vercel dashboard, go to **Settings** → **Domains**
2. Add your domain (e.g., `summa.yourdomain.com`)
3. Follow DNS setup instructions from your domain registrar

## What Gets Deployed

- ✅ All code (`app/`, `scripts/`, data files)
- ✅ Manifests and configuration
- ❌ `audio/` folder (excluded via `.gitignore`)

**Important:** Audio files are NOT deployed because they're too large for GitHub. 

### Audio on Vercel

**Option A: Include in Vercel** (if total < 100MB)
- Edit `.gitignore`, remove `audio/` line
- Commit and push
- Vercel redeploys automatically

**Option B: Fetch from Local Server** (during dev)
- While testing locally, audio plays from `http://localhost:8842/audio/`
- In production (Vercel), users won't have audio (they'll see "Audio not available")
- This is fine for reading-only; later add CDN if you want audio in production

**Option C: Host Audio on CDN** (future)
- Upload `audio/` to Bunny CDN or AWS S3
- Change app's audio paths to CDN URLs
- See `app/app.js` → `loadChapterAudio()` for where to update URLs

## Automatic Deployments

Every time you push to `main`:

```bash
git add .
git commit -m "Updated chapter 7 commentary"
git push origin main
```

Vercel automatically redeploys. Live within ~30 seconds.

## Troubleshooting

**"Build failed"**
- Check Vercel logs (Dashboard → Deployments → Click failed deploy)
- Usually means a file is corrupt or missing from `.gitignore` that shouldn't be

**"Audio not loading"**
- This is expected if audio/ is .gitignore'd
- Users will see "Audio not available for this chapter"
- To fix, either include audio/ or use a CDN (Option B/C above)

**"Service Worker not registered"**
- Vercel correctly sets `Service-Worker-Allowed` header (see `vercel.json`)
- Hard refresh browser (`Ctrl+Shift+R`) to clear old cache

## Next Steps

1. Push to GitHub
2. Deploy to Vercel
3. Share `https://summa-theologica.vercel.app` with friends
4. (Later) Add audio via CDN if you want production audio playback

---

**Questions?** Check Vercel docs: https://vercel.com/docs
