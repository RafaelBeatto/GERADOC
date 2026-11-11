// GERADOC — configuração de página de cada modelo (v1.1).
// Compartilhado entre o navegador (editor e pré-visualização) e o servidor (validação, PDF e Word).
// Modelos antigos (sem "config") usam o padrão, que é exatamente o formato da v1.0: A4, 2,5 cm, Segoe UI 12.

/** Tamanhos de papel em centímetros (largura × altura em retrato). */
export const PAPEIS = {
  A4: { rotulo: 'A4 (21 × 29,7 cm)', largura: 21, altura: 29.7 },
  Carta: { rotulo: 'Carta (21,6 × 27,9 cm)', largura: 21.59, altura: 27.94 },
  'Ofício': { rotulo: 'Ofício (21,6 × 33 cm)', largura: 21.6, altura: 33 },
  A5: { rotulo: 'A5 (14,8 × 21 cm)', largura: 14.8, altura: 21 },
};

/** Fontes que já vêm no Windows (o PDF e o Word usam a fonte instalada no computador). */
export const FONTES = ['Segoe UI', 'Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'];

export const NUMERACAO = {
  nenhuma: 'Sem numeração',
  centro: 'Rodapé, no centro',
  direita: 'Rodapé, à direita',
};

export const MARGEM_MIN = 0.5;
export const MARGEM_MAX = 8;
export const TAMANHO_MIN = 8;
export const TAMANHO_MAX = 20;
export const AREA_UTIL_MIN = 4; // cm de texto que precisam sobrar entre as margens
export const CABECALHO_MAX = 1024 * 1024;

export const CONFIG_PADRAO = Object.freeze({
  papel: 'A4',
  orientacao: 'retrato',
  margens: Object.freeze({ superior: 2.5, inferior: 2.5, esquerda: 2.5, direita: 2.5 }),
  fonte: 'Segoe UI',
  tamanhoFonte: 12,
  cabecalho: '',
  rodape: '',
  numeracao: 'nenhuma',
});

export class ErroConfig extends Error {}

function numero(valor, padrao) {
  if (valor === undefined || valor === null || valor === '') return padrao;
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(',', '.'));
  return n;
}

/**
 * Confere e completa a configuração. Lança ErroConfig com mensagem clara se algo estiver fora do lugar.
 * @returns {typeof CONFIG_PADRAO}
 */
export function validarConfig(config) {
  if (config === undefined || config === null) config = {};
  if (typeof config !== 'object' || Array.isArray(config)) throw new ErroConfig('Configuração de página inválida.');
  const c = CONFIG_PADRAO;

  const papel = config.papel ?? c.papel;
  if (!Object.hasOwn(PAPEIS, papel)) throw new ErroConfig('Tamanho de papel inválido.');
  const orientacao = config.orientacao ?? c.orientacao;
  if (!['retrato', 'paisagem'].includes(orientacao)) throw new ErroConfig('Orientação inválida.');

  const margensEntrada = config.margens ?? {};
  if (typeof margensEntrada !== 'object') throw new ErroConfig('Margens inválidas.');
  const margens = {};
  for (const lado of ['superior', 'inferior', 'esquerda', 'direita']) {
    const n = numero(margensEntrada[lado], c.margens[lado]);
    if (!Number.isFinite(n) || n < MARGEM_MIN || n > MARGEM_MAX) {
      throw new ErroConfig(`A margem ${lado} deve ficar entre ${String(MARGEM_MIN).replace('.', ',')} e ${MARGEM_MAX} cm.`);
    }
    margens[lado] = Math.round(n * 100) / 100;
  }
  const { largura, altura } = tamanhoPagina({ papel, orientacao });
  if (largura - margens.esquerda - margens.direita < AREA_UTIL_MIN || altura - margens.superior - margens.inferior < AREA_UTIL_MIN) {
    throw new ErroConfig('As margens estão grandes demais para este papel.');
  }

  const fonte = config.fonte ?? c.fonte;
  if (!FONTES.includes(fonte)) throw new ErroConfig('Fonte inválida.');
  const tamanhoFonte = numero(config.tamanhoFonte, c.tamanhoFonte);
  if (!Number.isFinite(tamanhoFonte) || tamanhoFonte < TAMANHO_MIN || tamanhoFonte > TAMANHO_MAX) {
    throw new ErroConfig(`O tamanho da letra deve ficar entre ${TAMANHO_MIN} e ${TAMANHO_MAX}.`);
  }

  const cabecalho = config.cabecalho ?? '';
  const rodape = config.rodape ?? '';
  if (typeof cabecalho !== 'string' || typeof rodape !== 'string') throw new ErroConfig('Cabeçalho ou rodapé inválido.');
  if (cabecalho.length > CABECALHO_MAX || rodape.length > CABECALHO_MAX) throw new ErroConfig('Cabeçalho ou rodapé grande demais (imagem muito pesada?).');

  const numeracao = config.numeracao ?? c.numeracao;
  if (!Object.hasOwn(NUMERACAO, numeracao)) throw new ErroConfig('Numeração de páginas inválida.');

  return { papel, orientacao, margens, fonte, tamanhoFonte: Math.round(tamanhoFonte * 2) / 2, cabecalho, rodape, numeracao };
}

/** Configuração completa sem lançar erro (para exibir modelos antigos ou com algo estranho). */
export function configOuPadrao(config) {
  try {
    return validarConfig(config);
  } catch {
    return validarConfig({});
  }
}

/** Largura e altura (cm) já considerando a orientação. */
export function tamanhoPagina({ papel, orientacao }) {
  const p = PAPEIS[papel] ?? PAPEIS.A4;
  return orientacao === 'paisagem' ? { largura: p.altura, altura: p.largura } : { largura: p.largura, altura: p.altura };
}

/** "A4 · retrato · margens de 2,5 cm" */
export function descreverPagina(config) {
  const c = configOuPadrao(config);
  const m = c.margens;
  const iguais = m.superior === m.inferior && m.inferior === m.esquerda && m.esquerda === m.direita;
  const cm = (n) => `${String(n).replace('.', ',')} cm`;
  const margens = iguais ? `margens de ${cm(m.superior)}` : 'margens personalizadas';
  return `${c.papel} · ${c.orientacao} · ${margens}`;
}

/** Texto vazio no editor (Quill gera "<p><br></p>"). */
export function htmlVazio(html) {
  const semTags = String(html ?? '').replace(/<img\b/gi, 'IMG').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return semTags === '';
}
