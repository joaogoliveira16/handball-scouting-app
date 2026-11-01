# Configura o envio de emails a sério (Gmail) no .env e reinicia a app.
#   powershell -ExecutionPolicy Bypass -File scripts\email.ps1 [-Email o.teu@gmail.com] [-UrlPublico https://scouting.exemplo.pt]
# Antes, no Google: ativa a verificação em 2 passos e cria uma palavra-passe de app em https://myaccount.google.com/apppasswords
# (16 letras). O script pede-a (não aparece enquanto escreves e não fica no histórico da PowerShell), grava as linhas EMAIL_*
# no .env (que o git não guarda) e corre «docker compose up -d --build». Com -UrlPublico também define o URL_PUBLICO.
param(
    [string]$Email = '',
    [string]$UrlPublico = ''
)

Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
    throw 'O docker não está instalado ou não está no PATH. Abre o Docker Desktop e tenta outra vez.'
}

# Lê e muda uma linha CHAVE=valor do .env (sem BOM, como o docker compose espera)
$caminhoEnv = Join-Path (Get-Location) '.env'
function ValorDoEnv([string]$chave) {
    if (-not (Test-Path $caminhoEnv)) { return $null }
    foreach ($linha in [System.IO.File]::ReadAllLines($caminhoEnv)) {
        if ($linha -match "^\s*$chave=(.*)$") { return $Matches[1].Trim() }
    }
    return $null
}
function DefinirNoEnv([string]$chave, [string]$valor) {
    $linhas = @()
    if (Test-Path $caminhoEnv) { $linhas = @([System.IO.File]::ReadAllLines($caminhoEnv)) }
    $feito = $false
    $novas = @()
    foreach ($linha in $linhas) {
        if (-not $feito -and $linha -match "^\s*$chave=") { $novas += "$chave=$valor"; $feito = $true } else { $novas += $linha }
    }
    if (-not $feito) { $novas += "$chave=$valor" }
    [System.IO.File]::WriteAllLines($caminhoEnv, [string[]]$novas, (New-Object System.Text.UTF8Encoding($false)))
}

# O email da conta Gmail (Enter aceita o que já estava no .env)
$anterior = ValorDoEnv 'EMAIL_UTILIZADOR'
if (-not $Email) {
    $sugestao = if ($anterior) { " [$anterior]" } else { '' }
    $Email = (Read-Host "Email da conta Gmail$sugestao").Trim()
    if (-not $Email -and $anterior) { $Email = $anterior }
}
if ($Email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "«$Email» não é um email válido." }

# A palavra-passe de app: 16 letras minúsculas (o Google mostra-as em 4 grupos; os espaços não contam)
$segura = Read-Host 'Palavra-passe de app do Google (16 letras)' -AsSecureString
$ponteiro = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
try { $senha = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) }
finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
$senha = $senha -replace '\s', ''
if ($senha -cnotmatch '^[a-z]{16}$') {
    throw 'Isso não parece uma palavra-passe de app: são 16 letras minúsculas (por exemplo abcdefghijklmnop). Não uses a palavra-passe normal da conta. Cria uma em https://myaccount.google.com/apppasswords (precisa da verificação em 2 passos).'
}

DefinirNoEnv 'EMAIL_HOST' 'smtp.gmail.com'
DefinirNoEnv 'EMAIL_PORTA' '587'
DefinirNoEnv 'EMAIL_SSL' 'true'
DefinirNoEnv 'EMAIL_UTILIZADOR' $Email
DefinirNoEnv 'EMAIL_SENHA' $senha
DefinirNoEnv 'EMAIL_DE' $Email
if ($UrlPublico) { DefinirNoEnv 'URL_PUBLICO' $UrlPublico.Trim().TrimEnd('/') }
$senha = $null
Write-Host "Gravado no .env: EMAIL_* para $Email$(if ($UrlPublico) { " e URL_PUBLICO=$($UrlPublico.Trim().TrimEnd('/'))" })."

# Recria os contentores para a API ler o .env novo (a primeira vez pode demorar uns minutos)
Write-Host 'A reiniciar a app...'
& docker.exe compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up -d --build falhou (código $LASTEXITCODE). Confirma que o Docker Desktop está a correr." }

Write-Host ''
Write-Host 'Pronto. Na administração da app usa «Enviar email de teste para mim» e vê se o email chega.'
