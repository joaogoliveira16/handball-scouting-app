# Contexto de build: a pasta frontend/ (docker compose build frontend)
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Só os ficheiros da aplicação (sem Dockerfile nem nginx.conf dentro do site)
COPY index.html entrar.html verificar.html convidado.html equipas.html convocatoria.html banco.html dashboard.html /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
COPY lib/ /usr/share/nginx/html/lib/
COPY fonts/ /usr/share/nginx/html/fonts/

EXPOSE 80
