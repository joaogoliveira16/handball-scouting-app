# lib

Bibliotecas de terceiros, copiadas para aqui para a app não depender de uma CDN
(o wifi do pavilhão nem sempre ajuda).

## signalr.min.js

Cliente JavaScript do SignalR (`@microsoft/signalr` 8.0.29, licença MIT), copiado de
`dist/browser/` do pacote npm. Para atualizar:

    npm pack @microsoft/signalr@8
    # extrair package/dist/browser/signalr.min.js para este diretório

## tesseract/

O leitor de imagens (OCR) de «Ler de uma foto», na convocatória. Corre no browser da pessoa: a imagem não sai
do dispositivo. Só se descarrega (cerca de 5 MB) quando alguém lê uma foto, e o browser guarda-o (o `nginx.conf`
dá-lhe uma semana de cache e comprime-o).

| Ficheiro | Origem | Licença |
| --- | --- | --- |
| `tesseract.min.js`, `worker.min.js` | `tesseract.js` 7.0.0, `dist/` | Apache-2.0 (`LICENSE-tesseract.js.txt`) |
| `tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core` 7.0.0 (motor Tesseract compilado para WebAssembly, só LSTM, com SIMD) | Apache-2.0 |
| `por.traineddata.gz` | `@tesseract.js-data/por` 1.0.0, `4.0.0_best_int/` (português) | Apache-2.0 (dados do Tesseract) |

Para atualizar, noutra pasta:

    npm pack tesseract.js@7 tesseract.js-core@7 @tesseract.js-data/por
    # tesseract.js:       package/dist/tesseract.min.js e package/dist/worker.min.js
    # tesseract.js-core:  package/tesseract-core-simd-lstm.wasm.js
    # @tesseract.js-data/por: package/4.0.0_best_int/por.traineddata.gz

Os caminhos dos ficheiros estão em `frontend/js/ocr.js` (`workerPath`, `corePath`, `langPath`); o motor com SIMD
precisa de um browser recente (todos os de hoje). Depois de atualizar, corre `node e2e/fluxos.mjs` (o passo
«Convocatória: ler a lista de uma foto» usa o leitor a sério).
