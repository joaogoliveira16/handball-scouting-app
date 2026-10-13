# Contexto de build: a pasta frontend/ (docker compose build frontend)
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Só os ficheiros da aplicação (sem Dockerfile nem nginx.conf dentro do site)
COPY index.html entrar.html verificar.html redefinir.html convidado.html equipas.html convocatoria.html banco.html dashboard.html /usr/share/nginx/html/
# Sem rede no pavilhão: o service worker (tem de estar na raiz do site), o manifest e os ícones da app instalável
COPY sw.js manifest.webmanifest /usr/share/nginx/html/
COPY icons/ /usr/share/nginx/html/icons/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY lib/ /usr/share/nginx/html/lib/
COPY fonts/ /usr/share/nginx/html/fonts/

EXPOSE 80
