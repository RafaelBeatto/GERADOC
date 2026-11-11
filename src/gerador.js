// GERADOC — geração dos documentos (PDF e Word).
// Usa o Edge (ou Chrome) já instalado no Windows, sem janela, via puppeteer-core.
//
// Segurança dos dados: o servidor NÃO confia em HTML vindo do navegador. Ele recebe só
// { modeloId, respostas }, lê o modelo do disco, confere se todas as perguntas foram
// respondidas (e se as respostas são válidas para o tipo) e monta o documento final com as MESMAS
// regras da pré-visualização (public/js/campos.js), executadas dentro do navegador sem janela.
// PDF: impressão do próprio navegador.  Word: estrutura lida no navegador (src/navegador/estrutura.js) → src/docx.js.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { montarDocx } from './docx.js';
import { configOuPadrao, htmlVazio, tamanhoPagina } from '../public/js/pagina.js';
import { completarRespostas, mapaDeTipos, preencherTexto } from '../public/js/campos.js';

// O navegador sem janela é fechado depois de um tempo sem uso, para não ocupar memória.
const OCIOSO_MS = 5 * 60 * 1000;
export const PX_POR_CM = 96 / 2.54;
export const DISTANCIA_CABECALHO_CM = 1; // do cabeçalho até a borda de cima (e do rodapé até a de baixo)
export const FOLGA_CM = 0.3; // entre o cabeçalho/rodapé e o texto
export const ENTRELINHA = 1.6;

export const FORMATOS = {
  pdf: { extensao: 'pdf', tipo: 'application/pdf' },
  docx: { extensao: 'docx', tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
};

export class ErroGeracao extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/** Procura o Edge (preferido) ou o Chrome nos locais padrão do Windows. */
export function localizarNavegador(env = process.env, existe = existsSync) {
  if (env.GERADOC_NAVEGADOR) return existe(env.GERADOC_NAVEGADOR) ? env.GERADOC_NAVEGADOR : null;
  const bases = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const relativos = [
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ];
  for (const rel of relativos) {
    for (const base of bases) {
      const caminho = path.join(base, ...rel);
      if (existe(caminho)) return caminho;
    }
  }
  return null;
}

/** Nome do arquivo baixado: nome do modelo + data, sem caracteres proibidos no Windows. */
export function nomeArquivo(nomeModelo, extensao = 'pdf', data = new Date()) {
  const base = String(nomeModelo ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100) || 'documento';
  const dia = [data.getFullYear(), String(data.getMonth() + 1).padStart(2, '0'), String(data.getDate()).padStart(2, '0')].join('-');
  return `${base} - ${dia}.${extensao}`;
}

export const nomeArquivoPdf = (nome, data) => nomeArquivo(nome, 'pdf', data);

/** Tira o que o Windows não aceita em nomes de arquivo ("/" de datas vira "-"). */
export function limparNomeArquivo(texto) {
  return String(texto ?? '')
    .replace(/\//g, '-')
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 150);
}

/**
 * Nome do documento gerado. Se o modelo define um nome com campos ("Contrato - [NOME]"), usa as respostas;
 * senão, "<modelo> - <data>". "sufixo" (usado no lote) entra quando o modelo não define o nome.
 * @param {{ nome: string, config?: object }} modelo  @param {object[]} campos lista devolvida por gerar()
 */
export function nomeDocumento(modelo, respostas, campos, extensao, { data = new Date(), sufixo = '' } = {}) {
  const padrao = configOuPadrao(modelo.config).nomeArquivo;
  if (padrao) {
    const opcionais = campos.filter((c) => c.opcional).map((c) => c.chave);
    const texto = preencherTexto(padrao, completarRespostas(respostas, data, campos), mapaDeTipos(campos), opcionais);
    const base = limparNomeArquivo(texto.replace(/\[[^\]]*\]/g, ' '));
    if (base) return `${base}.${extensao}`;
  }
  const base = limparNomeArquivo(sufixo).slice(0, 60).trim();
  if (!base) return nomeArquivo(modelo.nome, extensao, data);
  return `${limparNomeArquivo(modelo.nome).slice(0, 100).trim() || 'documento'} - ${base}.${extensao}`;
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export const cm = (n) => `${Math.round(n * 1000) / 1000}cm`;
const fonteCss = (fonte) => `"${fonte}", "Segoe UI", system-ui, sans-serif`;

/** Estilo de texto comum ao corpo, cabeçalho e rodapé (igual à pré-visualização). */
export function estiloTexto(config) {
  return `font-family: ${fonteCss(config.fonte)}; font-size: ${config.tamanhoFonte}pt; line-height: ${ENTRELINHA}; color: #1b1b1f;`;
}

export const CSS_COMUM = `
  .ql-editor { padding: 0; height: auto; overflow: visible; }
  .ql-editor h1, .ql-editor h2, .ql-editor h3 { break-after: avoid; }
  .ql-editor p, .ql-editor li { orphans: 3; widows: 3; }
  .ql-editor img { max-width: 100%; }
  .ql-editor hr.quebra-pagina { break-after: page; border: 0; height: 0; margin: 0; }
`;

export function paginaBase({ titulo, cssQuill, config, larguraConteudo }) {
  // O conteúdo dos modelos é o HTML interno do Quill (classes ql-*), então usamos o CSS do Quill
  // e a mesma tipografia da pré-visualização. O fundo/padding do editor são removidos.
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title>
<style>${cssQuill}</style>
<style>
  html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${CSS_COMUM}
  .ql-editor { width: ${cm(larguraConteudo)}; ${estiloTexto(config)} }
  #medidas { position: absolute; left: -100000px; top: 0; }
</style></head>
<body>
<div class="ql-container ql-snow" style="border:0"><div id="documento" class="ql-editor"></div></div>
<div id="medidas" class="ql-container ql-snow" style="border:0">
  <div id="cabecalho" class="ql-editor"></div>
  <div id="rodape" class="ql-editor"></div>
</div>
</body></html>`;
}

/**
 * Modelo do cabeçalho/rodapé do Chrome. Ele é desenhado dentro da margem, numa caixa da largura da página;
 * por isso o recuo lateral é a própria margem. pageNumber/totalPages são preenchidos pelo Chrome.
 */
function modeloCabecalhoRodape({ cssQuill, config, html, numeracao, espacoTopo }) {
  const m = config.margens;
  const alinhamento = numeracao === 'centro' ? 'center' : 'right';
  const numero = numeracao && numeracao !== 'nenhuma'
    ? `<div style="text-align:${alinhamento}; font-size:${Math.max(8, config.tamanhoFonte - 2)}pt; color:#6b7280; line-height:${ENTRELINHA};">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>`
    : '';
  return `<style>${cssQuill}
  html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${CSS_COMUM}
  .geradoc-hf { box-sizing: border-box; width: 100%; padding: ${cm(espacoTopo)} ${cm(m.direita)} 0 ${cm(m.esquerda)}; ${estiloTexto(config)} }
</style>
<div class="geradoc-hf"><div class="ql-editor">${html}</div>${numero}</div>`;
}

/**
 * Cria o gerador. O navegador é aberto na primeira geração e reaproveitado nas seguintes.
 * @param {{ raiz: string, caminhoNavegador?: string|null }} opcoes
 */
export function criarGerador({ raiz, caminhoNavegador } = {}) {
  const cssQuill = readFileSync(path.join(raiz, 'node_modules', 'quill', 'dist', 'quill.core.css'), 'utf8');
  const dataUrl = (arquivo) => `data:text/javascript;base64,${Buffer.from(readFileSync(arquivo, 'utf8')).toString('base64')}`;
  const urlCampos = dataUrl(path.join(raiz, 'public', 'js', 'campos.js'));
  const urlEstrutura = dataUrl(path.join(raiz, 'src', 'navegador', 'estrutura.js'));

  let abrindo = null; // Promise<Browser>
  let temporizadorOcioso = null;
  let emUso = 0;

  function agendarFechamento() {
    clearTimeout(temporizadorOcioso);
    temporizadorOcioso = setTimeout(() => { if (!emUso) fechar(); }, OCIOSO_MS);
    temporizadorOcioso.unref();
  }

  async function fechar() {
    clearTimeout(temporizadorOcioso);
    const atual = abrindo && (await abrindo.catch(() => null));
    abrindo = null;
    await atual?.close().catch(() => {});
  }

  async function navegador() {
    if (abrindo) {
      const atual = await abrindo.catch(() => null);
      if (atual?.connected) return atual;
    }
    const executavel = caminhoNavegador === undefined ? localizarNavegador() : caminhoNavegador;
    if (!executavel) {
      throw new ErroGeracao(500, 'Não encontrei o Microsoft Edge nem o Google Chrome neste computador. Instale um deles para gerar documentos.');
    }
    abrindo = puppeteer.launch({
      executablePath: executavel,
      headless: true,
      // Via pipe: se o GERADOC for encerrado à força, o navegador sem janela fecha junto.
      pipe: true,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions'],
    });
    try {
      return await abrindo;
    } catch (erro) {
      abrindo = null;
      console.error('[GERADOC] Falha ao abrir o navegador para gerar o documento:', erro);
      throw new ErroGeracao(500, 'Não foi possível abrir o navegador para gerar o documento. Veja a janela do GERADOC.');
    }
  }

  /** Abre a página isolada, confere as respostas e preenche o documento. */
  async function preparar(pagina, modelo, respostas, formato, agora) {
    const config = configOuPadrao(modelo.config);
    const { largura } = tamanhoPagina(config);
    const larguraConteudo = largura - config.margens.esquerda - config.margens.direita;

    // Página isolada: sem internet, sem scripts do modelo (só os módulos data: do próprio GERADOC).
    await pagina.setRequestInterception(true);
    pagina.on('request', (req) => (req.url().startsWith('data:') ? req.continue() : req.abort()));
    await pagina.setContent(paginaBase({ titulo: modelo.nome, cssQuill, config, larguraConteudo }), { waitUntil: 'load' });

    const partes = {
      conteudo: modelo.conteudo,
      cabecalho: htmlVazio(config.cabecalho) ? '' : config.cabecalho,
      rodape: htmlVazio(config.rodape) ? '' : config.rodape,
    };
    const resultado = await pagina.evaluate(async (urlCampos, urlEstrutura, partes, resp, agora, formato) => {
      const campos = await import(urlCampos);
      const htmls = [partes.cabecalho, partes.conteudo, partes.rodape];
      const lista = campos.camposDoHtml(...htmls);
      const respostas = campos.completarRespostas(resp, new Date(agora), lista);
      // Campos de trechos escondidos por [SE …] não precisam de resposta.
      const ativos = campos.camposAtivosDoHtml(htmls, respostas);
      const pendentes = campos.camposPendentes(lista, respostas, ativos);
      if (pendentes.length) return { pendentes };
      const invalidos = campos.camposInvalidos(lista, respostas, ativos);
      if (invalidos.length) return { invalidos };

      const problemas = [];
      const alvos = { conteudo: 'documento', cabecalho: 'cabecalho', rodape: 'rodape' };
      for (const [parte, id] of Object.entries(alvos)) {
        const el = document.getElementById(id);
        el.innerHTML = partes[parte] ? campos.preencherHtml(partes[parte], respostas, { campos: lista, problemas }) : '';
        // Por garantia, nada executável sobra no documento.
        el.querySelectorAll('script,iframe,object,embed').forEach((x) => x.remove());
      }
      if (problemas.length) return { contas: [...new Set(problemas)] };
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));

      const cab = document.getElementById('cabecalho');
      const rod = document.getElementById('rodape');
      const saida = { campos: lista.map(({ chave, automatico, tipo, opcional }) => ({ chave, automatico, tipo, opcional })) };
      if (formato === 'docx') {
        const { estruturaDocx } = await import(urlEstrutura);
        saida.estruturas = {
          corpo: estruturaDocx(document.getElementById('documento')),
          cabecalho: partes.cabecalho ? estruturaDocx(cab) : null,
          rodape: partes.rodape ? estruturaDocx(rod) : null,
        };
      } else {
        saida.cabecalho = { html: cab.innerHTML, altura: partes.cabecalho ? cab.offsetHeight : 0 };
        saida.rodape = { html: rod.innerHTML, altura: partes.rodape ? rod.offsetHeight : 0 };
      }
      document.getElementById('medidas').remove();
      return saida;
    }, urlCampos, urlEstrutura, partes, respostas, agora, formato);

    if (resultado.pendentes) {
      const p = resultado.pendentes;
      throw new ErroGeracao(400, p.length === 1 ? `Falta responder: ${p[0]}.` : `Faltam ${p.length} respostas: ${p.join(', ')}.`);
    }
    if (resultado.invalidos) {
      throw new ErroGeracao(400, `Resposta inválida: ${resultado.invalidos.map((i) => `${i.chave} (${i.mensagem})`).join(', ')}.`);
    }
    if (resultado.contas) {
      throw new ErroGeracao(400, `Não foi possível fazer a conta ${resultado.contas.join(', ')}. Confira os números e datas usados nela.`);
    }
    return { ...resultado, config };
  }

  async function pdf(pagina, { config, cabecalho, rodape }) {
    const { largura, altura } = tamanhoPagina(config);
    const m = { ...config.margens };
    const temNumero = config.numeracao !== 'nenhuma';
    const alturaNumero = temNumero ? (Math.max(8, config.tamanhoFonte - 2) * ENTRELINHA) / 72 * 2.54 : 0;
    const altCab = cabecalho.altura / PX_POR_CM;
    const altRod = rodape.altura / PX_POR_CM + alturaNumero;
    // A margem cresce se o cabeçalho/rodapé não couber nela.
    if (altCab) m.superior = Math.max(m.superior, DISTANCIA_CABECALHO_CM + altCab + FOLGA_CM);
    if (altRod) m.inferior = Math.max(m.inferior, DISTANCIA_CABECALHO_CM + altRod + FOLGA_CM);
    const usaCabecalhoRodape = Boolean(altCab || altRod);

    await pagina.addStyleTag({ content: `@page { size: ${cm(largura)} ${cm(altura)}; margin: ${cm(m.superior)} ${cm(m.direita)} ${cm(m.inferior)} ${cm(m.esquerda)}; }` });
    const vazio = '<span></span>';
    const arquivo = await pagina.pdf({
      width: cm(largura),
      height: cm(altura),
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: cm(m.superior), right: cm(m.direita), bottom: cm(m.inferior), left: cm(m.esquerda) },
      displayHeaderFooter: usaCabecalhoRodape,
      headerTemplate: altCab
        ? modeloCabecalhoRodape({ cssQuill, config, html: cabecalho.html, espacoTopo: DISTANCIA_CABECALHO_CM })
        : vazio,
      footerTemplate: altRod
        ? modeloCabecalhoRodape({
          cssQuill, config, html: rodape.html, numeracao: config.numeracao,
          // O rodapé é desenhado do topo da margem de baixo: empurra para terminar a 1 cm da borda.
          espacoTopo: Math.max(FOLGA_CM, m.inferior - DISTANCIA_CABECALHO_CM - altRod),
        })
        : vazio,
    });
    return Buffer.from(arquivo);
  }

  return {
    /**
     * @param {{ nome: string, conteudo: string, config?: object }} modelo
     * @param {Record<string,string>} respostas
     * @param {'pdf'|'docx'} [formato]
     * @returns {Promise<{ arquivo: Buffer, campos: {chave: string, automatico: boolean, tipo: string, opcional: boolean}[] }>}
     */
    async gerar(modelo, respostas, formato = 'pdf', agora = Date.now()) {
      if (!FORMATOS[formato]) throw new ErroGeracao(400, 'Formato de documento inválido.');
      emUso += 1;
      clearTimeout(temporizadorOcioso);
      let pagina = null;
      try {
        pagina = await (await navegador()).newPage();
        const preparado = await preparar(pagina, modelo, respostas, formato, agora);
        const arquivo = formato === 'docx'
          ? await montarDocx(preparado.estruturas, preparado.config, { titulo: modelo.nome })
          : await pdf(pagina, preparado);
        return { arquivo, campos: preparado.campos };
      } finally {
        await pagina?.close().catch(() => {});
        emUso -= 1;
        if (abrindo) agendarFechamento();
      }
    },

    fechar,
  };
}
