# Upload audio files to GitHub Releases using GitHub API
# Resumable: skips files already present as release assets, retries the rest.
# Usage: Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process; .\scripts\upload-audio-to-github-releases-api.ps1

$ErrorActionPreference = "Stop"

# Configuration
$GITHUB_TOKEN = $env:GITHUB_TOKEN
$GITHUB_USER = "Hynixuk"
$GITHUB_REPO = "summa-theologica"
$RELEASE_TAG = "audio-v1"
$RELEASE_NAME = "Audio Files"
$AUDIO_DIR = "audio"
$ROOT = Split-Path -Parent $PSScriptRoot

if (-not $GITHUB_TOKEN) {
    Write-Error "GITHUB_TOKEN environment variable not set."
    exit 1
}

Write-Host "Finding audio files..."
$audioFiles = @()
Get-ChildItem -Path $AUDIO_DIR -Recurse -Filter "*.mp3" | ForEach-Object {
    $audioFiles += $_
}

Write-Host "Found $($audioFiles.Count) audio files"
Write-Host ""

if ($audioFiles.Count -eq 0) {
    Write-Host "No audio files to upload."
    exit 0
}

$API_BASE = "https://api.github.com/repos/$GITHUB_USER/$GITHUB_REPO"
$HEADERS = @{
    "Authorization" = "token $GITHUB_TOKEN"
    "Accept" = "application/vnd.github.v3+json"
}

Write-Host "Checking if release '$RELEASE_TAG' exists..."
$releaseResponse = $null
try {
    $releaseResponse = Invoke-WebRequest -UseBasicParsing -Uri "$API_BASE/releases/tags/$RELEASE_TAG" -Headers $HEADERS -ErrorAction Stop
    Write-Host "Release '$RELEASE_TAG' already exists"
    Write-Host ""
} catch {
    Write-Host "Creating release '$RELEASE_TAG'..."
    $releaseBody = @{
        "tag_name" = $RELEASE_TAG
        "name" = $RELEASE_NAME
        "body" = "Audio files for Summa Theologica app"
    } | ConvertTo-Json

    $releaseResponse = Invoke-WebRequest -UseBasicParsing -Uri "$API_BASE/releases" -Headers $HEADERS -Method POST -Body $releaseBody -ContentType "application/json"

    Write-Host "Created release"
    Write-Host ""
}

$releaseData = $releaseResponse.Content | ConvertFrom-Json
$UPLOAD_URL = $releaseData.upload_url -replace '\{.*\}', ''
$RELEASE_URL = $releaseData.html_url
$RELEASE_ID = $releaseData.id

# Fetch existing assets already on the release (for resume support) — paginate.
Write-Host "Fetching existing release assets..."
$existingAssets = @{}
$page = 1
while ($true) {
    $assetsResp = Invoke-WebRequest -UseBasicParsing -Uri "$API_BASE/releases/$RELEASE_ID/assets?per_page=100&page=$page" -Headers $HEADERS -ErrorAction Stop
    $assetsPage = $assetsResp.Content | ConvertFrom-Json
    if ($assetsPage.Count -eq 0) { break }
    foreach ($a in $assetsPage) { $existingAssets[$a.name] = $true }
    if ($assetsPage.Count -lt 100) { break }
    $page++
}
Write-Host "Found $($existingAssets.Count) assets already uploaded"
Write-Host ""

# Build the audio map for ALL files, uploading only what's missing.
$audioMap = @{}
$uploaded = 0
$skipped = 0
$failed = 0

for ($i = 0; $i -lt $audioFiles.Count; $i++) {
    $file = $audioFiles[$i]
    $relativePath = $file.FullName -replace [regex]::Escape("$AUDIO_DIR\"), ""
    $fileName = $relativePath.Replace('\', '/')
    $fileSize = [math]::Round($file.Length / 1MB, 1)
    $encodedName = [System.Net.WebUtility]::UrlEncode($file.Name)
    $downloadUrl = "https://github.com/$GITHUB_USER/$GITHUB_REPO/releases/download/$RELEASE_TAG/$encodedName"

    if ($existingAssets.ContainsKey($file.Name)) {
        $audioMap["audio/$fileName"] = $downloadUrl
        $skipped++
        continue
    }

    Write-Host "[$($i + 1)/$($audioFiles.Count)] Uploading $fileName ($fileSize MB)..."

    try {
        $fileContent = [System.IO.File]::ReadAllBytes($file.FullName)
        $uploadUri = "$UPLOAD_URL" + "?name=$encodedName"

        $uploadHeaders = @{
            "Authorization" = "token $GITHUB_TOKEN"
            "Content-Type" = "application/octet-stream"
        }

        Invoke-WebRequest -UseBasicParsing -Uri $uploadUri -Headers $uploadHeaders -Method POST -Body $fileContent -ErrorAction Stop | Out-Null

        $audioMap["audio/$fileName"] = $downloadUrl
        $uploaded++
        Write-Host "Uploaded"
        Write-Host ""
    } catch {
        $failed++
        Write-Host "Failed: $($_.Exception.Message)"
        Write-Host ""
        Start-Sleep -Seconds 2
    }
}

$mapFile = Join-Path -Path $ROOT -ChildPath "app"
$mapFile = Join-Path -Path $mapFile -ChildPath "audio-urls.json"
$audioMap | ConvertTo-Json | Out-File -FilePath $mapFile -Encoding UTF8

Write-Host ""
Write-Host "Saved audio URL map to $mapFile ($($audioMap.Count) entries)"
Write-Host ""
Write-Host "Summary: $uploaded newly uploaded, $skipped already present, $failed failed"
Write-Host ""
Write-Host "Release: $RELEASE_URL"
