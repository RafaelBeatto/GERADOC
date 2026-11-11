// GERADOC — geração do PDF (F3).
// Usa o Edge (ou Chrome) já instalado no Windows, sem janela, via puppeteer-core.
//
// Segurança dos dados: o servidor NÃO confia em HTML vindo do navegador. Ele recebe só
// { modeloId, respostas }, lê o modelo do disco, confere se todas as perguntas foram
// respondidas e monta o documento final com as MESMAS regras da pré-visualização
// (public/js/campos.js), executadas dentro do navegador sem janela.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

// Formato aprovado: A4 retrato, margens de 2,5 cm.
export const FORMATO_PDF = { format: 'A4', landscape: false, margem: '2.5cm' };

// O navegador sem janela é fechado depois de um tempo sem uso, para não ocupar memória.
const OCIOSO_MS = 5 * 60 * 1000;

export class ErroPdf extends Error {
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
export function nomeArquivoPdf(nomeModelo, data = new Date()) {
  const base = String(nomeModelo ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100) || 'documento';
  const dia = [data.getFullYear(), String(data.getMonth() + 1).padStart(2, '0'), String(data.getDate()).padStart(2, '0')].join('-');
  return `${base} - ${dia}.pdf`;
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function paginaBase({ titulo, cssQuill }) {
  // O conteúdo dos modelos é o HTML interno do Quill (classes ql-*), então usamos o CSS do Quill
  // e a mesma tipografia da pré-visualização. O fundo/padding do editor são removidos.
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title>
<style>${cssQuill}</style>
<style>
  @page { size: A4 portrait; margin: ${FORMATO_PDF.margem}; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .ql-editor {
    padding: 0; height: auto; overflow: visible; color: #1b1b1f;
    font-family: "Segoe UI", system-ui, sans-serif; font-size: 12pt; line-height: 1.6;
  }
  .ql-editor h1, .ql-editor h2, .ql-editor h3 { break-after: avoid; }
  .ql-editor p, .ql-editor li { orphans: 3; widows: 3; }
</style></head>
<body><div class="ql-container ql-snow" style="border:0"><div id="documento" class="ql-editor"></div></div></body></html>`;
}

/**
 * Cria o gerador. O navegador é aberto na primeira geração e reaproveitado nas seguintes.
 * @param {{ raiz: string, caminhoNavegador?: string|null }} opcoes
 */
export function criarGeradorPdf({ raiz, caminhoNavegador } = {}) {
  const cssQuill = readFileSync(path.join(raiz, 'node_modules', 'quill', 'dist', 'quill.core.css'), 'utf8');
  const codigoCampos = readFileSync(path.join(raiz, 'public', 'js', 'campos.js'), 'utf8');
  const urlCampos = `data:text/javascript;base64,${Buffer.from(codigoCampos).toString('base64')}`;

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
      throw new ErroPdf(500, 'Não encontrei o Microsoft Edge nem o Google Chrome neste computador. Instale um deles para gerar PDFs.');
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
      console.error('[GERADOC] Falha ao abrir o navegador para gerar PDF:', erro);
      throw new ErroPdf(500, 'Não foi possível abrir o navegador para gerar o PDF. Veja a janela do GERADOC.');
    }
  }

  return {
    /**
     * @param {{ nome: string, conteudo: string }} modelo
     * @param {Record<string,string>} respostas
     * @returns {Promise<Buffer>}
     */
    async gerar(modelo, respostas) {
      emUso += 1;
      clearTimeout(temporizadorOcioso);
      let pagina = null;
      try {
        pagina = await (await navegador()).newPage();
        // Página isolada: sem internet, sem scripts do modelo.
        await pagina.setRequestInterception(true);
        pagina.on('request', (req) => (req.url().startsWith('data:') ? req.continue() : req.abort()));
        await pagina.setContent(paginaBase({ titulo: modelo.nome, cssQuill }), { waitUntil: 'load' });

        const pendentes = await pagina.evaluate(async (url, html, resp) => {
          const campos = await import(url);
          const faltando = campos.camposPendentes(campos.camposDoHtml(html), resp);
          if (faltando.length) return faltando;
          const doc = document.getElementById('documento');
          doc.innerHTML = campos.preencherHtml(html, resp);
          // Por garantia, nada executável sobra no documento.
          doc.querySelectorAll('script,iframe,object,embed').forEach((el) => el.remove());
          return [];
        }, urlCampos, modelo.conteudo, respostas);

        if (pendentes.length) {
          throw new ErroPdf(400, pendentes.length === 1
            ? `Falta responder: ${pendentes[0]}.`
            : `Faltam ${pendentes.length} respostas: ${pendentes.join(', ')}.`);
        }

        await pagina.evaluate(() => document.fonts.ready);
        const pdf = await pagina.pdf({
          format: FORMATO_PDF.format,
          landscape: FORMATO_PDF.landscape,
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: FORMATO_PDF.margem, right: FORMATO_PDF.margem, bottom: FORMATO_PDF.margem, left: FORMATO_PDF.margem },
        });
        return Buffer.from(pdf);
      } finally {
        await pagina?.close().catch(() => {});
        emUso -= 1;
        if (abrindo) agendarFechamento();
      }
    },

    fechar,
  };
}
