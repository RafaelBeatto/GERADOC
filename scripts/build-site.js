// GERADOC — monta a versão online (GitHub Pages) na pasta site/.
// É o mesmo app (public/ + os módulos de src/), mas sem servidor: o armazenamento e a geração de
// documentos rodam no navegador (src/web/). Uso: npm run build:site
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(raiz, 'site');
const dest = (...p) => path.join(site, ...p);

fs.rmSync(site, { recursive: true, force: true });
fs.cpSync(path.join(raiz, 'public'), site, { recursive: true });
fs.cpSync(path.join(raiz, 'node_modules', 'quill', 'dist'), dest('vendor', 'quill'), { recursive: true });

// Módulos do servidor que também rodam no navegador (o app.js, servidor.js e backup-externo.js ficam de fora).
const SO_SERVIDOR = new Set(['app.js', 'servidor.js', 'backup-externo.js']);
function copiarFonte(pasta) {
  fs.mkdirSync(dest('src', path.relative(path.join(raiz, 'src'), pasta)), { recursive: true });
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    const origem = path.join(pasta, item.name);
    if (item.isDirectory()) { copiarFonte(origem); continue; }
    if (pasta === path.join(raiz, 'src') && SO_SERVIDOR.has(item.name)) continue;
    let texto = fs.readFileSync(origem, 'utf8').replaceAll('../public/js/', '../js/');
    if (item.name === 'docx.js') {
      // No navegador não existe Packer.toBuffer (Buffer do Node): gera os bytes pelo Blob.
      texto = texto.replace('return Packer.toBuffer(doc);', 'return new Uint8Array(await (await Packer.toBlob(doc)).arrayBuffer());');
    }
    fs.writeFileSync(dest('src', path.relative(path.join(raiz, 'src'), origem)), texto);
  }
}
copiarFonte(path.join(raiz, 'src'));

// Bibliotecas do Node usadas pelos módulos: empacotadas em um arquivo só cada.
const comum = { bundle: true, format: 'esm', minify: true, platform: 'browser', logLevel: 'warning' };
await build({ ...comum, entryPoints: [path.join(raiz, 'node_modules/docx/dist/index.mjs')], outfile: dest('vendor', 'docx.js') });
await build({
  ...comum,
  stdin: { contents: "export { Buffer } from 'buffer';", resolveDir: raiz },
  outfile: dest('vendor', 'buffer.js'),
});

// index.html: mapa de módulos + o "servidor" do navegador antes do app.
const mapa = {
  imports: {
    docx: './vendor/docx.js',
    buffer: './vendor/buffer.js',
    'node:fs/promises': './src/web/fs.js',
    'node:fs': './src/web/node-fs.js',
    'node:path': './src/web/path.js',
    'node:crypto': './src/web/crypto.js',
    'puppeteer-core': './src/web/puppeteer-vazio.js',
  },
};
let html = fs.readFileSync(dest('index.html'), 'utf8');
const alvo = '<script src="vendor/quill/quill.js"></script>';
if (!html.includes(alvo)) throw new Error('index.html mudou: não achei a linha do Quill.');
html = html.replace('<link rel="stylesheet" href="vendor/quill/quill.snow.css">',
  `<script type="importmap">${JSON.stringify(mapa)}</script>\n  <link rel="stylesheet" href="vendor/quill/quill.snow.css">`);
html = html.replace('<script src="js/app.js" type="module"></script>',
  '<script src="src/web/boot.js" type="module"></script>\n  <script src="js/app.js" type="module"></script>');
fs.writeFileSync(dest('index.html'), html);
fs.writeFileSync(dest('.nojekyll'), '');
console.log('Versão online montada em site/');
