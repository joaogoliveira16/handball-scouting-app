# Contexto de build: a pasta frontend/ (docker compose build frontend)
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Cabeçalhos de segurança (CSP, HSTS...): fora de conf.d para só entrarem pelos include do nginx.conf
COPY cabecalhos-seguranca.conf /etc/nginx/cabecalhos-seguranca.conf

# Todas as páginas (*.html): uma página nova fica logo no site, sem lista para atualizar (o teste tests/unidade/docker.test.mjs confere)
COPY *.html /usr/share/nginx/html/
# Sem rede no pavilhão: o service worker (tem de estar na raiz do site), o manifest e os ícones da app instalável
COPY sw.js manifest.webmanifest /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY lib/ /usr/share/nginx/html/lib/
COPY fonts/ /usr/share/nginx/html/fonts/

EXPOSE 80
