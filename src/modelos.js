// GERADOC — repositório de modelos.
// Cada modelo é um arquivo JSON em dados/modelos/<id>.json.
// Regras de segurança dos dados (Etapa 3, Q12 — modelos nunca podem ser perdidos):
//  - toda gravação é atômica (escreve em arquivo temporário e renomeia);
//  - antes de sobrescrever um modelo, a versão anterior é copiada para dados/backup/<id>/;
//  - excluir NUNCA apaga: o arquivo é movido para dados/lixeira/;
//  - excluir da lixeira tira o modelo do GERADOC, mas uma última cópia fica em dados/backup/<id>/;
//  - arquivos ilegíveis são ignorados na listagem (e informados), mas nunca removidos.
// v1.1: configuração de página (config), versões anteriores restauráveis, exportar/importar.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validarConfig, ErroConfig } from '../public/js/pagina.js';

export const NOME_MAX = 120;
export const CONTEUDO_MAX = 4 * 1024 * 1024; // 4 MB de HTML
export const BACKUPS_POR_MODELO = 20;
export const IMPORTACAO_MAX = 500; // modelos por arquivo importado
export const FORMATO_EXPORTACAO = 'geradoc-modelos';

const FORMATO_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FORMATO_VERSAO = /^\d{13}-[0-9a-f]{8}$/;
const TEMPORARIO_ORFAO_MS = 60 * 60 * 1000;

export class ErroModelo extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function normalizarNome(nome) {
  return String(nome ?? '').replace(/\s+/g, ' ').trim();
}

function chaveNome(nome) {
  return normalizarNome(nome).toLocaleLowerCase('pt-BR');
}

function validarEntrada({ nome, conteudo, config } = {}) {
  const nomeLimpo = normalizarNome(nome);
  if (!nomeLimpo) throw new ErroModelo(400, 'O nome do modelo é obrigatório.');
  if (nomeLimpo.length > NOME_MAX) {
    throw new ErroModelo(400, `O nome pode ter no máximo ${NOME_MAX} caracteres.`);
  }
  if (conteudo !== undefined && typeof conteudo !== 'string') {
    throw new ErroModelo(400, 'Conteúdo do modelo inválido.');
  }
  const conteudoFinal = conteudo ?? '';
  if (conteudoFinal.length > CONTEUDO_MAX) {
    throw new ErroModelo(413, 'O modelo é grande demais.');
  }
  let configFinal;
  try {
    configFinal = validarConfig(config);
  } catch (erro) {
    if (erro instanceof ErroConfig) throw new ErroModelo(400, erro.message);
    throw erro;
  }
  return { nome: nomeLimpo, conteudo: conteudoFinal, config: configFinal };
}

const mesmaConfig = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Próximo nome livre: "Contrato (cópia)", "Contrato (cópia 2)"… Corta o nome base se passar do limite.
 * @param {string} base  @param {string} sufixo  @param {Set<string>} ocupados chaves (minúsculas)
 */
export function proximoNomeLivre(base, sufixo, ocupados) {
  for (let n = 1; ; n += 1) {
    const final = n === 1 ? ` (${sufixo})` : ` (${sufixo} ${n})`;
    const nome = `${normalizarNome(base).slice(0, NOME_MAX - final.length).trim()}${final}`;
    if (!ocupados.has(chaveNome(nome))) return nome;
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** No Windows, antivírus/indexador às vezes seguram o arquivo por instantes: tenta de novo. */
async function renomearComRetentativa(origem, destino) {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await fs.rename(origem, destino);
    } catch (erro) {
      if (tentativa >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(erro.code)) throw erro;
      await espera(40 * tentativa);
    }
  }
}

/** Grava JSON de forma atômica (temporário + renomear). */
export async function gravarAtomico(arquivo, dados) {
  const temporario = `${arquivo}.${randomUUID()}.tmp`;
  await fs.writeFile(temporario, JSON.stringify(dados, null, 2), 'utf8');
  try {
    await renomearComRetentativa(temporario, arquivo);
  } catch (erro) {
    await fs.rm(temporario, { force: true }).catch(() => {});
    throw erro;
  }
}

/** Remove temporários de gravações interrompidas (queda de energia etc.). Os .json nunca são tocados. */
export async function limparTemporarios(pasta) {
  for (const nome of await fs.readdir(pasta)) {
    if (!nome.endsWith('.tmp')) continue;
    const arquivo = path.join(pasta, nome);
    try {
      const { mtimeMs } = await fs.stat(arquivo);
      if (Date.now() - mtimeMs > TEMPORARIO_ORFAO_MS) await fs.rm(arquivo);
    } catch { /* outro processo pode ter mexido; ignora */ }
  }
}

/**
 * @param {{ pastaModelos: string, pastaLixeira: string, pastaBackup?: string, aoAlterar?: () => void }} opcoes
 * aoAlterar é chamado depois de qualquer gravação (usado pelo backup externo).
 */
export function criarRepositorio({ pastaModelos, pastaLixeira, pastaBackup = path.join(path.dirname(pastaModelos), 'backup'), aoAlterar = () => {} }) {
  const arquivoDe = (id) => path.join(pastaModelos, `${id}.json`);
  const arquivoLixeira = (id) => path.join(pastaLixeira, `${id}.json`);
  let pastasProntas = false;

  function exigirId(id) {
    if (!FORMATO_ID.test(String(id))) throw new ErroModelo(404, 'Modelo não encontrado.');
  }

  async function garantirPastas() {
    await fs.mkdir(pastaModelos, { recursive: true });
    await fs.mkdir(pastaLixeira, { recursive: true });
    await fs.mkdir(pastaBackup, { recursive: true });
    if (!pastasProntas) {
      pastasProntas = true;
      await limparTemporarios(pastaModelos).catch(() => {});
      await limparTemporarios(pastaLixeira).catch(() => {});
    }
  }

  /** Lê um arquivo de modelo e confere se é um modelo válido cujo id bate com o nome do arquivo. */
  async function lerArquivo(arquivo) {
    const modelo = JSON.parse(await fs.readFile(arquivo, 'utf8'));
    const idEsperado = path.basename(arquivo, '.json');
    if (!modelo || modelo.id !== idEsperado || !FORMATO_ID.test(modelo.id) || typeof modelo.nome !== 'string') {
      throw new Error('não é um modelo do GERADOC válido');
    }
    if (typeof modelo.conteudo !== 'string') modelo.conteudo = '';
    try {
      modelo.config = validarConfig(modelo.config);
    } catch {
      modelo.config = validarConfig({}); // configuração estragada não impede abrir o texto
    }
    return modelo;
  }

  async function lerPasta(pasta) {
    await garantirPastas();
    const arquivos = (await fs.readdir(pasta)).filter((a) => a.endsWith('.json'));
    const itens = [];
    const ilegiveis = [];
    for (const arquivo of arquivos) {
      try {
        itens.push(await lerArquivo(path.join(pasta, arquivo)));
      } catch (erro) {
        ilegiveis.push(arquivo);
        console.warn(`[GERADOC] Ignorando arquivo ilegível: ${path.join(pasta, arquivo)} (${erro.message})`);
      }
    }
    return { itens, ilegiveis };
  }

  async function lerUm(arquivo, mensagemAusente) {
    try {
      return await lerArquivo(arquivo);
    } catch (erro) {
      if (erro.code === 'ENOENT') throw new ErroModelo(404, mensagemAusente);
      console.error(`[GERADOC] Arquivo danificado: ${arquivo} (${erro.message})`);
      throw new ErroModelo(500, `O arquivo deste modelo está danificado e não pode ser aberto (${path.basename(arquivo)}). Ele não foi apagado; versões anteriores ficam em dados/backup.`);
    }
  }

  async function nomesOcupados(idIgnorado) {
    const { itens } = await lerPasta(pastaModelos);
    return new Set(itens.filter((m) => m.id !== idIgnorado).map((m) => chaveNome(m.nome)));
  }

  async function exigirNomeLivre(nome, idIgnorado) {
    const chave = chaveNome(nome);
    const { itens } = await lerPasta(pastaModelos);
    const conflito = itens.find((m) => m.id !== idIgnorado && chaveNome(m.nome) === chave);
    if (conflito) throw new ErroModelo(409, `Já existe um modelo chamado "${conflito.nome}".`);
  }

  /** Guarda uma cópia em dados/backup/<id>/ e mantém só as mais recentes. */
  async function guardarBackup(modelo) {
    const pasta = path.join(pastaBackup, modelo.id);
    await fs.mkdir(pasta, { recursive: true });
    // Date.now() tem 13 dígitos até o ano 2286, então a ordem alfabética é a cronológica.
    await gravarAtomico(path.join(pasta, `${Date.now()}-${randomUUID().slice(0, 8)}.json`), modelo);
    try {
      const copias = (await fs.readdir(pasta)).filter((a) => a.endsWith('.json')).sort();
      for (const antiga of copias.slice(0, Math.max(0, copias.length - BACKUPS_POR_MODELO))) {
        await fs.rm(path.join(pasta, antiga), { force: true });
      }
    } catch (erro) {
      console.warn(`[GERADOC] Não foi possível limpar backups antigos de ${modelo.id}: ${erro.message}`);
    }
  }

  const resumo = ({ id, nome, criadoEm, atualizadoEm }) => ({ id, nome, criadoEm, atualizadoEm });

  return {
    async listar() {
      const { itens } = await lerPasta(pastaModelos);
      return itens
        .map(resumo)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
    },

    /** Arquivos que existem nas pastas mas não puderam ser lidos (para avisar o usuário). */
    async diagnostico() {
      const [modelos, lixeira] = await Promise.all([lerPasta(pastaModelos), lerPasta(pastaLixeira)]);
      return { modelosIlegiveis: modelos.ilegiveis, lixeiraIlegiveis: lixeira.ilegiveis };
    },

    async obter(id) {
      exigirId(id);
      return lerUm(arquivoDe(id), 'Modelo não encontrado.');
    },

    async criar(entrada) {
      const { nome, conteudo, config } = validarEntrada(entrada);
      await exigirNomeLivre(nome);
      const agora = new Date().toISOString();
      const modelo = { id: randomUUID(), nome, conteudo, config, criadoEm: agora, atualizadoEm: agora, versaoFormato: 2 };
      await gravarAtomico(arquivoDe(modelo.id), modelo);
      aoAlterar();
      return modelo;
    },

    async atualizar(id, entrada) {
      const atual = await this.obter(id);
      const { nome, conteudo, config } = validarEntrada({ conteudo: atual.conteudo, config: atual.config, ...entrada });
      await exigirNomeLivre(nome, id);
      if (nome === atual.nome && conteudo === atual.conteudo && mesmaConfig(config, atual.config)) return atual; // nada mudou
      await guardarBackup(atual);
      const modelo = { ...atual, nome, conteudo, config, atualizadoEm: new Date().toISOString(), versaoFormato: 2 };
      await gravarAtomico(arquivoDe(id), modelo);
      aoAlterar();
      return modelo;
    },

    async duplicar(id) {
      const original = await this.obter(id);
      const nome = proximoNomeLivre(original.nome, 'cópia', await nomesOcupados());
      return this.criar({ nome, conteudo: original.conteudo, config: original.config });
    },

    async excluir(id) {
      const modelo = await this.obter(id);
      await garantirPastas();
      const excluidoEm = new Date().toISOString();
      // Registra a data da exclusão na lixeira e só então retira da pasta de modelos.
      await gravarAtomico(arquivoLixeira(id), { ...modelo, excluidoEm });
      await fs.rm(arquivoDe(id));
      aoAlterar();
      return { id, nome: modelo.nome, excluidoEm };
    },

    // ---------- Lixeira ----------
    async listarLixeira() {
      const { itens } = await lerPasta(pastaLixeira);
      return itens
        .map((m) => ({ ...resumo(m), excluidoEm: m.excluidoEm ?? null }))
        .sort((a, b) => String(b.excluidoEm ?? '').localeCompare(String(a.excluidoEm ?? '')));
    },

    /** Volta o modelo para a lista. Se o nome já estiver em uso, ganha o sufixo "(restaurado)". */
    async restaurar(id) {
      exigirId(id);
      const naLixeira = await lerUm(arquivoLixeira(id), 'Modelo não encontrado na lixeira.');
      try {
        await fs.access(arquivoDe(id));
        throw new ErroModelo(409, 'Este modelo já está na lista de modelos.');
      } catch (erro) {
        if (erro instanceof ErroModelo) throw erro;
      }
      const { excluidoEm: _ignorado, ...modelo } = naLixeira;
      const ocupados = await nomesOcupados();
      const renomeado = ocupados.has(chaveNome(modelo.nome));
      if (renomeado) modelo.nome = proximoNomeLivre(modelo.nome, 'restaurado', ocupados);
      await gravarAtomico(arquivoDe(id), modelo);
      await fs.rm(arquivoLixeira(id));
      aoAlterar();
      return { ...resumo(modelo), renomeado };
    },

    /** Tira da lixeira de vez. Uma última cópia fica em dados/backup/<id>/ (nunca perder modelos). */
    async excluirDefinitivo(id) {
      exigirId(id);
      const naLixeira = await lerUm(arquivoLixeira(id), 'Modelo não encontrado na lixeira.');
      await guardarBackup(naLixeira);
      await fs.rm(arquivoLixeira(id));
      aoAlterar();
      return { id, nome: naLixeira.nome };
    },

    // ---------- Versões anteriores (cópias em dados/backup/<id>/) ----------
    async listarVersoes(id) {
      await this.obter(id);
      const pasta = path.join(pastaBackup, id);
      let arquivos = [];
      try {
        arquivos = (await fs.readdir(pasta)).filter((a) => a.endsWith('.json')).sort().reverse();
      } catch (erro) {
        if (erro.code !== 'ENOENT') throw erro;
      }
      const versoes = [];
      for (const arquivo of arquivos) {
        const versao = path.basename(arquivo, '.json');
        if (!FORMATO_VERSAO.test(versao)) continue;
        try {
          const copia = JSON.parse(await fs.readFile(path.join(pasta, arquivo), 'utf8'));
          versoes.push({
            versao,
            nome: String(copia.nome ?? ''),
            atualizadoEm: copia.atualizadoEm ?? null,
            guardadoEm: new Date(Number(versao.slice(0, 13))).toISOString(),
          });
        } catch { /* cópia ilegível: não aparece */ }
      }
      return versoes;
    },

    async obterVersao(id, versao) {
      exigirId(id);
      if (!FORMATO_VERSAO.test(String(versao))) throw new ErroModelo(404, 'Versão não encontrada.');
      let copia;
      try {
        copia = JSON.parse(await fs.readFile(path.join(pastaBackup, id, `${versao}.json`), 'utf8'));
      } catch (erro) {
        if (erro.code === 'ENOENT') throw new ErroModelo(404, 'Versão não encontrada.');
        throw new ErroModelo(500, 'Esta versão está danificada e não pode ser aberta.');
      }
      let config;
      try { config = validarConfig(copia.config); } catch { config = validarConfig({}); }
      return {
        versao,
        nome: String(copia.nome ?? ''),
        conteudo: typeof copia.conteudo === 'string' ? copia.conteudo : '',
        config,
        atualizadoEm: copia.atualizadoEm ?? null,
      };
    },

    /** Volta o modelo para uma versão anterior. A versão atual vira mais uma cópia (dá para desfazer). */
    async restaurarVersao(id, versao) {
      const atual = await this.obter(id);
      const copia = await this.obterVersao(id, versao);
      const ocupados = await nomesOcupados(id);
      const nomeMantido = !normalizarNome(copia.nome) || ocupados.has(chaveNome(copia.nome));
      const modelo = await this.atualizar(id, {
        nome: nomeMantido ? atual.nome : copia.nome,
        conteudo: copia.conteudo,
        config: copia.config,
      });
      return { modelo, nomeMantido };
    },

    // ---------- Exportar / importar ----------
    async exportar(ids = null) {
      const lista = ids ? await Promise.all(ids.map((id) => this.obter(id))) : (await lerPasta(pastaModelos)).itens;
      return {
        formato: FORMATO_EXPORTACAO,
        versao: 1,
        exportadoEm: new Date().toISOString(),
        modelos: lista
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
          .map(({ nome, conteudo, config, criadoEm, atualizadoEm }) => ({ nome, conteudo, config, criadoEm, atualizadoEm })),
      };
    },

    /**
     * Importa modelos de um arquivo exportado (ou de um único modelo).
     * Sempre cria modelos novos; nome repetido ganha "(importado)". Modelos com problema são listados, não importados.
     */
    async importar(dados) {
      let entrada;
      if (dados && typeof dados === 'object' && Array.isArray(dados.modelos)) entrada = dados.modelos;
      else if (dados && typeof dados === 'object' && typeof dados.nome === 'string') entrada = [dados];
      else throw new ErroModelo(400, 'Este arquivo não é uma exportação de modelos do GERADOC.');
      if (entrada.length === 0) throw new ErroModelo(400, 'O arquivo não tem nenhum modelo.');
      if (entrada.length > IMPORTACAO_MAX) throw new ErroModelo(400, `O arquivo tem modelos demais (máximo ${IMPORTACAO_MAX}).`);

      const ocupados = await nomesOcupados();
      const importados = [];
      const ignorados = [];
      for (const item of entrada) {
        const nomeOriginal = normalizarNome(item?.nome) || '(sem nome)';
        try {
          const limpo = validarEntrada({ nome: item?.nome, conteudo: item?.conteudo ?? '', config: item?.config });
          const renomeado = ocupados.has(chaveNome(limpo.nome));
          const nome = renomeado ? proximoNomeLivre(limpo.nome, 'importado', ocupados) : limpo.nome;
          const agora = new Date().toISOString();
          const modelo = { id: randomUUID(), nome, conteudo: limpo.conteudo, config: limpo.config, criadoEm: agora, atualizadoEm: agora, versaoFormato: 2 };
          await gravarAtomico(arquivoDe(modelo.id), modelo);
          ocupados.add(chaveNome(nome));
          importados.push({ id: modelo.id, nome, renomeado });
        } catch (erro) {
          if (!(erro instanceof ErroModelo)) throw erro;
          ignorados.push({ nome: nomeOriginal, motivo: erro.message });
        }
      }
      if (importados.length) aoAlterar();
      return { importados, ignorados };
    },
  };
}
