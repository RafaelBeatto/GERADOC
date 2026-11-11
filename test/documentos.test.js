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

// ---------- v1.2 ----------
test('v1.2 no documento real: condições, contas, opções, opcional, texto longo e nome do arquivo', { skip: pular }, async () => {
  const conteudo = [
    '<p>Locatário: <strong>[NOME:nome]</strong>, [EC: solteiro | casado][SE EC = casado], casado com [CONJUGE][FIM SE].</p>',
    '<p>[SE TEM FIADOR]</p>',
    '<p>Fiador: [FIADOR], CPF [CPF FIADOR:cpf].</p>',
    '<p>[SENÃO]</p>',
    '<p>Sem fiador.</p>',
    '<p>[FIM SE]</p>',
    '<p>Aluguel de [VALOR:moeda] por [MESES] meses: total [=VALOR * MESES] ([=VALOR * MESES:extenso]).</p>',
    '<p>De [INICIO:data] a [=INICIO + MESES meses].[COMPL:opcional]</p>',
    '<p>Obs.: [OBS:texto-longo]</p>',
  ].join('');
  const id = await criarModelo('Locação', conteudo, { nomeArquivo: 'Locação - [NOME:nome] - [INICIO:ano]' });
  const texto = async (respostas) => {
    const r = await post('/documento', { modeloId: id, respostas, formato: 'docx' });
    if (r.status !== 200) return { status: r.status, erro: (await r.json()).erro };
    const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
    const xml = strFromU8(zip['word/document.xml']);
    return { status: 200, nome: decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition'))[1]), xml, texto: xml.replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '¶').replace(/<[^>]+>/g, '') };
  };
  const base = { NOME: 'ANA SOUZA', EC: 'solteiro', VALOR: '1.000,00', MESES: '12', INICIO: '2026-01-31', OBS: 'linha um\nlinha dois' };

  // Faltam só as perguntas dos trechos que valem.
  const falta = await texto({ ...base, EC: 'casado', 'TEM FIADOR': 'sim' });
  assert.equal(falta.status, 400);
  assert.match(falta.erro, /Faltam 3 respostas: CONJUGE, FIADOR, CPF FIADOR\./);
  assert.match((await texto({ ...base, EC: 'divorciado' })).erro, /EC \(escolha uma das opções: solteiro, casado\)/);

  const sem = await texto(base);
  assert.equal(sem.status, 200, sem.erro);
  assert.equal(sem.nome, 'Locação - Ana Souza - 2026.docx');
  assert.equal(sem.texto, 'Locatário: Ana Souza, solteiro.¶Sem fiador.¶Aluguel de R$ 1.000,00 por 12 meses: total R$ 12.000,00 (doze mil reais).¶De 31/01/2026 a 31/01/2027.¶Obs.: linha um\nlinha dois¶',
    'parágrafos só com [SE]/[SENÃO]/[FIM SE] somem; texto longo mantém a quebra de linha');

  const com = await texto({ ...base, EC: 'casado', CONJUGE: 'Zé', 'TEM FIADOR': 'sim', FIADOR: 'Bia', 'CPF FIADOR': '52998224725', COMPL: ' Renovável.' });
  assert.match(com.texto, /^Locatário: Ana Souza, casado, casado com Zé\.¶Fiador: Bia, CPF 529\.982\.247-25\.¶Aluguel/);
  assert.match(com.texto, /a 31\/01\/2027\. Renovável\.¶/);
  assert.doesNotMatch(com.texto, /\[|\]/);

  // Conta impossível não gera documento errado.
  const conta = await criarModelo('Conta', '<p>[=A / B]</p>');
  const ruim = await post('/documento', { modeloId: conta, respostas: { A: '1', B: '0' } });
  assert.equal(ruim.status, 400);
  assert.match((await ruim.json()).erro, /Não foi possível fazer a conta \[=A \/ B\]/);
});

test('lote: um documento por linha num .zip, linhas ruins relatadas, tudo no histórico', { skip: pular }, async () => {
  const id = await criarModelo('Recibo lote', '<p>Recebi de [NOME], CPF [CPF:cpf], [VALOR:moeda].[SE OBS] Obs.: [OBS][FIM SE]</p>');
  const linhas = [
    { NOME: 'Ana Souza', CPF: '52998224725', VALOR: '100' },
    { NOME: 'Ana Souza', CPF: '52998224725', VALOR: '200', OBS: 'segunda' },
    { NOME: 'Cid', CPF: '11111111111', VALOR: '300' },
    { NOME: 'Dea', CPF: '52998224725', VALOR: '' },
  ];
  assert.equal((await post('/lote', { modeloId: id, linhas: [] })).status, 400);
  assert.equal((await post('/lote', { modeloId: id, linhas: Array(301).fill({}) })).status, 400);
  assert.equal((await post('/lote', { modeloId: id, linhas: [{ NOME: 1 }] })).status, 400);

  const inicio = await post('/lote', { modeloId: id, linhas, formato: 'docx' });
  assert.equal(inicio.status, 202);
  let estado = await inicio.json();
  assert.equal(estado.total, 4);
  assert.equal((await post('/lote', { modeloId: id, linhas })).status, 409, 'um lote de cada vez');
  assert.equal((await fetch(`${base}/lote/${estado.id}/arquivo`)).status, 409, 'ainda não está pronto');
  await app.locals.lotes.esperar();
  estado = await (await fetch(`${base}/lote/${estado.id}`)).json();
  assert.equal(estado.estado, 'pronto');
  assert.equal(estado.gerados, 2);
  assert.deepEqual(estado.falhas.map((f) => f.linha), [3, 4]);
  assert.match(estado.falhas[0].erro, /CPF inválido/);
  assert.match(estado.falhas[1].erro, /Falta responder: VALOR/);

  const r = await fetch(`${base}/lote/${estado.id}/arquivo`);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition'), /Recibo%20lote%20-%20lote%20-%20\d{4}-\d{2}-\d{2}\.zip/);
  const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
  assert.deepEqual(Object.keys(zip), ['Recibo lote - Ana Souza.docx', 'Recibo lote - Ana Souza (2).docx']);
  const segundo = strFromU8(unzipSync(zip['Recibo lote - Ana Souza (2).docx'])['word/document.xml']).replace(/<[^>]+>/g, '');
  assert.match(segundo, /Recebi de Ana Souza, CPF 529\.982\.247-25, R\$ 200,00\. Obs\.: segunda/);

  const historico = (await (await fetch(`${base}/historico?modeloId=${id}`)).json());
  assert.deepEqual(historico.map((h) => h.respostas.VALOR), ['200', '100'], 'mais recente primeiro');

  assert.equal((await fetch(`${base}/lote/${estado.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/lote/${estado.id}`)).status, 404);

  // Cancelar no meio.
  const outro = await (await post('/lote', { modeloId: id, linhas: Array(30).fill(linhas[0]) })).json();
  await fetch(`${base}/lote/${outro.id}`, { method: 'DELETE' });
  await app.locals.lotes.esperar();
  const cancelado = await (await fetch(`${base}/lote/${outro.id}`)).json();
  assert.equal(cancelado.estado, 'cancelado');
  assert.ok(cancelado.feitos < 30);
});
