// GERADOC — aplicação Express (rotas da API + arquivos do site).
// Separada do servidor.js para poder ser testada sem abrir porta fixa nem navegador.
import { execFile } from 'node:child_process';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarRepositorio, ErroModelo } from './modelos.js';
import { criarGerador, ErroGeracao, FORMATOS, nomeArquivo } from './gerador.js';
import { criarHistorico, ErroHistorico } from './historico.js';
import { criarBackupExterno, criarConfiguracoes, ErroConfiguracao, sugerirPastas } from './backup-externo.js';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RESPOSTA_MAX = 2000;
export const IMPORTACAO_LIMITE = '200mb';

/** Nomes aceitos no cabeçalho Host (proteção contra "DNS rebinding"). */
const HOSTS_LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Aceita só { "CAMPO": "texto" }; qualquer outra coisa é recusada. */
function validarRespostas(respostas) {
  if (!respostas || typeof respostas !== 'object' || Array.isArray(respostas)) {
    throw new ErroGeracao(400, 'Respostas inválidas.');
  }
  const limpas = {};
  for (const [chave, valor] of Object.entries(respostas)) {
    if (typeof valor !== 'string') throw new ErroGeracao(400, 'Respostas inválidas.');
    if (valor.length > RESPOSTA_MAX) {
      throw new ErroGeracao(400, `A resposta de ${chave} passa de ${RESPOSTA_MAX} caracteres.`);
    }
    limpas[chave] = valor;
  }
  return limpas;
}

/** Só aceita pedidos feitos para este computador e (se vierem de uma página) de uma página do próprio GERADOC. */
export function protegerLocal(req, res, next) {
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
  if (!HOSTS_LOCAIS.has(host)) return res.status(403).json({ erro: 'Acesso permitido só por http://localhost.' });
  const origem = req.headers.origin;
  if (origem && origem !== 'null') {
    let nome = '';
    try { nome = new URL(origem).hostname.toLowerCase(); } catch { /* origem malformada */ }
    if (!HOSTS_LOCAIS.has(nome)) return res.status(403).json({ erro: 'Pedido recusado: veio de outro site.' });
  } else if (origem === 'null' && req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(403).json({ erro: 'Pedido recusado: origem desconhecida.' });
  }
  next();
}

function nomeExportacao(prefixo) {
  return nomeArquivo(prefixo, 'json');
}

function enviarArquivo(res, { conteudo, nome, tipo }) {
  res.set({
    'Content-Type': tipo,
    'Content-Length': conteudo.length,
    'Content-Disposition': `attachment; filename="arquivo.${nome.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    'Cache-Control': 'no-store',
  });
  res.send(conteudo);
}

/** Cria o atalho na Área de Trabalho (Windows) com scripts/criar-atalho.ps1. */
function criarAtalhoPadrao(destino) {
  return new Promise((resolver, rejeitar) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(RAIZ, 'scripts', 'criar-atalho.ps1')];
    if (destino) args.push('-Destino', destino);
    execFile('powershell.exe', args, { windowsHide: true, timeout: 20000 }, (erro, saida, erros) => {
      if (erro) return rejeitar(new Error(String(erros || erro.message).trim()));
      resolver(String(saida).trim());
    });
  });
}

/**
 * @param {{ pastaDados?: string, versao?: string, caminhoNavegador?: string|null,
 *           aoEncerrar?: () => void, criarAtalho?: (destino?: string) => Promise<string>,
 *           esperaBackup?: number }} opcoes
 */
export function criarApp({
  pastaDados = path.join(RAIZ, 'dados'), versao = '1.1.0', caminhoNavegador, aoEncerrar = null,
  criarAtalho = criarAtalhoPadrao, esperaBackup,
} = {}) {
  const configuracoes = criarConfiguracoes({ pastaDados, aoAlterar: () => backup.agendar() });
  const backup = criarBackupExterno({ pastaDados, configuracoes, espera: esperaBackup });
  const modelos = criarRepositorio({
    pastaModelos: path.join(pastaDados, 'modelos'),
    pastaLixeira: path.join(pastaDados, 'lixeira'),
    pastaBackup: path.join(pastaDados, 'backup'),
    aoAlterar: () => backup.agendar(),
  });
  const historico = criarHistorico({ arquivo: path.join(pastaDados, 'historico.json'), aoAlterar: () => backup.agendar() });
  const gerador = criarGerador({ raiz: RAIZ, caminhoNavegador });

  const app = express();
  app.disable('x-powered-by');
  app.locals.pdf = gerador; // permite fechar o navegador ao encerrar (servidor/testes)
  app.locals.gerador = gerador;
  app.locals.backup = backup;
  app.use(protegerLocal);

  const json = express.json({ limit: '10mb' });
  const jsonGrande = express.json({ limit: IMPORTACAO_LIMITE });
  // Pequeno utilitário: encaminha erros de funções async para o tratador central.
  const rota = (fn) => (req, res, next) => fn(req, res).catch(next);

  app.get('/api/saude', (_req, res) => {
    res.json({ ok: true, app: 'GERADOC', versao, podeEncerrar: Boolean(aoEncerrar) });
  });

  // ---------- Modelos ----------
  app.get('/api/modelos', rota(async (_req, res) => {
    res.json(await modelos.listar());
  }));

  app.get('/api/modelos/:id', rota(async (req, res) => {
    res.json(await modelos.obter(req.params.id));
  }));

  app.post('/api/modelos', json, rota(async (req, res) => {
    res.status(201).json(await modelos.criar(req.body));
  }));

  app.put('/api/modelos/:id', json, rota(async (req, res) => {
    res.json(await modelos.atualizar(req.params.id, req.body));
  }));

  app.delete('/api/modelos/:id', rota(async (req, res) => {
    res.json(await modelos.excluir(req.params.id));
  }));

  app.post('/api/modelos/:id/duplicar', rota(async (req, res) => {
    res.status(201).json(await modelos.duplicar(req.params.id));
  }));

  // Versões anteriores (cópias automáticas a cada vez que o modelo é salvo).
  app.get('/api/modelos/:id/versoes', rota(async (req, res) => {
    res.json(await modelos.listarVersoes(req.params.id));
  }));

  app.get('/api/modelos/:id/versoes/:versao', rota(async (req, res) => {
    res.json(await modelos.obterVersao(req.params.id, req.params.versao));
  }));

  app.post('/api/modelos/:id/versoes/:versao/restaurar', rota(async (req, res) => {
    res.json(await modelos.restaurarVersao(req.params.id, req.params.versao));
  }));

  // Exportar / importar
  app.get('/api/modelos/:id/exportar', rota(async (req, res) => {
    const dados = await modelos.exportar([req.params.id]);
    enviarArquivo(res, {
      conteudo: Buffer.from(JSON.stringify(dados, null, 2), 'utf8'),
      nome: nomeExportacao(`GERADOC - ${dados.modelos[0].nome}`),
      tipo: 'application/json; charset=utf-8',
    });
  }));

  app.get('/api/exportar', rota(async (_req, res) => {
    const dados = await modelos.exportar();
    enviarArquivo(res, {
      conteudo: Buffer.from(JSON.stringify(dados, null, 2), 'utf8'),
      nome: nomeExportacao('GERADOC - modelos'),
      tipo: 'application/json; charset=utf-8',
    });
  }));

  app.post('/api/importar', jsonGrande, rota(async (req, res) => {
    res.json(await modelos.importar(req.body));
  }));

  // Arquivos que não puderam ser lidos (a tela avisa o usuário).
  app.get('/api/diagnostico', rota(async (_req, res) => {
    res.json(await modelos.diagnostico());
  }));

  // ---------- Lixeira ----------
  app.get('/api/lixeira', rota(async (_req, res) => {
    res.json(await modelos.listarLixeira());
  }));

  app.post('/api/lixeira/:id/restaurar', rota(async (req, res) => {
    res.json(await modelos.restaurar(req.params.id));
  }));

  app.delete('/api/lixeira/:id', rota(async (req, res) => {
    res.json(await modelos.excluirDefinitivo(req.params.id));
  }));

  // ---------- Gerar documento ----------
  // Recebe só o id do modelo e as respostas; o documento é montado aqui.
  async function gerarDocumento(req, res, formatoPadrao) {
    const { modeloId, respostas } = req.body ?? {};
    const formato = req.body?.formato ?? formatoPadrao;
    if (!FORMATOS[formato]) throw new ErroGeracao(400, 'Formato de documento inválido.');
    const modelo = await modelos.obter(modeloId);
    if (!String(modelo.conteudo ?? '').trim()) throw new ErroGeracao(400, 'Este modelo está vazio.');
    const limpas = validarRespostas(respostas);
    const { arquivo, campos } = await gerador.gerar(modelo, limpas, formato);
    try {
      await historico.registrar({ modelo, formato, respostas: limpas, campos });
    } catch (erro) {
      console.warn(`[GERADOC] Documento gerado, mas não foi possível registrar no histórico: ${erro.message}`);
    }
    enviarArquivo(res, { conteudo: arquivo, nome: nomeArquivo(modelo.nome, FORMATOS[formato].extensao), tipo: FORMATOS[formato].tipo });
  }

  app.post('/api/documento', json, rota((req, res) => gerarDocumento(req, res, 'pdf')));
  app.post('/api/pdf', json, rota((req, res) => gerarDocumento(req, res, 'pdf'))); // compatível com a v1.0

  // ---------- Histórico ----------
  app.get('/api/historico', rota(async (req, res) => {
    const modeloId = typeof req.query.modeloId === 'string' ? req.query.modeloId : undefined;
    res.json(await historico.listar({ modeloId }));
  }));

  app.get('/api/historico/:id', rota(async (req, res) => {
    res.json(await historico.obter(req.params.id));
  }));

  app.delete('/api/historico/:id', rota(async (req, res) => {
    res.json(await historico.excluir(req.params.id));
  }));

  app.delete('/api/historico', rota(async (_req, res) => {
    res.json(await historico.limpar());
  }));

  app.get('/api/sugestoes', rota(async (_req, res) => {
    res.json(await historico.sugestoes());
  }));

  // ---------- Configurações ----------
  async function estadoConfiguracoes() {
    return {
      backupExterno: await backup.status(),
      sugestoesPasta: sugerirPastas(),
      pastaDados,
    };
  }

  app.get('/api/configuracoes', rota(async (_req, res) => {
    res.json(await estadoConfiguracoes());
  }));

  app.put('/api/configuracoes/backup', json, rota(async (req, res) => {
    const pasta = await backup.validarPasta(req.body?.pasta);
    await configuracoes.salvar({ backupExterno: { pasta: pasta ?? '' } });
    if (pasta) await backup.executar();
    res.json(await estadoConfiguracoes());
  }));

  app.post('/api/backup-externo', rota(async (_req, res) => {
    const estado = await backup.status();
    if (!estado.pasta) throw new ErroConfiguracao(400, 'Escolha antes uma pasta para o backup externo.');
    await backup.executar();
    res.json(await estadoConfiguracoes());
  }));

  app.post('/api/atalho', rota(async (_req, res) => {
    if (process.platform !== 'win32') throw new ErroConfiguracao(400, 'O atalho só pode ser criado no Windows.');
    try {
      res.json({ arquivo: await criarAtalho() });
    } catch (erro) {
      console.error('[GERADOC] Falha ao criar o atalho:', erro.message);
      throw new ErroConfiguracao(500, 'Não foi possível criar o atalho. Use o arquivo CriarAtalho.bat na pasta do GERADOC.');
    }
  }));

  app.post('/api/encerrar', (_req, res) => {
    if (!aoEncerrar) return res.status(400).json({ erro: 'Encerramento indisponível.' });
    res.json({ ok: true });
    setTimeout(aoEncerrar, 200);
  });

  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // Editor de texto (Quill) servido localmente — funciona sem internet.
  app.use('/vendor/quill', express.static(path.join(RAIZ, 'node_modules', 'quill', 'dist')));
  app.use(express.static(path.join(RAIZ, 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((erro, _req, res, _next) => {
    if (erro instanceof ErroModelo || erro instanceof ErroGeracao || erro instanceof ErroHistorico || erro instanceof ErroConfiguracao) {
      return res.status(erro.status).json({ erro: erro.message });
    }
    if (erro.type === 'entity.too.large') return res.status(413).json({ erro: 'O arquivo ou modelo é grande demais.' });
    if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados inválidos (o arquivo não é JSON válido).' });
    console.error('[GERADOC] Erro inesperado:', erro);
    res.status(500).json({ erro: 'Erro interno. Veja a janela do GERADOC para detalhes.' });
  });

  return app;
}
