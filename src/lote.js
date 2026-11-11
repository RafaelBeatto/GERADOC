// GERADOC — geração em lote (v1.2): vários documentos do mesmo modelo, um por linha de planilha.
// O pedido cria um "trabalho" que roda em segundo plano; a tela acompanha o progresso e, no fim,
// baixa um .zip com todos os documentos. Os trabalhos ficam só na memória e somem depois de um tempo.
import { randomUUID } from 'node:crypto';
import { FORMATOS, nomeArquivo, nomeDocumento } from './gerador.js';
import { montarZip, nomeSemRepetir } from './zip.js';

export const LOTE_MAX = 300; // documentos por lote
const VALIDADE_MS = 20 * 60 * 1000;
const TRABALHOS_MAX = 5;

export class ErroLote extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * @param {{ gerador: { gerar: Function }, historico: { registrarVarios: Function } }} dependencias
 */
export function criarLotes({ gerador, historico }) {
  const trabalhos = new Map();

  function limparAntigos() {
    const agora = Date.now();
    for (const [id, t] of trabalhos) {
      if (t.estado !== 'gerando' && agora - t.terminadoEm > VALIDADE_MS) trabalhos.delete(id);
    }
    // Sem espaço: descarta os terminados mais antigos.
    const terminados = [...trabalhos.values()].filter((t) => t.estado !== 'gerando').sort((a, b) => a.terminadoEm - b.terminadoEm);
    while (trabalhos.size >= TRABALHOS_MAX && terminados.length) trabalhos.delete(terminados.shift().id);
  }

  async function executar(trabalho, modelo, linhas) {
    const { extensao } = FORMATOS[trabalho.formato];
    const arquivos = [];
    const registros = [];
    const usados = new Set();
    for (const [indice, respostas] of linhas.entries()) {
      if (trabalho.cancelado) break;
      try {
        const { arquivo, campos } = await gerador.gerar(modelo, respostas, trabalho.formato);
        // Sem nome definido no modelo, o arquivo leva a primeira resposta da linha ("Recibo - Ana Souza.pdf").
        const primeira = campos.filter((c) => !c.automatico).map((c) => String(respostas[c.chave] ?? '').trim()).find(Boolean);
        const nome = nomeSemRepetir(nomeDocumento(modelo, respostas, campos, extensao, { sufixo: primeira ?? String(indice + 1) }), usados);
        arquivos.push({ nome, conteudo: arquivo });
        registros.push({ modelo, formato: trabalho.formato, respostas, campos });
      } catch (erro) {
        if (!erro.status || erro.status >= 500) console.error(`[GERADOC] Lote: falha na linha ${indice + 1}:`, erro);
        trabalho.falhas.push({ linha: indice + 1, erro: erro.status ? erro.message : 'Erro interno ao gerar este documento.' });
      }
      trabalho.feitos = indice + 1;
    }
    trabalho.gerados = arquivos.length;
    if (trabalho.cancelado) {
      trabalho.estado = 'cancelado';
    } else if (!arquivos.length) {
      trabalho.estado = 'erro';
    } else {
      trabalho.zip = montarZip(arquivos);
      trabalho.estado = 'pronto';
      try {
        await historico.registrarVarios(registros);
      } catch (erro) {
        console.warn(`[GERADOC] Lote gerado, mas não foi possível registrar no histórico: ${erro.message}`);
      }
    }
    trabalho.terminadoEm = Date.now();
  }

  const resumo = ({ id, estado, total, feitos, gerados, falhas, formato, nome }) => ({ id, estado, total, feitos, gerados, falhas, formato, nome });

  function exigir(id) {
    const trabalho = trabalhos.get(String(id));
    if (!trabalho) throw new ErroLote(404, 'Este lote não existe mais. Gere de novo.');
    return trabalho;
  }

  return {
    /**
     * @param {{ id: string, nome: string }} modelo  @param {Record<string,string>[]} linhas  @param {'pdf'|'docx'} formato
     */
    iniciar(modelo, linhas, formato) {
      limparAntigos();
      if ([...trabalhos.values()].some((t) => t.estado === 'gerando')) {
        throw new ErroLote(409, 'Já existe um lote sendo gerado. Espere terminar (ou cancele) para começar outro.');
      }
      const trabalho = {
        id: randomUUID(),
        estado: 'gerando',
        total: linhas.length,
        feitos: 0,
        gerados: 0,
        falhas: [],
        formato,
        nome: nomeArquivo(`${modelo.nome} - lote`, 'zip'),
        zip: null,
        cancelado: false,
        terminadoEm: 0,
      };
      trabalhos.set(trabalho.id, trabalho);
      trabalho.fim = executar(trabalho, modelo, linhas).catch((erro) => {
        console.error('[GERADOC] Lote interrompido:', erro);
        trabalho.estado = 'erro';
        trabalho.terminadoEm = Date.now();
      });
      return resumo(trabalho);
    },

    status(id) {
      return resumo(exigir(id));
    },

    /** @returns {{ conteudo: Buffer, nome: string }} */
    arquivo(id) {
      const trabalho = exigir(id);
      if (trabalho.estado !== 'pronto') throw new ErroLote(409, 'Este lote ainda não está pronto.');
      return { conteudo: trabalho.zip, nome: trabalho.nome };
    },

    cancelar(id) {
      const trabalho = exigir(id);
      if (trabalho.estado === 'gerando') trabalho.cancelado = true;
      else trabalhos.delete(trabalho.id);
      return resumo(trabalho);
    },

    /** Espera os lotes em andamento terminarem (testes e encerramento). */
    async esperar() {
      await Promise.all([...trabalhos.values()].map((t) => t.fim));
    },
  };
}
