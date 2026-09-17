$ErrorActionPreference = 'Stop'

function Fail($message) {
    Write-Host $message -ForegroundColor Red
    exit 1
}

$branch = (git branch --show-current).Trim()
if ($branch -ne 'main') {
    Fail "git deploy only deploys main. Current branch: $branch"
}

$status = git status --porcelain
if ($status) {
    Fail 'Working tree is not clean. Commit or discard local changes before git deploy.'
}

Write-Host 'Pushing main...'
git push origin main
if ($LASTEXITCODE -ne 0) { Fail 'git push failed.' }

$sourceSha = (git rev-parse HEAD).Trim()
$treeSha = (git rev-parse "$sourceSha^{tree}").Trim()
if (-not $sourceSha -or -not $treeSha) { Fail 'Could not resolve source commit/tree.' }

Write-Host "Requesting deployment of $sourceSha..."

# Fetch the current deploy branch so each deploy request can append a new marker commit.
git fetch origin deploy --quiet 2>$null
$deployParent = $null
if ($LASTEXITCODE -eq 0) {
    $deployParent = (git rev-parse refs/remotes/origin/deploy).Trim()
}
if (-not $deployParent) {
    $deployParent = $sourceSha
}

# Create a unique deployment marker commit that contains the exact same tree as main.
# This makes every `git deploy` a real push event without changing main or application files.
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$message = "Deploy source $sourceSha at $timestamp"
$deployCommit = ($message | git commit-tree $treeSha -p $deployParent).Trim()
if ($LASTEXITCODE -ne 0 -or -not $deployCommit) { Fail 'Could not create deploy marker commit.' }

Write-Host "Deploy marker: $deployCommit"
git push origin "$deployCommit`:refs/heads/deploy"
if ($LASTEXITCODE -ne 0) { Fail 'Could not update deploy branch.' }

Write-Host "Deploy requested for source $sourceSha. GitHub Actions will run CI first, then CD only if CI passes."
