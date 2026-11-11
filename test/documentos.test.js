// v1.1: geração real de PDF e Word com tipos de campo, configuração de página, cabeçalho/rodapé,
// imagens e quebra de página. Precisa do Edge ou Chrome instalado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { criarApp } from '../src/app.js';
import { localizarNavegador, nomeArquivo } from '../src/gerador.js';

const pular = !localizarNavegador() && 'Edge/Chrome não encontrado';
let pasta, app, servidor, base;

before(async () => {
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'geradoc-doc-'));
  app = criarApp({ pastaDados: pasta });
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

after(async () => {
  await app.locals.gerador.fechar();
  app.locals.backup.cancelar();
  await new Promise((r) => servidor.close(r));
  await fs.rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const post = (c, corpo) => fetch(base + c, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

// PNG 2x2 vermelho.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

const CONTEUDO = [
  '<h1 class="ql-align-center">RECIBO</h1>',
  '<p>Recebi de <strong>[NOME:maiusculas]</strong>, CPF [CPF:cpf], a quantia de [VALOR:moeda] ([VALOR:extenso]).</p>',
  `<p><img src="${PNG}" width="50%"></p>`,
  '<ol><li data-list="ordered">Item um</li><li data-list="ordered">Item dois</li></ol>',
  '<hr class="quebra-pagina">',
  '<p class="ql-align-right">Cidade, [HOJE:extenso].</p>',
].join('');
const CONFIG = {
  papel: 'A4', fonte: 'Times New Roman', tamanhoFonte: 13,
  margens: { superior: 2, inferior: 2, esquerda: 3, direita: 2 },
  cabecalho: '<p><strong>Empresa Exemplo</strong> — [NOME]</p>', rodape: '<p class="ql-align-center">Rodapé fixo</p>', numeracao: 'direita',
};
const RESPOSTAS = { NOME: 'Ana Souza', CPF: '52998224725', VALOR: '1500' };

async function criarModelo(nome, conteudo, config) {
  const r = await post('/modelos', { nome, conteudo, config });
  assert.equal(r.status, 201);
  return (await r.json()).id;
}

test('nome do arquivo com extensão', () => {
  assert.equal(nomeArquivo('Recibo', 'docx', new Date(2026, 0, 2)), 'Recibo - 2026-01-02.docx');
});

test('Word (.docx): texto formatado, cabeçalho, rodapé com numeração, imagem, lista, quebra e página certa', { skip: pular }, async () => {
  const id = await criarModelo('Recibo Word', CONTEUDO, CONFIG);
  const r = await post('/documento', { modeloId: id, respostas: RESPOSTAS, formato: 'docx' });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(r.headers.get('content-disposition'), /Recibo%20Word%20-%20\d{4}-\d{2}-\d{2}\.docx/);

  const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const doc = strFromU8(zip['word/document.xml']);
  const texto = doc.replace(/<[^>]+>/g, '');
  assert.match(texto, /RECIBO/);
  assert.match(texto, /ANA SOUZA/);
  assert.match(texto, /529\.982\.247-25/);
  assert.match(texto, /R\$ 1\.500,00/);
  assert.match(texto, /mil e quinhentos reais/);
  assert.match(texto, /Cidade, \d{1,2}º? de [a-zç]+ de \d{4}\./);
  assert.doesNotMatch(texto, /\[|\]/, 'nenhum campo sobrou');
  assert.match(doc, /<w:b\/>|<w:b w:val="true"\/>|<w:b>/, 'negrito');
  assert.match(doc, /<w:pageBreakBefore/, 'quebra de página');
  assert.match(doc, /<w:numPr>/, 'lista numerada');
  assert.match(doc, /<w:jc w:val="center"\/>/, 'título centralizado');
  // A4 retrato: 21 cm = 11907 twips; margem esquerda 3 cm = 1701.
  assert.match(doc, /<w:pgSz w:w="11907" w:h="16840"/);
  assert.match(doc, /w:left="1701"/);
  assert.ok(Object.keys(zip).some((n) => n.startsWith('word/media/')), 'imagem embutida');

  const cabecalho = Object.keys(zip).filter((n) => /^word\/header\d*\.xml$/.test(n)).map((n) => strFromU8(zip[n])).join('');
  assert.match(cabecalho.replace(/<[^>]+>/g, ''), /Empresa Exemplo — Ana Souza/);
  const rodape = Object.keys(zip).filter((n) => /^word\/footer\d*\.xml$/.test(n)).map((n) => strFromU8(zip[n])).join('');
  assert.match(rodape, /Rodapé fixo/);
  assert.match(rodape, /PAGE/);
  assert.match(rodape, /NUMPAGES/);

  const estilos = strFromU8(zip['word/styles.xml']);
  assert.match(estilos, /Times New Roman/);
  assert.match(estilos, /<w:sz w:val="26"\/>/, '13 pt');
});

test('PDF com configuração: Carta paisagem, quebra de página e cabeçalho', { skip: pular }, async () => {
  const id = await criarModelo('Recibo PDF', CONTEUDO, { ...CONFIG, papel: 'Carta', orientacao: 'paisagem' });
  const r = await post('/documento', { modeloId: id, respostas: RESPOSTAS, formato: 'pdf' });
  assert.equal(r.status, 200);
  const pdf = Buffer.from(await r.arrayBuffer()).toString('latin1');
  const caixas = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];
  assert.equal(caixas.length, 2, 'quebra de página = 2 páginas');
  assert.ok(caixas.every((c) => Math.abs(c[1] - 792) < 1.5 && Math.abs(c[2] - 612) < 1.5), 'Carta deitada = 792 x 612');
});

test('recusa resposta inválida para o tipo e formato desconhecido; [HOJE] não é pergunta', { skip: pular }, async () => {
  const id = await criarModelo('Valida', '<p>[CPF:cpf] [D:data] [HOJE]</p>');
  const ruim = await post('/documento', { modeloId: id, respostas: { CPF: '123.456.789-00', D: '2026-02-30' } });
  assert.equal(ruim.status, 400);
  const { erro } = await ruim.json();
  assert.match(erro, /CPF \(CPF inválido\)/);
  assert.match(erro, /D \(data inválida\)/);
  assert.equal((await post('/documento', { modeloId: id, respostas: {}, formato: 'odt' })).status, 400);
  const bom = await post('/documento', { modeloId: id, respostas: { CPF: '529.982.247-25', D: '2026-02-28' } });
  assert.equal(bom.status, 200, 'HOJE não precisou de resposta');
});

test('cada geração entra no histórico (com o formato) e alimenta as sugestões', { skip: pular }, async () => {
  const historico = await (await fetch(`${base}/historico`)).json();
  const formatos = historico.map((h) => `${h.modeloNome}:${h.formato}`);
  assert.ok(formatos.includes('Recibo Word:docx'));
  assert.ok(formatos.includes('Recibo PDF:pdf'));
  const item = historico.find((h) => h.formato === 'docx');
  assert.deepEqual(item.respostas, RESPOSTAS);
  const sugestoes = await (await fetch(`${base}/sugestoes`)).json();
  assert.deepEqual(sugestoes.NOME, ['Ana Souza']);
});
