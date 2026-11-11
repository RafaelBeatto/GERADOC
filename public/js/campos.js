// GERADOC — campos [X] dos modelos.
// Regras (aprovadas em 2026-11-10):
//  - não diferencia maiúsculas: [Nome], [NOME] e [nome] são o mesmo campo, exibido em MAIÚSCULAS;
//  - espaços nas pontas são ignorados ([ NOME ] = [NOME]); espaços repetidos no meio contam como um;
//  - acentos diferenciam ([ENDEREÇO] ≠ [ENDERECO]);
//  - campos com o mesmo nome geram UMA pergunta, e a resposta substitui todas as ocorrências.
//
// As funções "puras" (sem DOM) rodam no navegador e no Node (testes / servidor).
// As funções "*Html" usam o DOM e só rodam no navegador.

export const CAMPO_MAX = 80;

// Um campo é qualquer texto entre [ e ] sem outros colchetes nem quebra de linha.
const REGEX_CAMPO = /\[([^[\]\n]+)\]/g;

export function normalizarCampo(nome) {
  return String(nome ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
}

function campoValido(chave) {
  return chave.length > 0 && chave.length <= CAMPO_MAX;
}

/**
 * Localiza os campos num bloco de texto que pode estar quebrado em pedaços
 * (no editor, "[NO<b>ME</b>]" vira os pedaços "[NO" e "ME]").
 * Retorna, para cada ocorrência, a chave normalizada e os trechos de cada pedaço que ela ocupa.
 */
export function localizarCampos(pedacos) {
  const texto = pedacos.join('');
  const inicios = [];
  let soma = 0;
  for (const p of pedacos) { inicios.push(soma); soma += p.length; }

  const ocorrencias = [];
  for (const m of texto.matchAll(REGEX_CAMPO)) {
    const chave = normalizarCampo(m[1]);
    if (!campoValido(chave)) continue;
    const de = m.index;
    const ate = m.index + m[0].length;
    const partes = [];
    pedacos.forEach((p, i) => {
      const a = Math.max(de, inicios[i]);
      const b = Math.min(ate, inicios[i] + p.length);
      if (a < b) partes.push({ i, de: a - inicios[i], ate: b - inicios[i] });
    });
    ocorrencias.push({ chave, original: m[0], partes });
  }
  return ocorrencias;
}

/** Lista de campos únicos, na ordem da primeira aparição, com o número de ocorrências. */
export function extrairCampos(blocos) {
  const mapa = new Map();
  for (const pedacos of blocos) {
    for (const { chave } of localizarCampos(Array.isArray(pedacos) ? pedacos : [pedacos])) {
      const item = mapa.get(chave);
      if (item) item.ocorrencias += 1;
      else mapa.set(chave, { chave, ocorrencias: 1 });
    }
  }
  return [...mapa.values()];
}

/** Substitui os campos num texto simples. Campos sem resposta ficam como estão. */
export function preencherTexto(texto, respostas) {
  return String(texto).replace(REGEX_CAMPO, (inteiro, nome) => {
    const chave = normalizarCampo(nome);
    const valor = respostas[chave];
    return campoValido(chave) && typeof valor === 'string' && valor.trim() ? valor : inteiro;
  });
}

/** Campos ainda sem resposta (resposta vazia ou só com espaços não vale — Etapa 1, Q11). */
export function camposPendentes(campos, respostas) {
  return campos.filter(({ chave }) => !String(respostas[chave] ?? '').trim()).map(({ chave }) => chave);
}

// ---------------- DOM (somente navegador) ----------------

const SELETOR_BLOCO = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,div';

/** Agrupa os nós de texto por bloco (parágrafo, título, item de lista…), na ordem do documento. */
function blocosDeTexto(raiz) {
  const blocos = new Map();
  const percurso = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let no = percurso.nextNode(); no; no = percurso.nextNode()) {
    const bloco = no.parentElement?.closest(SELETOR_BLOCO) ?? raiz;
    if (!blocos.has(bloco)) blocos.set(bloco, []);
    blocos.get(bloco).push(no);
  }
  return [...blocos.values()];
}

const PERIGOSOS = 'script,iframe,frame,object,embed,link,meta,base,form,input,button,textarea,select';

/**
 * Tira do modelo tudo que poderia executar código (modelo editado à mão no JSON, por exemplo).
 * O editor nunca gera nada disso; é só garantia para a pré-visualização e o PDF.
 */
function limpar(raiz) {
  raiz.querySelectorAll(PERIGOSOS).forEach((el) => el.remove());
  for (const el of raiz.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const nome = name.toLowerCase();
      const url = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (nome.startsWith('on') || (/^(href|src|xlink:href|action|formaction|srcset)$/.test(nome) && /^(javascript|vbscript):/.test(url))) {
        el.removeAttribute(name);
      }
    }
  }
  // O Quill desenha o número/marcador da lista num <span class="ql-ui"> dentro de cada item.
  // Se faltar (HTML editado à mão), recoloca para a lista não sair sem números no PDF.
  for (const li of raiz.querySelectorAll('li')) {
    if (li.firstElementChild?.classList.contains('ql-ui')) continue;
    const ui = li.ownerDocument.createElement('span');
    ui.className = 'ql-ui';
    ui.setAttribute('contenteditable', 'false');
    li.prepend(ui);
  }
  return raiz;
}

function fragmentoDe(html) {
  const modelo = document.createElement('template'); // conteúdo inerte: nada carrega nem executa aqui
  modelo.innerHTML = html ?? '';
  return limpar(modelo.content);
}

export function camposDoHtml(html) {
  return extrairCampos(blocosDeTexto(fragmentoDe(html)).map((nos) => nos.map((n) => n.data)));
}

/**
 * Devolve o HTML com os campos substituídos pelas respostas.
 * A resposta herda a formatação do início do campo (ex.: [NOME] em negrito → resposta em negrito).
 * Com { marcar: true }, envolve cada campo num <mark> para a pré-visualização.
 */
export function preencherHtml(html, respostas, { marcar = false } = {}) {
  const raiz = fragmentoDe(html);
  for (const nos of blocosDeTexto(raiz)) {
    const ocorrencias = localizarCampos(nos.map((n) => n.data));
    // De trás para frente: assim as posições das ocorrências anteriores continuam válidas.
    for (const { chave, original, partes } of ocorrencias.reverse()) {
      const valor = String(respostas[chave] ?? '');
      const respondido = valor.trim() !== '';
      const texto = respondido ? valor : original;
      if (!respondido && !marcar) continue;

      for (const { i, de, ate } of partes.slice(1).reverse()) {
        nos[i].data = nos[i].data.slice(0, de) + nos[i].data.slice(ate);
      }
      const { i, de, ate } = partes[0];
      const meio = nos[i].splitText(de);
      meio.splitText(ate - de);
      let novo = document.createTextNode(texto);
      if (marcar) {
        const mark = document.createElement('mark');
        mark.className = respondido ? 'campo campo--ok' : 'campo campo--vazio';
        mark.dataset.campo = chave;
        mark.append(novo);
        novo = mark;
      }
      meio.replaceWith(novo);
    }
  }
  const saida = document.createElement('div');
  saida.append(raiz);
  return saida.innerHTML;
}
