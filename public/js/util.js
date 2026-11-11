// GERADOC — utilitários do frontend (API, avisos, diálogo, ícones, datas, download).

export const $ = (id) => document.getElementById(id);

/** Ícone do sprite SVG em index.html (#i-<nome>). */
export function icone(nome) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  const uso = document.createElementNS(NS, 'use');
  uso.setAttribute('href', `#i-${nome}`);
  svg.append(uso);
  return svg;
}

export async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.erro || `Erro ${resposta.status}`);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

let temporizadorAviso;
export function avisar(texto, tipo = 'ok') {
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.className = `aviso aviso--${tipo}`;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, tipo === 'erro' ? 6000 : 3500);
}

export function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

export function negrito(texto) {
  const el = document.createElement('strong');
  el.textContent = texto;
  return el;
}

export function chip(texto, classe = 'chip') {
  const el = document.createElement('span');
  el.className = classe;
  el.textContent = texto;
  return el;
}

export function botaoAcao(tag, classe, nomeIcone, texto) {
  const el = document.createElement(tag);
  el.className = `botao botao--pequeno ${classe}`;
  el.append(icone(nomeIcone), texto);
  if (tag === 'button') el.type = 'button';
  return el;
}

/** Linha de tabela com nome (ícone + texto/link), data e ações. */
export function linhaTabela({ nome, href, titulo, data, dataTitulo, acoes, excluido = false, detalhe = null }) {
  const linha = document.createElement('tr');
  const celulaNome = document.createElement('td');
  const caixa = document.createElement('div');
  caixa.className = `modelo-nome${excluido ? ' modelo-nome--excluido' : ''}`;
  const iconeNome = document.createElement('span');
  iconeNome.className = 'modelo-nome-icone';
  iconeNome.append(icone('documento'));
  const texto = document.createElement(href ? 'a' : 'span');
  if (href) texto.href = href;
  if (titulo) texto.title = titulo;
  texto.textContent = nome;
  const bloco = document.createElement('div');
  bloco.className = 'modelo-nome-texto';
  bloco.append(texto);
  if (detalhe) {
    const d = document.createElement('span');
    d.className = 'modelo-detalhe';
    d.textContent = detalhe;
    bloco.append(d);
  }
  caixa.append(iconeNome, bloco);
  celulaNome.append(caixa);

  const celulaData = document.createElement('td');
  celulaData.className = 'cartao-data';
  celulaData.textContent = data;
  if (dataTitulo) celulaData.title = dataTitulo;

  const celulaAcoes = document.createElement('td');
  const caixaAcoes = document.createElement('div');
  caixaAcoes.className = 'cartao-acoes';
  caixaAcoes.append(...acoes);
  celulaAcoes.append(caixaAcoes);
  linha.append(celulaNome, celulaData, celulaAcoes);
  return linha;
}

// ---------- Diálogo de confirmação ----------
// A resposta vem do clique no botão (submit) ou do Esc (cancel), que acontecem na hora.
// Não usamos o evento "close": ele chega atrasado e poderia responder um diálogo aberto logo em seguida.
let respostaDialogo = null;
function encerrarDialogo(ok) {
  const resolver = respostaDialogo;
  respostaDialogo = null;
  resolver?.(ok);
}
$('dialogo-confirmar').querySelector('form').addEventListener('submit', (evento) => {
  encerrarDialogo(evento.submitter?.value === 'confirmar');
});
$('dialogo-confirmar').addEventListener('cancel', () => encerrarDialogo(false));

/** @returns {Promise<boolean>} */
export function confirmar({ titulo, texto, botao, perigo = true, nomeIcone = 'lixeira' }) {
  const dialogo = $('dialogo-confirmar');
  encerrarDialogo(false); // por garantia, nenhum pedido anterior fica pendurado
  $('dialogo-titulo').textContent = titulo;
  $('dialogo-texto').replaceChildren(...texto);
  $('dialogo-botao').textContent = botao;
  $('dialogo-botao').className = `botao ${perigo ? 'botao--perigo' : 'botao--primario'}`;
  const caixaIcone = dialogo.querySelector('.dialogo-icone');
  caixaIcone.classList.toggle('dialogo-icone--neutro', !perigo);
  caixaIcone.replaceChildren(icone(nomeIcone));
  if (!dialogo.open) dialogo.showModal();
  return new Promise((resolver) => { respostaDialogo = resolver; });
}

// ---------- Download ----------
export function nomeDoCabecalho(cabecalho, padrao = 'documento') {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecalho ?? '');
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* usa o padrão */ } }
  return padrao;
}

export function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Lê um arquivo de imagem e devolve data URL reduzida (no máx. 1600 px de lado), para não pesar o modelo. */
export function lerImagem(arquivo, maximo = 1600) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader();
    leitor.onerror = () => rejeitar(new Error('Não foi possível ler a imagem.'));
    leitor.onload = () => {
      const original = String(leitor.result);
      const img = new Image();
      img.onerror = () => rejeitar(new Error('Este arquivo não é uma imagem válida.'));
      img.onload = () => {
        const maior = Math.max(img.naturalWidth, img.naturalHeight);
        const leve = arquivo.size <= 300 * 1024 && /^image\/(png|jpeg|gif)$/.test(arquivo.type);
        if (maior <= maximo && leve) return resolver(original);
        const escala = Math.min(1, maximo / maior);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * escala);
        canvas.height = Math.round(img.naturalHeight * escala);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG mantém transparência (logotipos); fotos viram JPEG, bem mais leve.
        resolver(arquivo.type === 'image/png' || arquivo.type === 'image/gif' || arquivo.type === 'image/svg+xml'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = original;
    };
    leitor.readAsDataURL(arquivo);
  });
}
