# Cópia de segurança de TODA a base de dados (contas, equipas, jogadores, jogos, eventos, escudos) para um ficheiro.
# Guarda em backups\scouting-AAAAMMDD-HHMMSS.dump (formato do pg_dump, que o scripts\restaurar.ps1 lê).
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 [-Pasta backups]
# Precisa do serviço da base de dados a correr (docker compose up -d). Nada é parado nem alterado.
param([string]$Pasta = 'backups')

Set-Location (Join-Path $PSScriptRoot '..')

# Corre o docker e pára se falhar (o PowerShell não pára sozinho quando um programa devolve erro)
function InvocarDocker {
    & docker.exe @args
    if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') falhou (código $LASTEXITCODE)." }
}

New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
$ficheiro = Join-Path $Pasta ('scouting-{0}.dump' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

& docker.exe compose exec -T db pg_isready -q
if ($LASTEXITCODE -ne 0) { throw 'A base de dados não está a correr. Arranca-a com: docker compose up -d db' }

# O pg_dump corre dentro do contentor (guarda em /tmp) e o ficheiro vem de lá com "docker compose cp":
# redirecionar a saída do pg_dump para um ficheiro, no PowerShell, estraga o ficheiro.
InvocarDocker compose exec -T db sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /tmp/backup.dump'
InvocarDocker compose exec -T db sh -c 'pg_restore -l /tmp/backup.dump > /dev/null'   # confere que o ficheiro se consegue ler
InvocarDocker compose cp db:/tmp/backup.dump $ficheiro
InvocarDocker compose exec -T db rm -f /tmp/backup.dump

$tamanho = [math]::Round((Get-Item $ficheiro).Length / 1KB)
Write-Host "Cópia de segurança guardada em $ficheiro ($tamanho KB)"
