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

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @()
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao executar: $FilePath $($Arguments -join ' ') (exit=$LASTEXITCODE)"
    }
}

Assert-Command git
Assert-Command ssh
Assert-Command scp

Invoke-External git @("status", "--short")

$status = (& git status --porcelain)
if ($status) {
    if (-not $Message) {
        $Message = Read-Host "Commit message"
    }
    if (-not $Message) {
        throw "Commit message vazio. Abandonando."
    }

    Invoke-External git @("add", "-A")
    Invoke-External git @("commit", "-m", $Message)
    Invoke-External git @("push")
} else {
    Write-Host "Nada para commitar. Seguindo para o deploy..."
}

$localCommit = (& git rev-parse HEAD).Trim()
Write-Host "Commit local: $localCommit"

$defaultKey = Join-Path $env:USERPROFILE ".ssh\codex_temp"
if (-not $SshKey -and (Test-Path $defaultKey)) {
    $SshKey = $defaultKey
}
if (-not $SshKey) {
    throw "BOT_SSH_KEY não definido e nenhuma chave padrão encontrada. Defina a variável ou passe -SshKey."
}
$sshArgs = @("-i", $SshKey, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")

$remote = "$VpsUser@$VpsHost"
$remoteGitCmd = @(
    "set -e"
    "cd $VpsPath"
    "git fetch --all --prune > /dev/null"
    "git checkout main > /dev/null"
    "git reset --hard origin/main > /dev/null"
    "git clean -fd > /dev/null"
    "git rev-parse HEAD"
) -join " && "

$remoteStatusCmd = "cd $VpsPath && git status --porcelain"
$remoteRestartCmd = "cd $VpsPath && pm2 restart $Pm2App --update-env"
$localSigmaConfig = Join-Path $PSScriptRoot "config\sigma_servers.local.json"
$remoteSigmaConfig = "$VpsPath/config/sigma_servers.local.json"

$confirm = Read-Host "Subir para a VPS agora? (S/N) (isso descarta alterações locais na VPS)"
if ($confirm -match '^[sS]') {
    $remoteCommit = (& ssh @sshArgs $remote $remoteGitCmd).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no sync git da VPS."
    }
    Write-Host "Commit remoto após sync: $remoteCommit"
    $remoteStatus = (& ssh @sshArgs $remote $remoteStatusCmd)
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao verificar status na VPS."
    }
    if ($remoteStatus) {
        Write-Host "Aviso: VPS com alteracoes locais:"
        Write-Host $remoteStatus
    }

    # Sincroniza configs locais (não versionadas) para a VPS.
    if (Test-Path $localSigmaConfig) {
        Write-Host "Enviando sigma_servers.local.json para a VPS..."
        & scp @sshArgs $localSigmaConfig "${remote}:$remoteSigmaConfig"
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao enviar sigma_servers.local.json."
        }
    } else {
        Write-Host "Aviso: config\\sigma_servers.local.json não existe localmente; pulando sync."
    }

    Write-Host "Reiniciando PM2..."
    & ssh @sshArgs $remote $remoteRestartCmd
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao reiniciar PM2 na VPS."
    }
    Write-Host "PM2 reiniciado."

    if ($remoteCommit -ne $localCommit) {
        Write-Host "Aviso: commit remoto diferente do local. Verifique branch/repositório na VPS."
    } else {
        Write-Host "VPS sincronizada com sucesso no commit local."
    }
} else {
    Write-Host "Deploy na VPS cancelado."
}
