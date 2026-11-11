// GERADOC — histórico dos documentos gerados (v1.1).
// Um único arquivo dados/historico.json com as gerações mais recentes primeiro.
// Serve para: gerar de novo / gerar parecido, sugerir respostas já usadas e preencher com as últimas respostas.
// Gravação atômica e em fila (uma de cada vez). Se o arquivo estiver danificado, ele é guardado
// com outro nome (nunca apagado) e um histórico novo começa.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gravarAtomico } from './modelos.js';

export const HISTORICO_MAX = 1000;
export const SUGESTOES_POR_CAMPO = 15;

export class ErroHistorico extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

export function criarHistorico({ arquivo, aoAlterar = () => {} }) {
  let fila = Promise.resolve();
  let cache = null;

  /** Executa as operações uma de cada vez (evita duas gravações ao mesmo tempo). */
  function emFila(fn) {
    const resultado = fila.then(fn, fn);
    fila = resultado.catch(() => {});
    return resultado;
  }

  async function ler() {
    if (cache) return cache;
    try {
      const dados = JSON.parse(await fs.readFile(arquivo, 'utf8'));
      if (!Array.isArray(dados?.itens)) throw new Error('formato inesperado');
      cache = dados.itens.filter((i) => i && typeof i.id === 'string' && i.respostas && typeof i.respostas === 'object');
    } catch (erro) {
      if (erro.code !== 'ENOENT') {
        const guardado = `${arquivo}.danificado-${Date.now()}`;
        console.warn(`[GERADOC] Histórico ilegível (${erro.message}); guardado como ${path.basename(guardado)} e começando um novo.`);
        await fs.rename(arquivo, guardado).catch(() => {});
      }
      cache = [];
    }
    return cache;
  }

  async function gravar(itens) {
    await fs.mkdir(path.dirname(arquivo), { recursive: true });
    await gravarAtomico(arquivo, { versao: 1, itens });
    cache = itens;
    aoAlterar();
  }

  return {
    /** Registra uma geração. Guarda só as respostas digitadas (não os campos automáticos). */
    registrar({ modelo, formato, respostas, campos }) {
      return emFila(async () => {
        const chaves = new Set(campos.filter((c) => !c.automatico).map((c) => c.chave));
        const guardadas = Object.fromEntries(Object.entries(respostas).filter(([k, v]) => chaves.has(k) && typeof v === 'string'));
        const item = {
          id: randomUUID(),
          modeloId: modelo.id,
          modeloNome: modelo.nome,
          formato,
          respostas: guardadas,
          geradoEm: new Date().toISOString(),
        };
        const itens = [item, ...(await ler())].slice(0, HISTORICO_MAX);
        await gravar(itens);
        return item;
      });
    },

    async listar({ modeloId } = {}) {
      const itens = await emFila(ler);
      return modeloId ? itens.filter((i) => i.modeloId === modeloId) : itens;
    },

    async obter(id) {
      const item = (await emFila(ler)).find((i) => i.id === id);
      if (!item) throw new ErroHistorico(404, 'Registro do histórico não encontrado.');
      return item;
    },

    excluir(id) {
      return emFila(async () => {
        const itens = await ler();
        if (!itens.some((i) => i.id === id)) throw new ErroHistorico(404, 'Registro do histórico não encontrado.');
        await gravar(itens.filter((i) => i.id !== id));
        return { id };
      });
    },

    limpar() {
      return emFila(async () => {
        const total = (await ler()).length;
        await gravar([]);
        return { removidos: total };
      });
    },

    /** Respostas já usadas, por campo, da mais recente para a mais antiga (sem repetir). */
    async sugestoes() {
      const mapa = {};
      for (const item of await emFila(ler)) {
        for (const [chave, valor] of Object.entries(item.respostas)) {
          const texto = String(valor).trim();
          if (!texto) continue;
          const lista = (mapa[chave] ??= []);
          if (lista.length < SUGESTOES_POR_CAMPO && !lista.includes(texto)) lista.push(texto);
        }
      }
      return mapa;
    },
  };
}
