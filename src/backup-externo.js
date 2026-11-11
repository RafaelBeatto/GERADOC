// GERADOC — configurações e backup externo (v1.1).
// O backup externo copia a pasta dados/ para uma pasta escolhida pelo usuário (OneDrive, Google Drive,
// pendrive…), dentro de uma subpasta "GERADOC-backup". É uma cópia acumulativa: nada é apagado lá,
// mesmo que seja apagado aqui. Roda ao iniciar, alguns segundos depois de cada alteração e sob demanda.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { gravarAtomico } from './modelos.js';

export const SUBPASTA_BACKUP = 'GERADOC-backup';
const ESPERA_MS = 5000;
// O que é copiado de dados/ (temporários .tmp ficam de fora).
const ITENS = ['modelos', 'lixeira', 'backup', 'historico.json', 'configuracoes.json'];

export class ErroConfiguracao extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/** a está dentro de b (ou é b)? Comparação sem diferenciar maiúsculas (Windows). */
function dentroDe(a, b) {
  const rel = path.relative(path.resolve(b).toLowerCase(), path.resolve(a).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Pastas sugeridas: OneDrive e Google Drive, se existirem neste computador. */
export function sugerirPastas(env = process.env, existe = existsSync) {
  const sugestoes = [];
  const vistos = new Set();
  const adicionar = (rotulo, pasta) => {
    if (!pasta || vistos.has(pasta.toLowerCase()) || !existe(pasta)) return;
    vistos.add(pasta.toLowerCase());
    sugestoes.push({ rotulo, pasta });
  };
  adicionar('OneDrive', env.OneDrive);
  adicionar('OneDrive', env.OneDriveConsumer);
  adicionar('OneDrive (empresa)', env.OneDriveCommercial);
  for (const letra of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
    adicionar('Google Drive', `${letra}:\\Meu Drive`);
    adicionar('Google Drive', `${letra}:\\My Drive`);
  }
  return sugestoes;
}

export function criarConfiguracoes({ pastaDados, aoAlterar = () => {} }) {
  const arquivo = path.join(pastaDados, 'configuracoes.json');
  let cache = null;

  async function ler() {
    if (cache) return cache;
    try {
      const dados = JSON.parse(await fs.readFile(arquivo, 'utf8'));
      cache = dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : {};
    } catch {
      cache = {};
    }
    return cache;
  }

  return {
    ler,
    async salvar(parcial) {
      const atual = await ler();
      const novo = { ...atual, ...parcial };
      await fs.mkdir(pastaDados, { recursive: true });
      await gravarAtomico(arquivo, novo);
      cache = novo;
      aoAlterar();
      return novo;
    },
  };
}

export function criarBackupExterno({ pastaDados, configuracoes, espera = ESPERA_MS }) {
  const estado = { emAndamento: false, ultimoEm: null, ultimoErro: null, pasta: null };
  let temporizador = null;
  let rodando = null;
  let pendente = false;

  async function pastaConfigurada() {
    const pasta = (await configuracoes.ler()).backupExterno?.pasta;
    return typeof pasta === 'string' && pasta.trim() ? pasta.trim() : null;
  }

  /** Confere se a pasta serve para backup: caminho completo, fora de dados/, gravável. */
  async function validarPasta(pasta) {
    const texto = String(pasta ?? '').trim();
    if (!texto) return null;
    if (!path.isAbsolute(texto) || !/^([a-z]:\\|\\\\)/i.test(path.resolve(texto))) {
      throw new ErroConfiguracao(400, 'Informe o caminho completo da pasta, por exemplo C:\\Users\\Você\\OneDrive.');
    }
    const destino = path.resolve(texto);
    if (dentroDe(destino, pastaDados) || dentroDe(path.join(destino, SUBPASTA_BACKUP), pastaDados)) {
      throw new ErroConfiguracao(400, 'A pasta de backup não pode ficar dentro da pasta de dados do GERADOC.');
    }
    if (dentroDe(pastaDados, path.join(destino, SUBPASTA_BACKUP))) {
      throw new ErroConfiguracao(400, 'Escolha outra pasta: a pasta de dados do GERADOC fica dentro dela.');
    }
    try {
      const stat = await fs.stat(destino);
      if (!stat.isDirectory()) throw new ErroConfiguracao(400, 'O caminho informado é um arquivo, não uma pasta.');
    } catch (erro) {
      if (erro instanceof ErroConfiguracao) throw erro;
      throw new ErroConfiguracao(400, 'Pasta não encontrada. Confira o caminho (o pendrive está conectado?).');
    }
    try {
      const teste = path.join(destino, SUBPASTA_BACKUP, `.teste-${process.pid}.tmp`);
      await fs.mkdir(path.dirname(teste), { recursive: true });
      await fs.writeFile(teste, 'ok');
      await fs.rm(teste, { force: true });
    } catch {
      throw new ErroConfiguracao(400, 'Não foi possível gravar nesta pasta. Escolha outra.');
    }
    return destino;
  }

  async function copiar() {
    const pasta = await pastaConfigurada();
    estado.pasta = pasta;
    if (!pasta) return estado;
    estado.emAndamento = true;
    try {
      const destino = path.join(pasta, SUBPASTA_BACKUP);
      await fs.mkdir(destino, { recursive: true });
      for (const item of ITENS) {
        const origem = path.join(pastaDados, item);
        if (!existsSync(origem)) continue;
        await fs.cp(origem, path.join(destino, item), {
          recursive: true,
          force: true,
          filter: (arquivo) => !arquivo.endsWith('.tmp'),
        });
      }
      const agora = new Date();
      await fs.writeFile(path.join(destino, 'LEIA-ME.txt'), [
        'Cópia de segurança dos modelos do GERADOC.',
        `Última cópia: ${agora.toLocaleString('pt-BR')}`,
        '',
        'Para recuperar: com o GERADOC fechado, copie as pastas "modelos", "lixeira" e "backup"',
        '(e o arquivo historico.json) daqui para a pasta "dados" do GERADOC.',
        'Nada é apagado desta pasta automaticamente: modelos excluídos no GERADOC continuam aqui.',
        '',
      ].join('\r\n'), 'utf8');
      estado.ultimoEm = agora.toISOString();
      estado.ultimoErro = null;
    } catch (erro) {
      estado.ultimoErro = `Não foi possível copiar para ${pasta}: ${erro.code === 'ENOENT' ? 'pasta não encontrada (o pendrive está conectado?)' : erro.message}`;
      console.warn(`[GERADOC] Backup externo falhou: ${erro.message}`);
    } finally {
      estado.emAndamento = false;
    }
    return estado;
  }

  /** Roda a cópia; se pedirem outra durante a cópia, roda mais uma vez no fim. */
  async function executar() {
    if (rodando) {
      pendente = true;
      return rodando;
    }
    rodando = (async () => {
      do {
        pendente = false;
        await copiar();
      } while (pendente);
    })();
    try {
      await rodando;
    } finally {
      rodando = null;
    }
    return { ...estado };
  }

  return {
    validarPasta,
    executar,
    /** Agenda uma cópia alguns segundos depois (várias alterações seguidas = uma cópia só). */
    agendar() {
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        temporizador = null;
        executar().catch(() => {});
      }, espera);
      temporizador.unref?.();
    },
    async status() {
      return { ...estado, pasta: await pastaConfigurada() };
    },
    /** Ao encerrar: faz a cópia que estava agendada (se houver) e espera a que estiver em andamento. */
    async parar() {
      if (temporizador) {
        clearTimeout(temporizador);
        temporizador = null;
        await executar();
      }
      await rodando;
    },
    /** Só para testes: descarta a cópia agendada. */
    cancelar() {
      clearTimeout(temporizador);
      temporizador = null;
    },
  };
}
