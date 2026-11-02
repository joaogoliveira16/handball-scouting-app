# Restaura uma cópia feita com scripts\backup.ps1. ATENÇÃO: SUBSTITUI todos os dados atuais pelos da cópia.
#   powershell -ExecutionPolicy Bypass -File scripts\restaurar.ps1 backups\scouting-20261029-183000.dump [-Sim]
# Sem -Sim pergunta antes. Pára a API durante a restauração (para não haver ligações abertas) e volta a arrancá-la;
# se a cópia for de uma versão mais antiga, o serviço "migrar" atualiza a base de dados ao arrancar.
# A restauração é feita numa só transação: se algo falhar, a base de dados fica como estava.
param(
    [Parameter(Mandatory = $true)][string]$Ficheiro,
    [switch]$Sim
)

# O caminho do ficheiro lê-se antes de mudar de pasta: pode ser relativo à pasta onde o comando foi escrito
$ficheiroCompleto = Resolve-Path -LiteralPath $Ficheiro -ErrorAction SilentlyContinue
if (-not $ficheiroCompleto) {
    Write-Host "Não encontrei o ficheiro $Ficheiro" -ForegroundColor Red
    exit 1
}
$ficheiroCompleto = $ficheiroCompleto.Path

Set-Location (Join-Path $PSScriptRoot '..')

# Corre o docker e pára se falhar (o PowerShell não pára sozinho quando um programa devolve erro)
function InvocarDocker {
    & docker.exe @args
    if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') falhou (código $LASTEXITCODE)." }
}

if (-not $Sim) {
    Write-Host "Isto SUBSTITUI todos os dados atuais pelos da cópia $Ficheiro."
    Write-Host 'Dica: faz antes uma cópia dos dados atuais com: powershell -ExecutionPolicy Bypass -File scripts\backup.ps1'
    $resposta = Read-Host 'Escreve «sim» para continuar'
    if ($resposta -ne 'sim') {
        Write-Host 'Cancelado: nada foi alterado.'
        exit 1
    }
}

InvocarDocker compose up -d db
for ($i = 0; $i -lt 30; $i++) {
    & docker.exe compose exec -T db pg_isready -q
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}
InvocarDocker compose exec -T db pg_isready -q   # falha aqui se a base de dados não arrancou

InvocarDocker compose stop api
InvocarDocker compose cp $ficheiroCompleto db:/tmp/restaurar.dump
InvocarDocker compose exec -T db sh -c 'pg_restore -l /tmp/restaurar.dump > /dev/null'   # confere que o ficheiro se consegue ler
InvocarDocker compose exec -T db sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error -U $POSTGRES_USER -d $POSTGRES_DB /tmp/restaurar.dump'
InvocarDocker compose exec -T db rm -f /tmp/restaurar.dump

InvocarDocker compose run --rm migrar   # atualiza o esquema se a cópia for de uma versão mais antiga (é repetível)
InvocarDocker compose up -d

Write-Host "Cópia restaurada a partir de $Ficheiro"
