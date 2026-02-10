param(
    [string]$Message,
    [string]$VpsHost = "76.13.166.63",
    [string]$VpsUser = "root",
    [string]$VpsPath = "/root/bot-magia/bot-magia",
    [string]$Pm2App = "bot-magia",
    [string]$SshKey = $env:BOT_SSH_KEY
)

$ErrorActionPreference = "Stop"

function Assert-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "$name não encontrado no PATH."
    }
}

Assert-Command git
Assert-Command ssh

git status --short

$status = git status --porcelain
if ($status) {
    if (-not $Message) {
        $Message = Read-Host "Commit message"
    }
    if (-not $Message) {
        throw "Commit message vazio. Abandonando."
    }

    git add -A
    git commit -m $Message
    git push
} else {
    Write-Host "Nada para commitar. Seguindo para o deploy..."
}

$sshArgs = @()
if ($SshKey) {
    $sshArgs += "-i"
    $sshArgs += $SshKey
}

$remote = "$VpsUser@$VpsHost"
$remoteCmd = "cd $VpsPath && git pull && pm2 restart $Pm2App"

$confirm = Read-Host "Subir para a VPS agora? (S/N)"
if ($confirm -match '^[sS]') {
    & ssh @sshArgs $remote $remoteCmd
} else {
    Write-Host "Deploy na VPS cancelado."
}
