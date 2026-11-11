# Versão online (GitHub Pages)

O mesmo app, sem servidor: abre pelo link `https://<usuario>.github.io/GERADOC/`.

## Como funciona
- `scripts/build-site.js` (`npm run build:site`) copia `public/` + os módulos de `src/` para `site/`, empacota `docx` e `buffer`
  (esbuild) e injeta no `index.html` um *importmap* e `src/web/boot.js`.
- `src/web/boot.js` troca `fetch('/api/...')` (e links de download `/api/...`) por `src/web/servidor-web.js`, que responde com
  os mesmos módulos do servidor (`modelos.js`, `historico.js`, `lote.js`).
- `node:fs/promises`, `node:path`, `node:crypto` apontam (importmap) para `src/web/fs.js` (arquivos em **IndexedDB**), `path.js`, `crypto.js`.
- Dados ficam **só no navegador/aparelho** do usuário. Para levar a outro lugar: Configurações → Exportar/Importar modelos.

## Diferenças da versão instalada
| Item | Online |
|---|---|
| Word (.docx) | igual (gerado no navegador, `src/web/gerador-web.js`) |
| PDF | abre a janela de impressão → "Salvar como PDF" (cabeçalho/rodapé/numeração via CSS de impressão) |
| Lote | só Word (.zip); PDF em lote só na versão instalada |
| Backup externo, atalho, encerrar | ocultos (`data-so-servidor`) |

## Publicar
`.github/workflows/pages.yml` publica a cada push na `main`. Ative uma vez: **Settings → Pages → Source: GitHub Actions**.
Testar local: `npm run build:site` e servir a pasta `site/` (qualquer servidor estático).
