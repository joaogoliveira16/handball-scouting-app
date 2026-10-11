# lib

`signalr.min.js` é o cliente JavaScript do SignalR (`@microsoft/signalr` 8.0.29, licença MIT),
copiado de `dist/browser/` do pacote npm. Fica aqui para a app não depender de uma CDN
(o wifi do pavilhão nem sempre ajuda). Para atualizar:

    npm pack @microsoft/signalr@8
    # extrair package/dist/browser/signalr.min.js para este diretório
