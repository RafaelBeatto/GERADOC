// GERADOC — roda DENTRO do navegador sem janela (Edge/Chrome), nunca no Node.
// Lê o documento já preenchido e renderizado e devolve uma estrutura simples (blocos e trechos com
// formatação) para o servidor montar o arquivo Word (.docx). Usa os estilos calculados pelo navegador,
// então negrito, cores, tamanhos e alinhamentos saem iguais aos do PDF.

const BLOCOS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'DIV']);

function hex(cor) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(cor ?? '');
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // transparente
  return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Formatação de um nó de texto, olhando os ancestrais até o bloco (sublinhado e fundo não são herdados no CSS). */
function estiloDo(elemento, bloco, corPadrao) {
  const cs = getComputedStyle(elemento);
  let sublinhado = false;
  let riscado = false;
  let fundo = null;
  let link = null;
  for (let el = elemento; el && el !== bloco.parentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    const deco = s.textDecorationLine || '';
    if (deco.includes('underline')) sublinhado = true;
    if (deco.includes('line-through')) riscado = true;
    if (!fundo && el !== bloco) fundo = hex(s.backgroundColor);
    if (!link && el.tagName === 'A' && /^(https?:|mailto:)/i.test(el.getAttribute('href') ?? '')) link = el.getAttribute('href');
    if (el === bloco) break;
  }
  const cor = hex(cs.color);
  return {
    negrito: Number(cs.fontWeight) >= 600,
    italico: cs.fontStyle === 'italic',
    sublinhado,
    riscado,
    cor: cor && cor !== corPadrao ? cor : null,
    fundo,
    tamanhoPt: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
    link,
  };
}

/** Imagem → PNG/JPEG em data URL, com o tamanho exibido na página. */
function imagem(img) {
  const rect = img.getBoundingClientRect();
  const largura = Math.max(1, Math.round(rect.width || img.naturalWidth));
  const altura = Math.max(1, Math.round(rect.height || img.naturalHeight));
  let src = img.getAttribute('src') ?? '';
  let tipo = /^data:image\/(png|jpe?g|gif|bmp);base64,/i.exec(src)?.[1]?.toLowerCase();
  if (!tipo) {
    // SVG, WebP… → converte para PNG.
    if (!img.complete || !img.naturalWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    src = canvas.toDataURL('image/png');
    tipo = 'png';
  }
  return { imagem: src, tipo: tipo === 'jpeg' ? 'jpg' : tipo, largura, altura };
}

function trechos(bloco, corPadrao) {
  const saida = [];
  const percorrer = (no) => {
    for (const filho of no.childNodes) {
      if (filho.nodeType === Node.TEXT_NODE) {
        if (filho.data) saida.push({ texto: filho.data, ...estiloDo(filho.parentElement, bloco, corPadrao) });
      } else if (filho.nodeType === Node.ELEMENT_NODE) {
        if (filho.classList.contains('ql-ui')) continue; // marcador de lista desenhado pelo Quill
        if (filho.tagName === 'BR') {
          // <br> sozinho num parágrafo vazio não vira quebra extra.
          if (filho.nextSibling || filho.previousSibling) saida.push({ quebra: true });
        } else if (filho.tagName === 'IMG') {
          const img = imagem(filho);
          if (img) saida.push(img);
        } else {
          percorrer(filho);
        }
      }
    }
  };
  percorrer(bloco);
  return saida;
}

function alinhamento(el) {
  const a = getComputedStyle(el).textAlign;
  if (a === 'center' || a === 'right' || a === 'justify') return a;
  return 'left';
}

const recuoPx = (el) => parseFloat(getComputedStyle(el).paddingLeft) || 0;

function nivelDe(el) {
  const m = /ql-indent-(\d)/.exec(el.className);
  return m ? Number(m[1]) : 0;
}

/** @param {HTMLElement} raiz  @returns {{ blocos: object[] }} */
export function estruturaDocx(raiz) {
  const corPadrao = hex(getComputedStyle(raiz).color);
  const blocos = [];
  let grupoLista = 0;
  let quebraAntes = false;

  const paragrafo = (el, extra = {}) => {
    const cs = getComputedStyle(el);
    blocos.push({
      tipo: 'paragrafo',
      titulo: /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : 0,
      alinhamento: alinhamento(el),
      recuoPx: extra.lista ? 0 : recuoPx(el),
      tamanhoPt: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
      quebraAntes,
      trechos: trechos(el, corPadrao),
      ...extra,
    });
    quebraAntes = false;
  };

  for (const el of raiz.children) {
    if (el.tagName === 'HR' && el.classList.contains('quebra-pagina')) {
      quebraAntes = blocos.length > 0;
      continue;
    }
    if (el.tagName === 'OL' || el.tagName === 'UL') {
      grupoLista += 1;
      for (const li of el.querySelectorAll(':scope > li')) {
        const ordenada = li.dataset.list ? li.dataset.list === 'ordered' : el.tagName === 'OL';
        const tipo = ordenada ? 'ordered' : 'bullet';
        paragrafo(li, { lista: { tipo, nivel: nivelDe(li), grupo: grupoLista } });
      }
      continue;
    }
    if (BLOCOS.has(el.tagName)) paragrafo(el);
  }
  return { blocos };
}
