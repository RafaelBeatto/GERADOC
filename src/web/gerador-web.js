// GERADOC (modo web) — gera o documento dentro do próprio navegador (sem servidor, sem Edge/Chrome externo).
//  • Word (.docx): lê o documento renderizado e monta o arquivo com a biblioteca docx.
//  • PDF: abre a janela de impressão do navegador ("Salvar como PDF"), com papel, margens, cabeçalho,
//    rodapé e numeração do modelo.
import { configOuPadrao, htmlVazio, tamanhoPagina } from '../../public/js/pagina.js';
import {
  camposAtivosDoHtml, camposDoHtml, camposInvalidos, camposPendentes, completarRespostas, preencherHtml,
} from '../../public/js/campos.js';
import { estruturaDocx } from '../navegador/estrutura.js';
import { montarDocx } from '../docx.js';
import {
  ErroGeracao, FORMATOS, cm, paginaBase,
} from '../gerador.js';

let cssQuill = null;
async function carregarCssQuill() {
  cssQuill ??= await (await fetch('vendor/quill/quill.core.css')).text();
  return cssQuill;
}

function criarQuadro(html) {
  const quadro = document.createElement('iframe');
  quadro.setAttribute('aria-hidden', 'true');
  quadro.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;height:900px;border:0;';
  document.body.append(quadro);
  quadro.contentDocument.open();
  quadro.contentDocument.write(html);
  quadro.contentDocument.close();
  return quadro;
}

/** Texto de erro igual ao do servidor para respostas faltando/inválidas. */
function conferir(lista, respostas, htmls) {
  const ativos = camposAtivosDoHtml(htmls, respostas);
  const pendentes = camposPendentes(lista, respostas, ativos);
  if (pendentes.length) {
    throw new ErroGeracao(400, pendentes.length === 1
      ? `Falta responder: ${pendentes[0]}.` : `Faltam ${pendentes.length} respostas: ${pendentes.join(', ')}.`);
  }
  const invalidos = camposInvalidos(lista, respostas, ativos);
  if (invalidos.length) {
    throw new ErroGeracao(400, `Resposta inválida: ${invalidos.map((i) => `${i.chave} (${i.mensagem})`).join(', ')}.`);
  }
}

/** CSS de impressão: página, margens e numeração "Página X de Y" (margem da página). */
function cssImpressao(config) {
  const { largura, altura } = tamanhoPagina(config);
  const m = config.margens;
  const numero = config.numeracao !== 'nenhuma'
    ? `@${config.numeracao === 'centro' ? 'bottom-center' : 'bottom-right'} { content: "Página " counter(page) " de " counter(pages); font-size: ${Math.max(8, config.tamanhoFonte - 2)}pt; color: #6b7280; font-family: "${config.fonte}", "Segoe UI", system-ui, sans-serif; vertical-align: top; padding-top: 0.2cm; }`
    : '';
  return `
    @page { size: ${cm(largura)} ${cm(altura)}; margin: ${cm(m.superior)} ${cm(m.direita)} ${cm(m.inferior)} ${cm(m.esquerda)}; ${numero} }
    #medidas { display: none; }
    table.geradoc-folha { border-collapse: collapse; border: 0; width: 100%; }
    table.geradoc-folha td { padding: 0; border: 0; vertical-align: top; }
    .geradoc-cab-bloco { padding-bottom: ${cm(0.3)}; }
    .geradoc-rod-bloco { padding-top: ${cm(0.3)}; }
  `;
}

export function criarGeradorWeb() {
  return {
    /**
     * @returns {Promise<{ arquivo: Uint8Array|null, campos: object[], impresso?: boolean }>}
     */
    async gerar(modelo, respostas, formato = 'pdf', agora = Date.now()) {
      if (!FORMATOS[formato]) throw new ErroGeracao(400, 'Formato de documento inválido.');
      const css = await carregarCssQuill();
      const config = configOuPadrao(modelo.config);
      const { largura } = tamanhoPagina(config);
      const larguraConteudo = largura - config.margens.esquerda - config.margens.direita;

      const cabecalho = htmlVazio(config.cabecalho) ? '' : config.cabecalho;
      const rodape = htmlVazio(config.rodape) ? '' : config.rodape;
      const htmls = [cabecalho, modelo.conteudo, rodape];
      const lista = camposDoHtml(...htmls);
      const completas = completarRespostas(respostas, new Date(agora), lista);
      conferir(lista, completas, htmls);

      const quadro = criarQuadro(paginaBase({ titulo: modelo.nome, cssQuill: css, config, larguraConteudo }));
      try {
        const doc = quadro.contentDocument;
        const problemas = [];
        const alvos = { documento: modelo.conteudo, cabecalho, rodape };
        for (const [id, html] of Object.entries(alvos)) {
          const el = doc.getElementById(id);
          el.innerHTML = html ? preencherHtml(html, completas, { campos: lista, problemas }) : '';
          el.querySelectorAll('script,iframe,object,embed').forEach((x) => x.remove());
        }
        if (problemas.length) {
          throw new ErroGeracao(400, `Não foi possível fazer a conta ${[...new Set(problemas)].join(', ')}. Confira os números e datas usados nela.`);
        }
        await doc.fonts.ready;
        await Promise.all([...doc.images].map((img) => img.decode().catch(() => {})));
        const campos = lista.map(({ chave, automatico, tipo, opcional }) => ({ chave, automatico, tipo, opcional }));

        if (formato === 'docx') {
          const estruturas = {
            corpo: estruturaDocx(doc.getElementById('documento')),
            cabecalho: cabecalho ? estruturaDocx(doc.getElementById('cabecalho')) : null,
            rodape: rodape ? estruturaDocx(doc.getElementById('rodape')) : null,
          };
          return { arquivo: await montarDocx(estruturas, config, { titulo: modelo.nome }), campos };
        }

        // PDF: cabeçalho e rodapé viram <thead>/<tfoot> de uma tabela (o navegador os repete em toda página).
        const estilo = doc.createElement('style');
        estilo.textContent = cssImpressao(config);
        doc.head.append(estilo);
        const corpo = doc.getElementById('documento');
        const recipiente = corpo.parentElement; // .ql-container
        const parte = (id, classe) => {
          const origem = doc.getElementById(id);
          if (!origem.innerHTML.trim()) return '';
          return `<div class="${classe} ql-container ql-snow" style="border:0"><div class="ql-editor" style="width:${cm(larguraConteudo)}">${origem.innerHTML}</div></div>`;
        };
        const cab = parte('cabecalho', 'geradoc-cab-bloco');
        const rod = parte('rodape', 'geradoc-rod-bloco');
        if (cab || rod) {
          const tabela = doc.createElement('table');
          tabela.className = 'geradoc-folha';
          tabela.innerHTML = `${cab ? `<thead><tr><td>${cab}</td></tr></thead>` : ''}<tbody><tr><td></td></tr></tbody>${rod ? `<tfoot><tr><td>${rod}</td></tr></tfoot>` : ''}`;
          tabela.querySelector('tbody td').append(recipiente);
          doc.body.prepend(tabela);
        }
        doc.title = modelo.nome;
        await new Promise((r) => setTimeout(r, 50));
        const janela = quadro.contentWindow;
        const fim = new Promise((r) => { janela.addEventListener('afterprint', r, { once: true }); });
        janela.focus();
        janela.print();
        await Promise.race([fim, new Promise((r) => setTimeout(r, 120000))]);
        return { arquivo: null, campos, impresso: true };
      } finally {
        quadro.remove();
      }
    },
  };
}
