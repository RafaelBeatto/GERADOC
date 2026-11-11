// GERADOC — aplicação Express (rotas da API + arquivos do site).
// Separada do servidor.js para poder ser testada sem abrir porta fixa nem navegador.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarRepositorio, ErroModelo } from './modelos.js';
import { criarGeradorPdf, ErroPdf, nomeArquivoPdf } from './pdf.js';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RESPOSTA_MAX = 2000;

/** Aceita só { "CAMPO": "texto" }; qualquer outra coisa é recusada. */
function validarRespostas(respostas) {
  if (!respostas || typeof respostas !== 'object' || Array.isArray(respostas)) {
    throw new ErroPdf(400, 'Respostas inválidas.');
  }
  const limpas = {};
  for (const [chave, valor] of Object.entries(respostas)) {
    if (typeof valor !== 'string') throw new ErroPdf(400, 'Respostas inválidas.');
    if (valor.length > RESPOSTA_MAX) {
      throw new ErroPdf(400, `A resposta de ${chave} passa de ${RESPOSTA_MAX} caracteres.`);
    }
    limpas[chave] = valor;
  }
  return limpas;
}

export function criarApp({ pastaDados = path.join(RAIZ, 'dados'), versao = '1.0.0', caminhoNavegador } = {}) {
  const modelos = criarRepositorio({
    pastaModelos: path.join(pastaDados, 'modelos'),
    pastaLixeira: path.join(pastaDados, 'lixeira'),
    pastaBackup: path.join(pastaDados, 'backup'),
  });

  const pdf = criarGeradorPdf({ raiz: RAIZ, caminhoNavegador });

  const app = express();
  app.locals.pdf = pdf; // permite fechar o navegador ao encerrar (servidor/testes)
  app.use(express.json({ limit: '5mb' }));

  // Pequeno utilitário: encaminha erros de funções async para o tratador central.
  const rota = (fn) => (req, res, next) => fn(req, res).catch(next);

  app.get('/api/saude', (_req, res) => {
    res.json({ ok: true, app: 'GERADOC', versao });
  });

  app.get('/api/modelos', rota(async (_req, res) => {
    res.json(await modelos.listar());
  }));

  app.get('/api/modelos/:id', rota(async (req, res) => {
    res.json(await modelos.obter(req.params.id));
  }));

  app.post('/api/modelos', rota(async (req, res) => {
    res.status(201).json(await modelos.criar(req.body));
  }));

  app.put('/api/modelos/:id', rota(async (req, res) => {
    res.json(await modelos.atualizar(req.params.id, req.body));
  }));

  app.delete('/api/modelos/:id', rota(async (req, res) => {
    res.json(await modelos.excluir(req.params.id));
  }));

  app.post('/api/modelos/:id/duplicar', rota(async (req, res) => {
    res.status(201).json(await modelos.duplicar(req.params.id));
  }));

  // Arquivos que não puderam ser lidos (a tela avisa o usuário).
  app.get('/api/diagnostico', rota(async (_req, res) => {
    res.json(await modelos.diagnostico());
  }));

  // Lixeira (F5)
  app.get('/api/lixeira', rota(async (_req, res) => {
    res.json(await modelos.listarLixeira());
  }));

  app.post('/api/lixeira/:id/restaurar', rota(async (req, res) => {
    res.json(await modelos.restaurar(req.params.id));
  }));

  app.delete('/api/lixeira/:id', rota(async (req, res) => {
    res.json(await modelos.excluirDefinitivo(req.params.id));
  }));

  // F3: gera o PDF. Recebe só o id do modelo e as respostas; o documento é montado aqui.
  app.post('/api/pdf', rota(async (req, res) => {
    const { modeloId, respostas } = req.body ?? {};
    const modelo = await modelos.obter(modeloId);
    if (!String(modelo.conteudo ?? '').trim()) throw new ErroPdf(400, 'Este modelo está vazio.');
    const arquivo = await pdf.gerar(modelo, validarRespostas(respostas));
    const nome = nomeArquivoPdf(modelo.nome);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': arquivo.length,
      'Content-Disposition': `attachment; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      'Cache-Control': 'no-store',
    });
    res.send(arquivo);
  }));

  app.use('/api', (_req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // Editor de texto (Quill) servido localmente — funciona sem internet.
  app.use('/vendor/quill', express.static(path.join(RAIZ, 'node_modules', 'quill', 'dist')));
  app.use(express.static(path.join(RAIZ, 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((erro, _req, res, _next) => {
    if (erro instanceof ErroModelo || erro instanceof ErroPdf) return res.status(erro.status).json({ erro: erro.message });
    if (erro.type === 'entity.too.large') return res.status(413).json({ erro: 'O modelo é grande demais.' });
    if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Dados inválidos.' });
    console.error('[GERADOC] Erro inesperado:', erro);
    res.status(500).json({ erro: 'Erro interno. Veja a janela do GERADOC para detalhes.' });
  });

  return app;
}
