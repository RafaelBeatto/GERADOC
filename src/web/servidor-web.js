// GERADOC (modo web) — faz o papel do servidor (src/app.js) dentro do navegador.
// Intercepta os pedidos `/api/...` do app e responde com os mesmos módulos do servidor
// (modelos, histórico, lote), guardando tudo no IndexedDB do navegador.
import { criarRepositorio, ErroModelo } from '../modelos.js';
import { ErroGeracao, FORMATOS, nomeArquivo, nomeDocumento } from '../gerador.js';
import { criarLotes, ErroLote, LOTE_MAX } from '../lote.js';
import { criarHistorico, ErroHistorico } from '../historico.js';
import { criarGeradorWeb } from './gerador-web.js';
import { iniciarArmazenamento } from './fs.js';

export const VERSAO = '1.2.0';
const RESPOSTA_MAX = 10000;

function validarRespostas(respostas) {
  if (!respostas || typeof respostas !== 'object' || Array.isArray(respostas)) throw new ErroGeracao(400, 'Respostas inválidas.');
  const limpas = {};
  for (const [chave, valor] of Object.entries(respostas)) {
    if (typeof valor !== 'string') throw new ErroGeracao(400, 'Respostas inválidas.');
    if (valor.length > RESPOSTA_MAX) throw new ErroGeracao(400, `A resposta de ${chave} passa de ${RESPOSTA_MAX} caracteres.`);
    limpas[chave] = valor;
  }
  return limpas;
}

const json = (dados, status = 200) => new Response(JSON.stringify(dados), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

function arquivo({ conteudo, nome, tipo }) {
  return new Response(new Blob([conteudo], { type: tipo }), {
    status: 200,
    headers: {
      'Content-Type': tipo,
      'Content-Disposition': `attachment; filename="arquivo.${nome.split('.').pop()}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
    },
  });
}

const ERROS = [ErroModelo, ErroGeracao, ErroHistorico, ErroLote];

export function criarServidorWeb() {
  const modelos = criarRepositorio({ pastaModelos: 'dados/modelos', pastaLixeira: 'dados/lixeira', pastaBackup: 'dados/backup' });
  const historico = criarHistorico({ arquivo: 'dados/historico.json' });
  const gerador = criarGeradorWeb();
  const lotes = criarLotes({ gerador, historico });

  async function gerarDocumento(corpo) {
    const { modeloId, respostas } = corpo ?? {};
    const formato = corpo?.formato ?? 'pdf';
    if (!FORMATOS[formato]) throw new ErroGeracao(400, 'Formato de documento inválido.');
    const modelo = await modelos.obter(modeloId);
    if (!String(modelo.conteudo ?? '').trim()) throw new ErroGeracao(400, 'Este modelo está vazio.');
    const limpas = validarRespostas(respostas);
    const { arquivo: bytes, campos, impresso } = await gerador.gerar(modelo, limpas, formato);
    try {
      await historico.registrar({ modelo, formato, respostas: limpas, campos });
    } catch (erro) {
      console.warn(`[GERADOC] Documento gerado, mas não foi possível registrar no histórico: ${erro.message}`);
    }
    if (impresso) return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json', 'X-Imprimir': '1' } });
    return arquivo({ conteudo: bytes, nome: nomeDocumento(modelo, limpas, campos, FORMATOS[formato].extensao), tipo: FORMATOS[formato].tipo });
  }

  const exportacao = (dados, prefixo) => arquivo({
    conteudo: JSON.stringify(dados, null, 2), nome: nomeArquivo(prefixo, 'json'), tipo: 'application/json; charset=utf-8',
  });

  // [método, padrão, função(params, corpo, consulta) → Response | objeto JSON]
  const rotas = [
    ['GET', '/saude', () => ({ ok: true, app: 'GERADOC', versao: VERSAO, podeEncerrar: false, modoWeb: true })],
    ['GET', '/modelos', () => modelos.listar()],
    ['POST', '/modelos', async (_p, c) => json(await modelos.criar(c), 201)],
    ['GET', '/modelos/:id', (p) => modelos.obter(p.id)],
    ['PUT', '/modelos/:id', (p, c) => modelos.atualizar(p.id, c)],
    ['DELETE', '/modelos/:id', (p) => modelos.excluir(p.id)],
    ['POST', '/modelos/:id/duplicar', async (p) => json(await modelos.duplicar(p.id), 201)],
    ['GET', '/modelos/:id/versoes', (p) => modelos.listarVersoes(p.id)],
    ['GET', '/modelos/:id/versoes/:versao', (p) => modelos.obterVersao(p.id, p.versao)],
    ['POST', '/modelos/:id/versoes/:versao/restaurar', (p) => modelos.restaurarVersao(p.id, p.versao)],
    ['GET', '/modelos/:id/exportar', async (p) => {
      const dados = await modelos.exportar([p.id]);
      return exportacao(dados, `GERADOC - ${dados.modelos[0].nome}`);
    }],
    ['GET', '/exportar', async () => exportacao(await modelos.exportar(), 'GERADOC - modelos')],
    ['POST', '/importar', (_p, c) => modelos.importar(c)],
    ['GET', '/diagnostico', () => modelos.diagnostico()],
    ['GET', '/lixeira', () => modelos.listarLixeira()],
    ['POST', '/lixeira/:id/restaurar', (p) => modelos.restaurar(p.id)],
    ['DELETE', '/lixeira/:id', (p) => modelos.excluirDefinitivo(p.id)],
    ['POST', '/documento', (_p, c) => gerarDocumento(c)],
    ['POST', '/pdf', (_p, c) => gerarDocumento(c)],
    ['POST', '/lote', async (_p, c) => {
      const formato = c?.formato ?? 'pdf';
      if (!FORMATOS[formato]) throw new ErroGeracao(400, 'Formato de documento inválido.');
      if (formato === 'pdf') throw new ErroLote(400, 'Na versão online, o lote é gerado em Word. Para PDFs em lote, use a versão instalada.');
      if (!Array.isArray(c?.linhas) || c.linhas.length === 0) throw new ErroLote(400, 'O lote não tem nenhuma linha.');
      if (c.linhas.length > LOTE_MAX) throw new ErroLote(400, `O lote pode ter no máximo ${LOTE_MAX} documentos por vez.`);
      const modelo = await modelos.obter(c.modeloId);
      if (!String(modelo.conteudo ?? '').trim()) throw new ErroGeracao(400, 'Este modelo está vazio.');
      return json(lotes.iniciar(modelo, c.linhas.map(validarRespostas), formato), 202);
    }],
    ['GET', '/lote/:id', (p) => lotes.status(p.id)],
    ['GET', '/lote/:id/arquivo', (p) => arquivo({ ...lotes.arquivo(p.id), tipo: 'application/zip' })],
    ['DELETE', '/lote/:id', (p) => lotes.cancelar(p.id)],
    ['GET', '/historico', (_p, _c, q) => historico.listar({ modeloId: q.get('modeloId') ?? undefined })],
    ['GET', '/historico/:id', (p) => historico.obter(p.id)],
    ['DELETE', '/historico/:id', (p) => historico.excluir(p.id)],
    ['DELETE', '/historico', () => historico.limpar()],
    ['GET', '/sugestoes', () => historico.sugestoes()],
    ['GET', '/configuracoes', () => ({
      backupExterno: { pasta: '', ativo: false }, sugestoesPasta: [], pastaDados: 'Neste navegador (este aparelho)',
    })],
  ].map(([metodo, padrao, funcao]) => ({
    metodo,
    funcao,
    regex: new RegExp(`^${padrao.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  }));

  /** Responde a um pedido `/api/...`. */
  async function responder(url, { method = 'GET', body } = {}) {
    const alvo = new URL(url, location.origin);
    const caminho = decodeURIComponent(alvo.pathname.replace(/^.*?\/api/, '')) || '/';
    try {
      await iniciarArmazenamento();
      const rota = rotas.find((r) => r.metodo === method.toUpperCase() && r.regex.test(caminho));
      if (!rota) return json({ erro: 'Rota não encontrada.' }, 404);
      const params = { ...rota.regex.exec(caminho).groups };
      for (const k of Object.keys(params)) params[k] = decodeURIComponent(params[k]);
      let corpo;
      if (typeof body === 'string' && body) {
        try { corpo = JSON.parse(body); } catch { return json({ erro: 'Dados inválidos (o arquivo não é JSON válido).' }, 400); }
      }
      const resultado = await rota.funcao(params, corpo, alvo.searchParams);
      return resultado instanceof Response ? resultado : json(resultado);
    } catch (erro) {
      if (ERROS.some((E) => erro instanceof E)) return json({ erro: erro.message }, erro.status);
      console.error('[GERADOC] Erro inesperado:', erro);
      return json({ erro: 'Erro interno ao processar o pedido.' }, 500);
    }
  }

  return { responder };
}
