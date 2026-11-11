// GERADOC — monta o arquivo Word (.docx) a partir da estrutura lida no navegador (src/navegador/estrutura.js).
// Mesma configuração de página do PDF: papel, orientação, margens, fonte, cabeçalho, rodapé e numeração.
import {
  AlignmentType, Document, ExternalHyperlink, Footer, Header, ImageRun, LevelFormat, Packer,
  PageNumber, PageOrientation, Paragraph, ShadingType, TextRun,
} from 'docx';
import { tamanhoPagina } from '../public/js/pagina.js';

const TWIP_POR_CM = 567;
const TWIP_POR_PX = 15; // 1 px CSS = 0,75 pt = 15 twips
const ENTRELINHA = 1.6; // mesma do PDF
const DISTANCIA_CABECALHO_CM = 1;

const twip = (cm) => Math.round(cm * TWIP_POR_CM);

const ALINHAMENTOS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

// Igual ao Quill: decimal → letra → romano; marcadores • ◦ ▪.
const FORMATOS_ORDENADOS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
const MARCADORES = ['•', '◦', '▪'];

function niveis(tipo, tamanhoBasePt) {
  // Quill: item com 1,5 em de recuo + 3 em por nível.
  const em = tamanhoBasePt * 20;
  return Array.from({ length: 9 }, (_, nivel) => ({
    level: nivel,
    format: tipo === 'ordered' ? FORMATOS_ORDENADOS[nivel % 3] : LevelFormat.BULLET,
    text: tipo === 'ordered' ? `%${nivel + 1}.` : MARCADORES[nivel % 3],
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: Math.round(em * (1.5 + 3 * nivel) + em * 0.5), hanging: Math.round(em * 1.5) } } },
  }));
}

function corrida(t) {
  if (t.quebra) return new TextRun({ break: 1 });
  if (t.imagem) {
    const base64 = t.imagem.slice(t.imagem.indexOf(',') + 1);
    return new ImageRun({
      type: t.tipo,
      data: Buffer.from(base64, 'base64'),
      transformation: { width: t.largura, height: t.altura },
    });
  }
  const opcoes = {
    text: t.texto,
    bold: t.negrito || undefined,
    italics: t.italico || undefined,
    underline: t.sublinhado ? {} : undefined,
    strike: t.riscado || undefined,
    color: t.cor ?? undefined,
    size: t.tamanhoPt ? Math.round(t.tamanhoPt * 2) : undefined,
    shading: t.fundo ? { type: ShadingType.CLEAR, color: 'auto', fill: t.fundo } : undefined,
  };
  if (t.link) {
    return new ExternalHyperlink({ link: t.link, children: [new TextRun({ ...opcoes, style: 'Hyperlink' })] });
  }
  return new TextRun(opcoes);
}

function paragrafos(estrutura, { tamanhoBasePt }) {
  return estrutura.blocos.map((b) => {
    const opcoes = {
      alignment: ALINHAMENTOS[b.alinhamento] ?? AlignmentType.LEFT,
      pageBreakBefore: b.quebraAntes || undefined,
      children: b.trechos.map(corrida),
    };
    if (b.titulo) opcoes.outlineLevel = b.titulo - 1; // aparece no painel de navegação do Word
    if (b.lista) {
      opcoes.numbering = {
        reference: b.lista.tipo === 'ordered' ? 'lista-numerada' : 'lista-marcadores',
        level: Math.min(8, b.lista.nivel),
        instance: b.lista.grupo, // cada lista recomeça do 1, como no editor
      };
    } else if (b.recuoPx) {
      opcoes.indent = { left: Math.round(b.recuoPx * TWIP_POR_PX) };
    }
    // Parágrafo vazio: mantém a altura da linha com o tamanho certo.
    if (!b.trechos.length) opcoes.children = [new TextRun({ text: '', size: Math.round((b.tamanhoPt || tamanhoBasePt) * 2) })];
    return new Paragraph(opcoes);
  });
}

function paragrafoNumeracao(numeracao, tamanhoBasePt) {
  return new Paragraph({
    alignment: numeracao === 'centro' ? AlignmentType.CENTER : AlignmentType.RIGHT,
    children: [new TextRun({
      children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES],
      size: Math.round(Math.max(8, tamanhoBasePt - 2) * 2),
      color: '6B7280',
    })],
  });
}

/**
 * @param {{ corpo: object, cabecalho: object|null, rodape: object|null }} estruturas
 * @param {object} config configuração completa do modelo (pagina.js)
 * @param {{ titulo?: string }} [info]
 * @returns {Promise<Buffer>}
 */
export async function montarDocx(estruturas, config, { titulo = '' } = {}) {
  const tamanhoBasePt = config.tamanhoFonte;
  const { largura, altura } = tamanhoPagina({ papel: config.papel, orientacao: 'retrato' });
  const m = config.margens;
  const opcoes = { tamanhoBasePt };

  const cabecalho = estruturas.cabecalho?.blocos.length ? paragrafos(estruturas.cabecalho, opcoes) : [];
  const rodape = estruturas.rodape?.blocos.length ? paragrafos(estruturas.rodape, opcoes) : [];
  if (config.numeracao !== 'nenhuma') rodape.push(paragrafoNumeracao(config.numeracao, tamanhoBasePt));

  const doc = new Document({
    title: titulo,
    creator: 'GERADOC',
    styles: {
      default: {
        document: {
          run: { font: config.fonte, size: Math.round(tamanhoBasePt * 2), color: '1B1B1F' },
          paragraph: { spacing: { line: Math.round(240 * ENTRELINHA), before: 0, after: 0 } },
        },
      },
    },
    numbering: {
      config: [
        { reference: 'lista-numerada', levels: niveis('ordered', tamanhoBasePt) },
        { reference: 'lista-marcadores', levels: niveis('bullet', tamanhoBasePt) },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: twip(largura),
            height: twip(altura),
            orientation: config.orientacao === 'paisagem' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: twip(m.superior),
            bottom: twip(m.inferior),
            left: twip(m.esquerda),
            right: twip(m.direita),
            header: twip(Math.min(DISTANCIA_CABECALHO_CM, m.superior)),
            footer: twip(Math.min(DISTANCIA_CABECALHO_CM, m.inferior)),
          },
        },
      },
      headers: cabecalho.length ? { default: new Header({ children: cabecalho }) } : undefined,
      footers: rodape.length ? { default: new Footer({ children: rodape }) } : undefined,
      children: paragrafos(estruturas.corpo, opcoes),
    }],
  });
  return Packer.toBuffer(doc);
}
