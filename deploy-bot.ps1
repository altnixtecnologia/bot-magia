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
Assert-Command scp

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

$defaultKey = Join-Path $env:USERPROFILE ".ssh\codex_temp"
if (-not $SshKey -and (Test-Path $defaultKey)) {
    $SshKey = $defaultKey
}
if (-not $SshKey) {
    throw "BOT_SSH_KEY não definido e nenhuma chave padrão encontrada. Defina a variável ou passe -SshKey."
}
$sshArgs = @("-i", $SshKey, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")

$remote = "$VpsUser@$VpsHost"
$remoteGitCmd = "cd $VpsPath && git fetch --all && git reset --hard origin/main && git clean -fd && git pull --ff-only"
$remoteRestartCmd = "cd $VpsPath && pm2 restart $Pm2App --update-env"
$localSigmaConfig = Join-Path $PSScriptRoot "config\sigma_servers.local.json"
$remoteSigmaConfig = "$VpsPath/config/sigma_servers.local.json"

$confirm = Read-Host "Subir para a VPS agora? (S/N) (isso descarta alterações locais na VPS)"
if ($confirm -match '^[sS]') {
    & ssh @sshArgs $remote $remoteGitCmd

    # Sincroniza configs locais (não versionadas) para a VPS.
    if (Test-Path $localSigmaConfig) {
        Write-Host "Enviando sigma_servers.local.json para a VPS..."
        & scp @sshArgs $localSigmaConfig "${remote}:$remoteSigmaConfig"
    } else {
        Write-Host "Aviso: config\\sigma_servers.local.json não existe localmente; pulando sync."
    }

    Write-Host "Reiniciando PM2..."
    & ssh @sshArgs $remote $remoteRestartCmd
    Write-Host "PM2 reiniciado."
} else {
    Write-Host "Deploy na VPS cancelado."
}
