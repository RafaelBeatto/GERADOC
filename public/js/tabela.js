// GERADOC — leitura de planilhas para a geração em lote (v1.2).
// Aceita o que vem do Excel: células copiadas e coladas (separadas por TAB) ou arquivo .csv
// (separado por ponto e vírgula ou vírgula, com aspas). Funções puras: rodam no navegador e nos testes.
import { analisarCampo, normalizarCampo, verdadeiro } from './campos.js';

export const LINHAS_MAX = 300;

function contarFora(linha, separador) {
  let total = 0;
  let aspas = false;
  for (const c of linha) {
    if (c === '"') aspas = !aspas;
    else if (c === separador && !aspas) total += 1;
  }
  return total;
}

/** TAB (colado do Excel) tem prioridade; senão, o que aparecer mais na primeira linha entre ";" e ",". */
export function detectarSeparador(texto) {
  const primeira = String(texto).split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (primeira.includes('\t')) return '\t';
  return contarFora(primeira, ';') >= contarFora(primeira, ',') ? ';' : ',';
}

/**
 * Texto → { cabecalho: string[], linhas: string[][] }. Linhas totalmente vazias são ignoradas.
 * Entende aspas ("a;b", "linha 1\nlinha 2", "ele disse ""oi""").
 */
export function lerTabela(texto) {
  const origem = String(texto ?? '').replace(/^﻿/, '');
  const separador = detectarSeparador(origem);
  const tabela = [];
  let linha = [];
  let celula = '';
  let aspas = false;
  const fecharCelula = () => { linha.push(celula.trim()); celula = ''; };
  const fecharLinha = () => {
    fecharCelula();
    if (linha.some((c) => c !== '')) tabela.push(linha);
    linha = [];
  };
  for (let i = 0; i < origem.length; i += 1) {
    const c = origem[i];
    if (aspas) {
      if (c === '"' && origem[i + 1] === '"') { celula += '"'; i += 1; }
      else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"' && celula.trim() === '') { aspas = true; celula = ''; }
    else if (c === separador) fecharCelula();
    else if (c === '\n') fecharLinha();
    else if (c !== '\r') celula += c;
  }
  if (celula !== '' || linha.length) fecharLinha();
  const [cabecalho = [], ...linhas] = tabela;
  return { cabecalho, linhas };
}

/** "[Nome]", "nome", "VALOR:moeda" → chave do campo ("NOME", "VALOR"). */
export function chaveDaColuna(titulo) {
  const limpo = String(titulo ?? '').trim().replace(/^\[(.*)\]$/, '$1');
  return analisarCampo(limpo).chave || normalizarCampo(limpo);
}

/**
 * Liga as colunas da planilha às perguntas do modelo.
 * @param {{ cabecalho: string[], linhas: string[][] }} tabela
 * @param {{ chave: string, tipo: string, automatico: boolean, opcoes: string[]|null }[]} campos
 * @returns {{ respostas: Record<string,string>[], ignoradas: string[], faltando: string[] }}
 *   ignoradas = colunas que não são campo do modelo; faltando = perguntas sem coluna.
 */
export function linhasParaRespostas(tabela, campos) {
  const perguntas = new Map(campos.filter((c) => !c.automatico).map((c) => [c.chave, c]));
  const colunas = tabela.cabecalho.map(chaveDaColuna);
  const usadas = new Set();
  const ignoradas = [];
  colunas.forEach((chave, i) => {
    if (perguntas.has(chave) && !usadas.has(chave)) usadas.add(chave);
    else {
      if (tabela.cabecalho[i]) ignoradas.push(tabela.cabecalho[i]);
      colunas[i] = null;
    }
  });
  const respostas = tabela.linhas.map((linha) => {
    const r = {};
    colunas.forEach((chave, i) => {
      if (!chave) return;
      const campo = perguntas.get(chave);
      let valor = String(linha[i] ?? '').trim();
      if (campo.tipo === 'sim-nao') valor = verdadeiro(valor) ? 'sim' : 'não';
      else if (campo.tipo === 'opcoes' && campo.opcoes) {
        // "CASADO" na planilha vale como a opção "casado" do modelo.
        valor = campo.opcoes.find((o) => o.toLocaleLowerCase('pt-BR') === valor.toLocaleLowerCase('pt-BR')) ?? valor;
      }
      r[chave] = valor;
    });
    return r;
  });
  return { respostas, ignoradas, faltando: [...perguntas.keys()].filter((c) => !usadas.has(c)) };
}

function celulaCsv(valor) {
  const texto = String(valor ?? '');
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Planilha-modelo (.csv que o Excel abre direto): uma coluna por pergunta e, se houver, linhas de exemplo. */
export function gerarCsv(campos, linhas = []) {
  const perguntas = campos.filter((c) => !c.automatico);
  const texto = [perguntas.map((c) => celulaCsv(c.chave)).join(';'),
    ...linhas.map((r) => perguntas.map((c) => celulaCsv(r[c.chave])).join(';'))].join('\r\n');
  return `﻿${texto}\r\n`; // o BOM faz o Excel ler os acentos corretamente
}

/** Bytes de um arquivo .csv → texto (UTF-8; se não for, o padrão antigo do Excel no Windows). */
export function decodificarArquivo(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
