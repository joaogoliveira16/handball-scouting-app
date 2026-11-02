#!/usr/bin/env bash
# Prepara um servidor Ubuntu (por exemplo o da Oracle) para correr a app, com o túnel da Cloudflare.
# Corre-se no servidor, com o utilizador normal (ubuntu), nunca como root.
#
#   Primeira vez (o projeto ainda não está no servidor):
#     curl -fsSL https://raw.githubusercontent.com/joaogoliveira16/handball-scouting-app/administracao/scripts/servidor.sh -o servidor.sh
#     bash servidor.sh preparar
#
#   Depois, com o .env copiado para a pasta do projeto (e a base de dados restaurada, se vieres de outro sítio):
#     bash handball-scouting-app/scripts/servidor.sh iniciar   # arranca a app, só acessível pelo túnel
#     bash handball-scouting-app/scripts/servidor.sh tunel     # instala o túnel da Cloudflare (pede o token, que não aparece)
#     bash handball-scouting-app/scripts/servidor.sh estado    # mostra o que está a correr
#
# Variáveis (opcionais): RAMO (ramo do git, por omissão administracao), REPO, PASTA (por omissão ~/handball-scouting-app).
set -euo pipefail

RAMO=${RAMO:-administracao}
REPO=${REPO:-https://github.com/joaogoliveira16/handball-scouting-app.git}
PASTA=${PASTA:-$HOME/handball-scouting-app}

erro() { echo "ERRO: $*" >&2; exit 1; }

# docker compose, com sudo enquanto o utilizador ainda não está no grupo docker (só fica depois de sair e entrar outra vez)
dc() {
  if docker info >/dev/null 2>&1; then docker compose "$@"; else sudo docker compose "$@"; fi
}

preparar() {
  [ "$(id -u)" -ne 0 ] || erro "corre isto com o utilizador normal (por exemplo ubuntu), não como root."

  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl git

  if ! command -v docker >/dev/null 2>&1; then
    echo "A instalar o Docker (script oficial em get.docker.com)..."
    curl -fsSL https://get.docker.com | sudo sh
  fi
  sudo usermod -aG docker "$USER"

  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "A instalar o cloudflared (repositório oficial da Cloudflare)..."
    local arq
    arq="$(dpkg --print-architecture)"
    case "$arq" in amd64|arm64) ;; *) erro "arquitetura $arq não suportada pelo cloudflared." ;; esac
    sudo install -m 0755 -d /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    printf '%s\n' 'Types: deb' 'URIs: https://pkg.cloudflare.com/cloudflared' 'Suites: any' 'Components: main' \
      "Architectures: $arq" 'Signed-By: /usr/share/keyrings/cloudflare-main.gpg' \
      | sudo tee /etc/apt/sources.list.d/cloudflared.sources >/dev/null
    sudo apt-get update -y
    sudo apt-get install -y cloudflared
  fi

  if [ -d "$PASTA/.git" ]; then
    git -C "$PASTA" pull --ff-only
  else
    git clone --branch "$RAMO" "$REPO" "$PASTA"
  fi

  echo
  echo "Servidor preparado. Projeto em: $PASTA"
  echo "Sai e entra outra vez por SSH (para o Docker funcionar sem sudo)."
  echo "Depois copia o .env do teu PC para $PASTA/.env e segue o guia."
}

# Escreve CHAVE=valor no .env (troca a linha se já existir)
definir() {
  if grep -qE "^[[:space:]]*$1=" .env; then
    sed -i -E "s|^[[:space:]]*$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

iniciar() {
  cd "$PASTA" || erro "não encontro a pasta $PASTA (corre primeiro: bash servidor.sh preparar)."
  [ -f .env ] || erro "falta o ficheiro .env em $PASTA. Copia-o do teu PC."
  sed -i 's/\r$//' .env                 # o .env feito no Windows traz fins de linha CRLF
  if [ -n "$(tail -c1 .env)" ]; then echo >> .env; fi   # garante o fim de linha no último registo
  definir INTERFACE_WEB 127.0.0.1       # a porta 8080 só abre dentro do servidor: o mundo entra pelo túnel
  dc up -d --build
  echo
  dc ps
}

tunel() {
  command -v cloudflared >/dev/null 2>&1 || erro "o cloudflared não está instalado (corre: bash servidor.sh preparar)."
  echo "Na Cloudflare, abre o túnel «scouting» e copia o token (o texto comprido que começa por eyJ)."
  echo "Podes colar o comando inteiro («cloudflared service install eyJ...») ou só o token."
  local token
  read -r -s -p "Token do túnel (não aparece enquanto colas): " token
  echo
  token="${token##* }"                  # se colaram o comando todo, fica só a última palavra: o token
  [ -n "$token" ] || erro "o token está vazio."
  sudo cloudflared service uninstall >/dev/null 2>&1 || true
  sudo cloudflared service install "$token"
  echo "Túnel instalado. Na Cloudflare, o túnel deve aparecer como Healthy dentro de um minuto."
}

estado() {
  cd "$PASTA" || erro "não encontro a pasta $PASTA."
  dc ps
  echo
  echo "Túnel da Cloudflare: $(systemctl is-active cloudflared 2>/dev/null || echo 'não instalado')"
  echo "Disco: $(df -h / | awk 'NR==2 {print $3 " usados de " $2}')"
}

case "${1:-preparar}" in
  preparar) preparar ;;
  iniciar) iniciar ;;
  tunel) tunel ;;
  estado) estado ;;
  *) erro "comando desconhecido «$1». Usa: preparar, iniciar, tunel ou estado." ;;
esac
