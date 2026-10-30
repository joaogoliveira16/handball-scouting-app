# Põe a app na internet, com um endereço https temporário (Cloudflare Quick Tunnel): sem conta e sem domínio.
#   powershell -ExecutionPolicy Bypass -File scripts\internet.ps1 [-Porta 8080]
# Precisa da app a correr (docker compose up -d) e do cloudflared (winget install --id Cloudflare.cloudflared).
# O endereço muda de cada vez que corres o script. Enquanto ele está a correr, o URL_PUBLICO do .env é esse endereço
# (é o que vai dentro das ligações dos emails). Carrega em Ctrl+C para fechar o túnel: o URL_PUBLICO volta ao que era.
param([int]$Porta = 8080)

Set-Location (Join-Path $PSScriptRoot '..')

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    throw 'O cloudflared não está instalado. Instala com: winget install --id Cloudflare.cloudflared (e abre outra PowerShell).'
}

try {
    Invoke-WebRequest -Uri "http://localhost:$Porta" -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
    throw "A app não responde em http://localhost:$Porta. Arranca-a com: docker compose up -d"
}

# Lê e muda uma linha CHAVE=valor do .env (sem BOM, como o docker compose espera). Devolve o valor que lá estava.
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

# Recria a API para ela ler o .env novo (demora uns segundos)
function AtualizarApi {
    & docker.exe compose up -d api
    if ($LASTEXITCODE -ne 0) { throw "docker compose up -d api falhou (código $LASTEXITCODE)." }
}

$saida = Join-Path ([System.IO.Path]::GetTempPath()) 'cloudflared-scouting.out.log'
$erro = Join-Path ([System.IO.Path]::GetTempPath()) 'cloudflared-scouting.err.log'
Remove-Item $saida, $erro -ErrorAction SilentlyContinue

Write-Host 'A abrir o túnel...'
$opcoes = @{}
if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $opcoes.WindowStyle = 'Hidden' }   # sem janela preta
$processo = Start-Process -FilePath $cloudflared.Source -PassThru @opcoes `
    -ArgumentList @('tunnel', '--no-autoupdate', '--url', "http://localhost:$Porta") `
    -RedirectStandardOutput $saida -RedirectStandardError $erro

$anterior = ValorDoEnv 'URL_PUBLICO'
$alterouEnv = $false
try {
    # O cloudflared escreve o endereço no registo dele (stderr) pouco depois de arrancar
    $url = $null
    for ($i = 0; $i -lt 60 -and -not $url -and -not $processo.HasExited; $i++) {
        Start-Sleep -Seconds 1
        try {
            $achado = Select-String -Path $erro -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction Stop | Select-Object -First 1
            if ($achado) { $url = $achado.Matches[0].Value }
        } catch { }
    }
    if (-not $url) {
        $fim = if (Test-Path $erro) { (Get-Content $erro -Tail 15) -join [Environment]::NewLine } else { '(sem registo)' }
        throw "O cloudflared não deu nenhum endereço. O que ele escreveu:$([Environment]::NewLine)$fim"
    }

    DefinirNoEnv 'URL_PUBLICO' $url
    $alterouEnv = $true
    Write-Host "URL_PUBLICO = $url"
    AtualizarApi

    # Um endereço novo pode demorar uns segundos até o DNS o conhecer
    $abre = $false
    for ($i = 0; $i -lt 10 -and -not $abre; $i++) {
        try {
            Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 | Out-Null
            $abre = $true
        } catch { Start-Sleep -Seconds 2 }
    }

    Write-Host ''
    Write-Host "A app está na internet em: $url"
    if (-not $abre) { Write-Host '(Ainda não responde: pode demorar mais um minuto. Tenta abrir o endereço daqui a pouco.)' }
    Write-Host 'Deixa esta janela aberta. Carrega em Ctrl+C para fechar o túnel.'
    Wait-Process -Id $processo.Id
} finally {
    if (-not $processo.HasExited) { Stop-Process -Id $processo.Id -Force -ErrorAction SilentlyContinue }
    if ($alterouEnv) {
        Write-Host 'A fechar o túnel e a repor o URL_PUBLICO...'
        DefinirNoEnv 'URL_PUBLICO' $(if ($anterior) { $anterior } else { "http://localhost:$Porta" })
        AtualizarApi
    }
}
