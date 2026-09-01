# Audio Hosting on Supabase

This app is set up to host audio files on Supabase Storage for free (up to 1GB with free bandwidth).

## Setup

### 1. Create Supabase Project ✅ (Already Done)
- Project URL: `https://jwipfoqmxaedrvwhvsnn.supabase.co`
- Anon Key: (Already configured in upload script)

### 2. Create Storage Bucket in Supabase
1. Go to your Supabase project dashboard
2. Click **Storage** in the left sidebar
3. Click **Create new bucket**
4. Name: `summa-audio`
5. Enable **Public** (so audio can be accessed without auth)
6. Click **Create bucket**

## Upload Audio Files

Run the upload script to push all audio files to Supabase:

```bash
node scripts/upload-audio-to-supabase.cjs
```

This will:
- Find all `.mp3` files in `audio/`
- Upload each to `summa-audio` bucket
- Generate a mapping file: `app/audio-urls.json`
- Map local paths → Supabase URLs

**Time estimate:** ~30-60 minutes depending on internet speed (5GB+ of audio).

**Output:** `app/audio-urls.json` with mappings like:
```json
{
  "audio/metaphysics/01 - Book I Chapters 1-3.mp3": "https://jwipfoqmxaedrvwhvsnn.supabase.co/storage/v1/object/public/summa-audio/metaphysics/01 - Book I Chapters 1-3.mp3",
  ...
}
```

## How It Works

1. **Local Dev:** App loads from `app/audio-urls.json`. If it's empty, audio plays from local `audio/` folder (fallback).
2. **Production (Vercel):** App loads `audio-urls.json` with Supabase URLs. Audio streams from Supabase, not from Vercel (saves bandwidth).

## Free Tier Limits

- **Storage:** 1 GB (your audio: ~5GB, will need to pay or upload select chapters)
- **Bandwidth:** Unlimited downloads
- **Cost after free tier:** ~$0.01 per GB stored/month

## Alternative: Paid CDN (Optional)

If 1GB isn't enough:
- **Bunny CDN:** $0.01/GB/month (cheapest option for 5GB = $0.05/month)
- **AWS S3:** $0.023/GB/month
- **Wasabi:** $5.99/month unlimited

## Troubleshooting

**Upload failed?**
- Check your Supabase Anon Key is correct
- Verify `summa-audio` bucket exists and is **Public**
- Try uploading a single test file manually in Supabase

**Audio not playing in production?**
- Ensure `app/audio-urls.json` was generated and pushed to GitHub
- Check Supabase bucket URLs are accessible: visit one URL in a browser (should download the MP3)

## Next: Deploy to Vercel

Once audio is uploaded:

```bash
git add app/audio-urls.json scripts/upload-audio-to-supabase.cjs AUDIO_HOSTING.md
git commit -m "Add Supabase audio hosting setup"
git push origin main
```

Then deploy to Vercel as usual. Audio will now stream from Supabase instead of being bundled with the app.
