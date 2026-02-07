param(
    [string]$Message
)

$ErrorActionPreference = "Stop"

function Assert-Git {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "git não encontrado no PATH."
    }
}

Assert-Git

git status --short

if (-not $Message) {
    $Message = Read-Host "Commit message"
}

if (-not $Message) {
    throw "Commit message vazio. Abandonando."
}

git add -A

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "Nada para commitar."
    exit 0
}

git commit -m $Message
git push
