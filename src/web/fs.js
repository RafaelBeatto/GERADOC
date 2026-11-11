// GERADOC (modo web) — "pasta" de arquivos guardada no IndexedDB do navegador.
// Implementa só o que modelos.js, historico.js e a configuração usam de `node:fs/promises`.
// Tudo fica em memória e é gravado no IndexedDB a cada alteração.
const BANCO = 'geradoc-dados';
const LOJA = 'arquivos';

const MARCA = '.pasta';
const arquivos = new Map(); // caminho → texto
let pronto = null;
let banco = null;

const erro = (code, caminho) => Object.assign(new Error(`${code}: ${caminho}`), { code });

function abrirBanco() {
  return new Promise((resolver, rejeitar) => {
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rejeitar(pedido.error);
  });
}

function transacao(modo, fn) {
  return new Promise((resolver, rejeitar) => {
    const t = banco.transaction(LOJA, modo);
    const loja = t.objectStore(LOJA);
    const resultado = fn(loja);
    t.oncomplete = () => resolver(resultado);
    t.onerror = () => rejeitar(t.error);
    t.onabort = () => rejeitar(t.error);
  });
}

/** Abre o banco e carrega tudo para a memória (chamado uma vez ao iniciar). */
export function iniciarArmazenamento() {
  pronto ??= (async () => {
    banco = await abrirBanco();
    await new Promise((resolver, rejeitar) => {
      const t = banco.transaction(LOJA, 'readonly');
      const cursor = t.objectStore(LOJA).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        arquivos.set(c.key, c.value);
        c.continue();
      };
      t.oncomplete = resolver;
      t.onerror = () => rejeitar(t.error);
    });
    navigator.storage?.persist?.().catch(() => {}); // pede ao navegador para não apagar os dados
  })();
  return pronto;
}

const caminho = (p) => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');

export async function readFile(p) {
  await iniciarArmazenamento();
  const c = caminho(p);
  if (!arquivos.has(c)) throw erro('ENOENT', c);
  return arquivos.get(c);
}

export async function writeFile(p, texto) {
  await iniciarArmazenamento();
  const c = caminho(p);
  await transacao('readwrite', (loja) => loja.put(String(texto), c));
  arquivos.set(c, String(texto));
}

export async function rm(p, { force = false } = {}) {
  await iniciarArmazenamento();
  const c = caminho(p);
  if (!arquivos.has(c)) {
    if (force) return;
    throw erro('ENOENT', c);
  }
  await transacao('readwrite', (loja) => loja.delete(c));
  arquivos.delete(c);
}

export async function rename(origem, destino) {
  const texto = await readFile(origem);
  await writeFile(destino, texto);
  await rm(origem);
}

export async function readdir(pasta) {
  await iniciarArmazenamento();
  const prefixo = `${caminho(pasta)}/`;
  const nomes = new Set();
  let existe = false;
  for (const c of arquivos.keys()) {
    if (!c.startsWith(prefixo)) continue;
    existe = true;
    const nome = c.slice(prefixo.length).split('/')[0];
    if (nome !== MARCA) nomes.add(nome);
  }
  if (!existe) throw erro('ENOENT', pasta);
  return [...nomes];
}

/** Uma pasta existe se tiver arquivos ou o arquivo-marca `.pasta` (criado aqui). */
export async function mkdir(p) {
  const partes = caminho(p).split('/');
  for (let i = 1; i <= partes.length; i += 1) {
    const marca = `${partes.slice(0, i).join('/')}/${MARCA}`;
    if (!arquivos.has(marca)) await writeFile(marca, '');
  }
}
export async function access(p) { await readFile(p); }
export async function stat(p) { await readFile(p); return { mtimeMs: Date.now() }; }

export default { readFile, writeFile, rm, rename, readdir, mkdir, access, stat };
