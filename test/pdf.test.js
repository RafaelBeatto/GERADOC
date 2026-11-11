import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../src/app.js';
import { localizarNavegador, nomeArquivoPdf } from '../src/pdf.js';

test('nome do arquivo: tira caracteres proibidos no Windows e acrescenta a data', () => {
  const data = new Date(2026, 10, 10);
  assert.equal(nomeArquivoPdf('Contrato: locação / casa?', data), 'Contrato locação casa - 2026-11-10.pdf');
  assert.equal(nomeArquivoPdf('  ...  ', data), 'documento - 2026-11-10.pdf');
});

test('procura o Edge primeiro, depois o Chrome; GERADOC_NAVEGADOR tem prioridade', () => {
  const env = { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86' };
  const edge = path.join('C:\\PF86', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const chrome = path.join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe');
  assert.equal(localizarNavegador(env, (c) => c === edge || c === chrome), edge);
  assert.equal(localizarNavegador(env, (c) => c === chrome), chrome);
  assert.equal(localizarNavegador(env, () => false), null);
  assert.equal(localizarNavegador({ GERADOC_NAVEGADOR: 'X:\\b.exe' }, (c) => c === 'X:\\b.exe'), 'X:\\b.exe');
});

// ---- Geração real (precisa do Edge ou Chrome instalado) ----
const temNavegador = Boolean(localizarNavegador());
let pasta, app, servidor, base;

before(async () => {
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'geradoc-pdf-'));
  app = criarApp({ pastaDados: pasta });
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  await app.locals.pdf.fechar();
  await new Promise((r) => servidor.close(r));
  await fs.rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function post(caminho, corpo) {
  return fetch(base + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
}

async function criarModelo(nome, conteudo) {
  return (await (await post('/modelos', { nome, conteudo })).json()).id;
}

test('recusa respostas inválidas, modelo inexistente e modelo vazio (sem abrir o navegador)', async () => {
  const id = await criarModelo('Declaração', '<p>[NOME]</p>');
  assert.equal((await post('/pdf', { modeloId: id, respostas: ['x'] })).status, 400);
  assert.equal((await post('/pdf', { modeloId: id, respostas: { NOME: 5 } })).status, 400);
  assert.equal((await post('/pdf', { modeloId: id, respostas: { NOME: 'a'.repeat(2001) } })).status, 400);
  assert.equal((await post('/pdf', { modeloId: 'nao-existe', respostas: {} })).status, 404);
  const vazio = await criarModelo('Vazio', '');
  assert.equal((await post('/pdf', { modeloId: vazio, respostas: {} })).status, 400);
});

test('gera PDF A4 com as respostas e recusa perguntas sem resposta', { skip: !temNavegador && 'Edge/Chrome não encontrado' }, async () => {
  const id = await criarModelo('Recibo: teste', '<h1>Recibo</h1><p>Eu, <strong>[No</strong>me], CPF [cpf], declaro. Assina: [NOME]</p>');

  const faltando = await post('/pdf', { modeloId: id, respostas: { NOME: 'Ana', CPF: '   ' } });
  assert.equal(faltando.status, 400);
  assert.match((await faltando.json()).erro, /CPF/);

  const r = await post('/pdf', { modeloId: id, respostas: { NOME: 'Ana Souza', CPF: '[X] 123' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.match(r.headers.get('content-disposition'), /filename\*=UTF-8''Recibo%20teste%20-%20\d{4}-\d{2}-\d{2}\.pdf/);
  const pdf = Buffer.from(await r.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // A4 = 595 x 842 pontos.
  const caixa = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'));
  assert.ok(caixa, 'PDF sem MediaBox');
  assert.ok(Math.abs(caixa[1] - 595) < 1.5 && Math.abs(caixa[2] - 842) < 1.5, `página ${caixa[1]}x${caixa[2]} não é A4`);
});

test('documento longo e formatado sai em várias páginas A4 (mesmo com lixo perigoso no modelo)', { skip: !temNavegador && 'Edge/Chrome não encontrado' }, async () => {
  const paragrafo = '<p class="ql-align-justify">Cláusula sobre [OBJETO], com texto suficiente para ocupar uma linha inteira da folha A4 e um pouco mais.</p>';
  const conteudo = [
    '<h1 class="ql-align-center">CONTRATO</h1>',
    '<p><span class="ql-size-large">Contratante: <strong>[NOME]</strong></span></p>',
    '<ol><li data-list="ordered">Primeiro item</li><li data-list="ordered">Segundo item</li></ol>',
    '<ol><li data-list="bullet">Marcador</li><li data-list="bullet" class="ql-indent-1">Recuado</li></ol>',
    '<p><img src="x" onerror="document.title=\'hack\'"><script>document.title="hack"</script></p>',
    paragrafo.repeat(120),
    '<p class="ql-align-right">[CIDADE], [DATA]</p>',
  ].join('');
  const id = await criarModelo('Contrato longo', conteudo);
  const r = await post('/pdf', { modeloId: id, respostas: { NOME: 'José da Silva', OBJETO: 'locação', CIDADE: 'São Paulo', DATA: '10/11/2026' } });
  assert.equal(r.status, 200);
  const pdf = Buffer.from(await r.arrayBuffer()).toString('latin1');
  const paginas = pdf.match(/\/Type\s*\/Page(?!s)/g) ?? [];
  assert.ok(paginas.length >= 3, `esperava várias páginas, veio ${paginas.length}`);
  const caixas = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
  assert.ok(caixas.every((c) => Math.abs(c[1] - 595) < 1.5 && Math.abs(c[2] - 842) < 1.5), 'todas as páginas em A4');
});

test('campos.js remove do modelo tudo que executa código (no navegador real)', { skip: !temNavegador && 'Edge/Chrome não encontrado' }, async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  const codigo = await fs.readFile(path.join(import.meta.dirname, '..', 'public', 'js', 'campos.js'), 'utf8');
  const navegador = await puppeteer.launch({ executablePath: localizarNavegador(), headless: true, pipe: true });
  try {
    const pagina = await navegador.newPage();
    const saida = await pagina.evaluate(async (url) => {
      const campos = await import(url);
      return campos.preencherHtml(
        '<p onclick="x()">Oi [NOME]</p><img src="a.png" onerror="alert(1)"><script>alert(2)</script>'
        + '<a href=" JaVa\tScript:alert(3)">link</a><a href="https://ok.example">ok</a><iframe src="x"></iframe>'
        + '<strong class="ql-size-large" style="color: red;">[NOME]</strong>'
        + '<ol><li data-list="ordered">sem marcador</li><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>com</li></ol>',
        { NOME: 'Ana' },
      );
    }, `data:text/javascript;base64,${Buffer.from(codigo).toString('base64')}`);
    assert.match(saida, /<li data-list="ordered"><span class="ql-ui" contenteditable="false"><\/span>sem marcador<\/li>/);
    assert.equal(saida.match(/ql-ui/g).length, 2, 'não duplica o marcador que já existe');
    assert.doesNotMatch(saida, /onclick|onerror|<script|<iframe|javascript:/i);
    assert.match(saida, /<p>Oi Ana<\/p>/);
    assert.match(saida, /href="https:\/\/ok.example"/);
    assert.match(saida, /<strong class="ql-size-large" style="color: red;">Ana<\/strong>/, 'formatação é mantida');
  } finally {
    await navegador.close();
  }
});
