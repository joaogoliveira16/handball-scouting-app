# Contexto de build: a pasta api/ (docker compose build api)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Primeiro só o .csproj, para a restauração de pacotes ficar em cache
COPY HandballScouting.Api/HandballScouting.Api.csproj HandballScouting.Api/
RUN dotnet restore HandballScouting.Api/HandballScouting.Api.csproj

COPY HandballScouting.Api/ HandballScouting.Api/
RUN dotnet publish HandballScouting.Api/HandballScouting.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
COPY --from=build /app .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "HandballScouting.Api.dll"]
