# Configura o envio de emails a sério no .env e reinicia a app. Serve para o Gmail (por omissão) e para qualquer servidor SMTP
# com STARTTLS na porta 587 (por exemplo a Brevo).
#   Gmail:  powershell -ExecutionPolicy Bypass -File scripts\email.ps1 [-Utilizador o.teu@gmail.com]
#   Brevo:  powershell -ExecutionPolicy Bypass -File scripts\email.ps1 -Servidor smtp-relay.brevo.com [-Utilizador LOGIN_SMTP] [-De scouting@exemplo.pt]
# Acrescenta -UrlPublico https://scouting.exemplo.pt para definir também o URL_PUBLICO.
# Gmail: ativa a verificação em 2 passos e cria uma palavra-passe de app em https://myaccount.google.com/apppasswords (16 letras).
# Brevo: o utilizador é o «Login» da página SMTP & API e a palavra-passe é uma chave SMTP gerada aí.
# O script pede a palavra-passe (não aparece enquanto escreves e não fica no histórico da PowerShell), grava as linhas EMAIL_*
# no .env (que o git não guarda) e corre «docker compose up -d --build».
param(
    [Alias('Email')][string]$Utilizador = '',
    [string]$De = '',
    [string]$Servidor = 'smtp.gmail.com',
    [int]$Porta = 587,
    [string]$UrlPublico = ''
)

Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
    throw 'O docker não está instalado ou não está no PATH. Abre o Docker Desktop e tenta outra vez.'
}
if ($Porta -eq 465) { throw 'A porta 465 (TLS direto) não é suportada pela app: usa a 587 (STARTTLS).' }
$ehGmail = $Servidor -eq 'smtp.gmail.com'
$padraoEmail = '^[^@\s]+@[^@\s]+\.[^@\s]+$'

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

# Com Enter aceita-se o que já estava no .env
function Perguntar([string]$texto, [string]$anterior) {
    $sugestao = if ($anterior) { " [$anterior]" } else { '' }
    $resposta = (Read-Host "$texto$sugestao").Trim()
    if (-not $resposta -and $anterior) { return $anterior }
    return $resposta
}

# Utilizador do servidor (no Gmail é o email da conta)
if (-not $Utilizador) {
    $texto = if ($ehGmail) { 'Email da conta Gmail' } else { 'Utilizador (login SMTP)' }
    $Utilizador = Perguntar $texto (ValorDoEnv 'EMAIL_UTILIZADOR')
}
if (-not $Utilizador -or $Utilizador -match '\s') { throw "«$Utilizador» não é um utilizador válido." }
if ($ehGmail -and $Utilizador -notmatch $padraoEmail) { throw "«$Utilizador» não é um email válido." }

# Remetente: no Gmail é a própria conta; nos outros servidores é o endereço verificado no serviço (por exemplo scouting@o-teu-dominio.pt)
if (-not $De) {
    if ($ehGmail) { $De = $Utilizador }
    else { $De = Perguntar 'Email de onde saem as mensagens (remetente)' (ValorDoEnv 'EMAIL_DE') }
}
if ($De -notmatch $padraoEmail) { throw "«$De» não é um email válido para o remetente." }

# A palavra-passe: no Gmail são 16 letras minúsculas (o Google mostra-as em 4 grupos; os espaços não contam)
$pedido = if ($ehGmail) { 'Palavra-passe de app do Google (16 letras)' } else { 'Palavra-passe ou chave SMTP' }
$segura = Read-Host $pedido -AsSecureString
$ponteiro = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
try { $senha = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ponteiro) }
finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ponteiro) }
if ($ehGmail) {
    $senha = $senha -replace '\s', ''
    if ($senha -cnotmatch '^[a-z]{16}$') {
        # Diz só a forma do que recebeu (nunca o conteúdo), para se perceber o que correu mal
        $forma = @("$($senha.Length) caracteres")
        if ($senha -cmatch '[A-Z]') { $forma += 'com maiúsculas' }
        if ($senha -match '[0-9]') { $forma += 'com números' }
        if ($senha -match '[^a-zA-Z0-9]') { $forma += 'com símbolos' }
        throw "Isso não parece uma palavra-passe de app (recebi $($forma -join ', ')). Tem de ter 16 letras minúsculas, por exemplo abcdefghijklmnop. Não uses a palavra-passe normal da conta: cria uma em https://myaccount.google.com/apppasswords (precisa da verificação em 2 passos)."
    }
} else {
    $senha = $senha.Trim()
    if (-not $senha) { throw 'A palavra-passe (ou chave SMTP) não pode ficar vazia.' }
}

DefinirNoEnv 'EMAIL_HOST' $Servidor
DefinirNoEnv 'EMAIL_PORTA' "$Porta"
DefinirNoEnv 'EMAIL_SSL' 'true'
DefinirNoEnv 'EMAIL_UTILIZADOR' $Utilizador
DefinirNoEnv 'EMAIL_SENHA' $senha
DefinirNoEnv 'EMAIL_DE' $De
if ($UrlPublico) { DefinirNoEnv 'URL_PUBLICO' $UrlPublico.Trim().TrimEnd('/') }
$senha = $null
Write-Host "Gravado no .env: EMAIL_* ($Servidor, utilizador $Utilizador, remetente $De)$(if ($UrlPublico) { " e URL_PUBLICO=$($UrlPublico.Trim().TrimEnd('/'))" })."

# Recria os contentores para a API ler o .env novo (a primeira vez pode demorar uns minutos)
Write-Host 'A reiniciar a app...'
& docker.exe compose up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up -d --build falhou (código $LASTEXITCODE). Confirma que o Docker Desktop está a correr." }

Write-Host ''
Write-Host 'Pronto. Na administração da app usa «Enviar email de teste para mim» e vê se o email chega.'
