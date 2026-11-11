// GERADOC (modo web) — carregado antes do app: passa a atender `/api/...` dentro do navegador.
import './buffer.js';
import { criarServidorWeb } from './servidor-web.js';

const servidor = criarServidorWeb();
const fetchOriginal = window.fetch.bind(window);

function ehApi(url) {
  try {
    return /\/api(\/|$)/.test(new URL(url, location.href).pathname) && new URL(url, location.href).origin === location.origin;
  } catch { return false; }
}

window.fetch = (entrada, opcoes = {}) => {
  const url = typeof entrada === 'string' ? entrada : entrada.url;
  if (!ehApi(url)) return fetchOriginal(entrada, opcoes);
  return servidor.responder(url, { method: opcoes.method ?? 'GET', body: opcoes.body });
};

// Links de download diretos (ex.: "Exportar todos os modelos") também passam pelo servidor do navegador.
document.addEventListener('click', async (evento) => {
  const link = evento.target.closest?.('a[href]');
  if (!link || !ehApi(link.getAttribute('href'))) return;
  evento.preventDefault();
  const resposta = await servidor.responder(link.getAttribute('href'));
  if (!resposta.ok) return;
  const cab = resposta.headers.get('Content-Disposition') ?? '';
  const nome = decodeURIComponent((/filename\*=UTF-8''([^;]+)/.exec(cab) ?? [])[1] ?? 'arquivo');
  const url = URL.createObjectURL(await resposta.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}, true);
