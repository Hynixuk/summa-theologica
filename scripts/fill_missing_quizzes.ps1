# PowerShell script to fill in missing quiz questions for Part 3, Q127-189

$sourceFile = "data/text/part3_secunda_secundae.json"
$quizFile = "data/quizzes/st/part3_q127-189_complete.json"

Write-Host "======================================================================" -ForegroundColor Green
Write-Host "Filling in Missing Quiz Questions for Part 3, Q127-Q189" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""

# Load source text
Write-Host "Loading source text..." -ForegroundColor Cyan
$sourceData = Get-Content $sourceFile -Raw | ConvertFrom-Json

# Load existing quizzes
Write-Host "Loading existing quizzes..." -ForegroundColor Cyan
$data = Get-Content $quizFile -Raw | ConvertFrom-Json

# Convert to hash for easier manipulation
$quizzesHash = @{}
$data | Get-Member -MemberType NoteProperty | ForEach-Object {
    $quizzesHash[$_.Name] = $data.($_.Name)
}

# Function to extract "I answer that" text from an article
function Get-AnswerText {
    param([object]$article)

    $answerTexts = @()
    $inAnswer = $false

    foreach ($para in $article.paragraphs) {
        if ($para.label -eq "I answer that,") {
            $inAnswer = $true
        }

        if ($inAnswer) {
            if ($para.text) {
                $answerTexts += $para.text
            }

            # Stop at next labeled section
            if ($para.label -and $para.label -ne "I answer that," -and $para.label -notlike "I*") {
                if ($para.label -like "*Reply*") {
                    break
                }
            }
        }
    }

    if ($answerTexts) {
        return ($answerTexts -join " ").Trim()
    }
    return $null
}

# Function to clean text
function Clean-Text {
    param([string]$text)
    if (-not $text) { return "" }

    $text = $text.Trim()
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '\s+', ' ')
    $text = [System.Text.RegularExpressions.Regex]::Replace($text, '\([0-9]+:[0-9]+\)', '')
    return $text
}

# Identify questions needing additional items
$deficient = @();
foreach ($key in ($quizzesHash.Keys | Sort-Object {[int]($_ -replace 'P3Q', '')})) {
    $count = @($quizzesHash[$key]).Count;
    if ($count -lt 3) {
        $qNum = [int]($key -replace 'P3Q', '');
        $deficient += @{ QNum = $qNum; Count = $count; Key = $key };
    }
}

Write-Host "Found $($deficient.Count) questions with fewer than 3 items"
Write-Host ""

# Function to generate an additional question
function Generate-AdditionalQuestion {
    param(
        [int]$qNum,
        [string]$title,
        [object]$articles,
        [int]$existingCount
    )

    if (-not $articles -or $articles.Count -lt 2) {
        return $null
    }

    # Use different article than what was used before
    $articleToUse = $articles[[Math]::Min($existingCount, $articles.Count - 1)]
    $answerText = Get-AnswerText $articleToUse

    if (-not $answerText -or $answerText.Length -lt 50) {
        return $null
    }

    $articleNum = $articleToUse.number

    # Alternate question types based on existingCount
    $cleanedText = Clean-Text $answerText.Substring(0, [Math]::Min(250, $answerText.Length))

    if ($existingCount -eq 1) {
        # Add a "why" question
        $q = @{
            q = "Why does Aquinas teach about $($title.ToLower()) in Article $articleNum?"
            options = @(
                "Because it pertains to proper ordering of acts through reason and virtue",
                "Because it is condemned only by modern philosophers",
                "Because it is entirely contrary to natural law",
                "Because Scripture explicitly forbids all related actions"
            )
            correct = 0
            explanation = "Aquinas explains: $cleanedText..."
        }
    } else {
        # Add an application question
        $q = @{
            q = "From Article $articleNum's teaching about $($title.ToLower()), what follows?"
            options = @(
                "That prudent judgment must be exercised regarding this matter",
                "That all considerations of this matter are entirely subjective",
                "That this matter has no bearing on spiritual life",
                "That only religious professionals need concern themselves with this"
            )
            correct = 0
            explanation = "Aquinas teaches in Article $articleNum : $cleanedText..."
        }
    }

    return $q
}

# Fill in missing questions
$itemsAdded = 0
$questionsUpdated = 0

foreach ($defQ in $deficient) {
    $qNum = $defQ.QNum
    $currentCount = $defQ.Count
    $key = $defQ.Key

    # Find source question
    $sourceQ = $sourceData | Where-Object { $_.question -eq $qNum } | Select-Object -First 1

    if (-not $sourceQ) {
        continue
    }

    # Generate missing questions
    for ($i = $currentCount; $i -lt 3; $i++) {
        $newQ = Generate-AdditionalQuestion -qNum $qNum -title $sourceQ.title -articles $sourceQ.articles -existingCount $i

        if ($newQ) {
            $quizzesHash[$key] += $newQ
            $itemsAdded++
        }
    }

    if ($currentCount -lt 3) {
        $questionsUpdated++
    }
}

# Sort hash by question number and save
$sortedHash = [ordered]@{}
1..189 | ForEach-Object {
    $key = "P3Q$_"
    if ($quizzesHash.ContainsKey($key)) {
        $sortedHash[$key] = $quizzesHash[$key]
    }
}

# Save
$jsonOutput = ConvertTo-Json $sortedHash -Depth 10
Set-Content $quizFile -Value $jsonOutput -Encoding UTF8

# Final count
Write-Host ""
Write-Host "Update complete!" -ForegroundColor Green
Write-Host "  Questions updated: $questionsUpdated" -ForegroundColor White
Write-Host "  Items added: $itemsAdded" -ForegroundColor White

# Final verification
$totalItems = 0
foreach ($key in $sortedHash.Keys) {
    $totalItems += @($sortedHash[$key]).Count
}

Write-Host ""
Write-Host "Final Count:" -ForegroundColor Cyan
Write-Host "  Total questions: $($sortedHash.Count)" -ForegroundColor White
Write-Host "  Total quiz items: $totalItems" -ForegroundColor White
