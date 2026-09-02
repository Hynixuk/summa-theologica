# PowerShell script to generate Part 3 quiz questions for Q166-189

# Load source data
$sourceFile = "data/text/part3_secunda_secundae.json"
$quizFile = "data/quizzes/st/part3_q127-189_complete.json"

Write-Host "======================================================================" -ForegroundColor Green
Write-Host "Generating Quiz Questions for Part 3, Q166-Q189" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host ""

# Load source text
Write-Host "Loading source text..." -ForegroundColor Cyan
$sourceData = Get-Content $sourceFile -Raw | ConvertFrom-Json

# Load existing quizzes
if (Test-Path $quizFile) {
    Write-Host "Loading existing quizzes..." -ForegroundColor Cyan
    $quizzes = Get-Content $quizFile -Raw | ConvertFrom-Json | ConvertTo-PSCustomObject
} else {
    $quizzes = @{}
}

# Convert to hash for easier manipulation
$quizzesHash = @{}
$quizzes | Get-Member -MemberType NoteProperty | ForEach-Object {
    $quizzesHash[$_.Name] = $quizzes.($_.Name)
}

# Get Q166-189
$questions = $sourceData | Where-Object { $_.question -ge 166 -and $_.question -le 189 } | Sort-Object question

Write-Host "Found $($questions.Count) questions to process" -ForegroundColor Yellow
Write-Host ""

$questionsGenerated = 0
$totalItems = 0

# Function to extract "I answer that" text
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

# Function to extract first substantive claim
function Get-MainClaim {
    param([string]$text)

    if (-not $text -or $text.Length -lt 50) { return $null }

    # Get first 200 chars as base
    $baseText = $text.Substring(0, [Math]::Min(200, $text.Length))

    # Try to get the first sentence
    $matches = [System.Text.RegularExpressions.Regex]::Match($baseText, '[^.!?]+[.!?]')
    if ($matches.Success) {
        return (Clean-Text $matches.Value).Substring(0, [Math]::Min(100, (Clean-Text $matches.Value).Length))
    }

    return (Clean-Text $baseText)
}

# Function to generate 3 questions for a source question
function Generate-QuizQuestions {
    param(
        [object]$questionData,
        [string]$title,
        [int]$qNum
    )

    $questions = @()
    $articles = $questionData.articles

    if (-not $articles -or $articles.Count -eq 0) {
        return $questions
    }

    # Extract answer sections
    $answersByArticle = @()

    foreach ($article in $articles[0..([Math]::Min(1, $articles.Count-1))]) {
        $answerText = Get-AnswerText $article
        if ($answerText -and $answerText.Length -gt 100) {
            $answersByArticle += @{
                ArticleNum = $article.number
                Text = $answerText
                Title = $article.title
            }
        }
    }

    # Generate Question 1 - Direct understanding
    if ($answersByArticle.Count -gt 0) {
        $ans1 = $answersByArticle[0]
        $mainClaim = Get-MainClaim $ans1.Text

        if ($mainClaim) {
            $q1 = @{
                q = "According to Aquinas in Article $($ans1.ArticleNum), what is his primary teaching regarding $($title.ToLower())?"
                options = @(
                    $mainClaim,
                    "That $($title.ToLower()) is purely a matter of personal preference with no moral dimension",
                    "That $($title.ToLower()) is forbidden in all cases by divine law",
                    "That $($title.ToLower()) requires no special virtue or deliberation"
                )
                correct = 0
                explanation = "Aquinas states in Article $($ans1.ArticleNum): $(Clean-Text $ans1.Text.Substring(0, [Math]::Min(300, $ans1.Text.Length)))..."
            }
            $questions += $q1
        }
    }

    # Generate Question 2 - Reasoning
    if ($answersByArticle.Count -gt 0) {
        $ans2 = $answersByArticle[[Math]::Min(1, $answersByArticle.Count-1)]

        $q2 = @{
            q = "In Article $($ans2.ArticleNum), why does Aquinas teach what he does about $($title.ToLower())?"
            options = @(
                "Because it relates to the proper ordering of human acts and passions through reason and virtue",
                "Because it is explicitly prohibited multiple times in Sacred Scripture",
                "Because the ancient pagan philosophers unanimously condemned it",
                "Because it causes immediate physical harm to the person"
            )
            correct = 0
            explanation = "Aquinas explains in Article $($ans2.ArticleNum): $(Clean-Text $ans2.Text.Substring(0, [Math]::Min(280, $ans2.Text.Length)))..."
        }
        $questions += $q2
    }

    # Generate Question 3 - Application
    if ($answersByArticle.Count -gt 0) {
        $ans3 = $answersByArticle[0]

        $q3 = @{
            q = "From Article $($ans3.ArticleNum)'s teaching on $($title.ToLower()), which of the following follows?"
            options = @(
                "That $($title.ToLower()) must be approached with prudent deliberation and moderation",
                "That $($title.ToLower()) is entirely indifferent to moral virtue or vice",
                "That no one can ever err in judgment regarding $($title.ToLower())",
                "That $($title.ToLower()) pertains equally to all persons regardless of their state in life"
            )
            correct = 0
            explanation = "Aquinas teaches in Article $($ans3.ArticleNum): $(Clean-Text $ans3.Text.Substring(0, [Math]::Min(280, $ans3.Text.Length)))..."
        }
        $questions += $q3
    }

    return $questions[0..2]  # Return at most 3
}

# Generate quizzes for each question
foreach ($question in $questions) {
    $qNum = $question.question
    $title = $question.title
    $qKey = "P3Q$qNum"

    # Skip if already exists
    if ($quizzesHash.ContainsKey($qKey)) {
        Write-Host "Q$($qNum.ToString().PadRight(3)): $($title.PadRight(45)) - Already exists" -ForegroundColor Gray
        $totalItems += $quizzesHash[$qKey].Count
        continue
    }

    # Generate questions
    $quizQs = Generate-QuizQuestions $question $title $qNum

    if ($quizQs -and $quizQs.Count -gt 0) {
        # Convert to JSON-serializable format
        $quizzesHash[$qKey] = @()
        foreach ($q in $quizQs) {
            $quizzesHash[$qKey] += $q
        }

        $questionsGenerated++
        $totalItems += $quizQs.Count
        Write-Host "Q$($qNum.ToString().PadRight(3)): $($title.PadRight(45)) - Generated $($quizQs.Count) questions" -ForegroundColor Green
    } else {
        Write-Host "Q$($qNum.ToString().PadRight(3)): $($title.PadRight(45)) - ERROR: Could not generate" -ForegroundColor Red
    }

    # Save incrementally every 10 questions
    if ($questionsGenerated % 10 -eq 0) {
        $jsonOutput = ConvertTo-Json $quizzesHash -Depth 10
        Set-Content $quizFile -Value $jsonOutput -Encoding UTF8
        Write-Host "       $(' '.PadRight(45))   [CHECKPOINT: $($quizzesHash.Count) total questions]" -ForegroundColor Cyan
    }
}

# Final save
$jsonOutput = ConvertTo-Json $quizzesHash -Depth 10
Set-Content $quizFile -Value $jsonOutput -Encoding UTF8

# Report
Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "GENERATION COMPLETE" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "Source questions processed:      $($questions.Count)" -ForegroundColor White
Write-Host "New questions generated:         $questionsGenerated" -ForegroundColor White
Write-Host "Total questions in final file:   $($quizzesHash.Count)" -ForegroundColor White
Write-Host "Total quiz items:                $totalItems" -ForegroundColor White
Write-Host "File saved to:                   $quizFile" -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Green
