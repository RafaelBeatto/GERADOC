// Teste de ponta a ponta: usa a interface de verdade no Edge/Chrome sem janela.
// Defina GERADOC_CAPTURAS=<pasta> para salvar capturas de tela de cada etapa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { criarApp } from '../src/app.js';
import { localizarNavegador } from '../src/gerador.js';

const executavel = localizarNavegador();
const pular = !executavel && 'Edge/Chrome não encontrado';

let pasta, pastaDownloads, app, servidor, url, navegador, pagina;
const errosDaPagina = [];
let atalhosCriados = 0;
let encerrou = false;

before(async () => {
  if (pular) return;
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'geradoc-ui-'));
  pastaDownloads = path.join(pasta, 'downloads');
  await fs.mkdir(pastaDownloads);
  app = criarApp({
    pastaDados: path.join(pasta, 'dados'),
    criarAtalho: async () => { atalhosCriados += 1; return 'C:\\falso\\GERADOC.lnk'; },
    aoEncerrar: () => { encerrou = true; },
  });
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  url = `http://127.0.0.1:${servidor.address().port}/`;

  navegador = await puppeteer.launch({ executablePath: executavel, headless: true, pipe: true });
  pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1280, height: 900 });
  pagina.on('dialog', (d) => d.accept()); // "sair sem salvar?" do navegador
  pagina.on('pageerror', (e) => errosDaPagina.push(e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') errosDaPagina.push(m.text()); });
  const cdp = await pagina.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: pastaDownloads });
});

after(async () => {
  if (pular) return;
  await navegador?.close();
  await app.locals.gerador.fechar();
  app.locals.backup.cancelar();
  await app.locals.backup.parar();
  await new Promise((r) => servidor.close(r));
  await fs.rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function capturar(nome) {
  if (!process.env.GERADOC_CAPTURAS) return;
  await fs.mkdir(process.env.GERADOC_CAPTURAS, { recursive: true });
  await pagina.screenshot({ path: path.join(process.env.GERADOC_CAPTURAS, `${nome}.png`), fullPage: true });
}

const telaVisivel = (id) => pagina.waitForSelector(`#${id}:not([hidden])`, { timeout: 5000 });

async function nomesNaTabela(corpo) {
  return pagina.$$eval(`#${corpo} tr`, (linhas) => linhas.map((l) => l.querySelector('.modelo-nome').textContent.trim()));
}

/** Clica no botão com o texto dado, dentro da linha do modelo indicado. */
async function clicarNaLinha(corpo, nomeModelo, textoBotao) {
  const ok = await pagina.$$eval(`#${corpo} tr`, (linhas, nome, texto) => {
    const linha = linhas.find((l) => l.querySelector('.modelo-nome').textContent.trim() === nome);
    const botao = linha && [...linha.querySelectorAll('.botao')].find((b) => b.textContent.trim() === texto);
    botao?.click();
    return Boolean(botao);
  }, nomeModelo, textoBotao);
  assert.ok(ok, `botão "${textoBotao}" do modelo "${nomeModelo}" não encontrado`);
}

async function confirmarDialogo() {
  await pagina.waitForSelector('#dialogo-confirmar[open]');
  await capturar(`dialogo-${Date.now()}`);
  await pagina.click('#dialogo-botao');
  await pagina.waitForSelector('#dialogo-confirmar:not([open])');
}

async function esperarAviso(trecho) {
  await pagina.waitForFunction((t) => {
    const a = document.getElementById('aviso');
    return !a.hidden && a.textContent.includes(t);
  }, { timeout: 15000 }, trecho);
}

async function irPara(hash, tela) {
  await pagina.evaluate((h) => { location.hash = h; }, hash);
  await telaVisivel(tela);
  await pagina.waitForNetworkIdle({ idleTime: 150 });
}

async function esperarDownload(extensao, antes) {
  for (let i = 0; i < 80; i += 1) {
    const novos = (await fs.readdir(pastaDownloads)).filter((a) => a.endsWith(`.${extensao}`) && !antes.includes(a));
    if (novos.length) return novos[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Seleciona tudo (Ctrl+A) e apaga, como o usuário faria. */
async function apagarCampo(seletor) {
  await pagina.click(seletor);
  await pagina.keyboard.down('Control');
  await pagina.keyboard.press('KeyA');
  await pagina.keyboard.up('Control');
  await pagina.keyboard.press('Backspace');
}

async function apiTeste(metodo, caminho, corpo) {
  const r = await fetch(`${url}api${caminho}`, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo && JSON.stringify(corpo) });
  return r.json();
}

test('fluxo completo pela interface', { skip: pular }, async (t) => {
  await pagina.goto(url, { waitUntil: 'networkidle0' });
  await telaVisivel('tela-lista');
  assert.equal(await pagina.$eval('#lista-vazia', (el) => el.hidden), false, 'mostra estado vazio');
  await capturar('01-lista-vazia');

  await t.test('cria um modelo pelo editor', async () => {
    await pagina.click('a[href="#/novo"]');
    await telaVisivel('tela-editor');
    await pagina.type('#nome-modelo', 'Declaração de residência');
    await pagina.click('.ql-editor');
    await pagina.keyboard.type('Eu, [NOME], CPF [cpf], resido em [ENDEREÇO]. Assina: [Nome]');
    await pagina.waitForFunction(() => document.querySelectorAll('#lista-campos-editor .chip').length === 3);
    await capturar('02-editor');
    await pagina.click('#botao-salvar');
    await telaVisivel('tela-lista');
    await esperarAviso('salvo');
    assert.deepEqual(await nomesNaTabela('lista-modelos'), ['Declaração de residência']);
  });

  await t.test('duplica', async () => {
    await clicarNaLinha('lista-modelos', 'Declaração de residência', 'Duplicar');
    await esperarAviso('Cópia criada');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    assert.deepEqual(await nomesNaTabela('lista-modelos'), ['Declaração de residência', 'Declaração de residência (cópia)']);
    await capturar('03-duplicado');
  });

  await t.test('exclui (vai para a lixeira) e restaura', async () => {
    await clicarNaLinha('lista-modelos', 'Declaração de residência (cópia)', 'Excluir');
    await confirmarDialogo();
    await esperarAviso('movido para a lixeira');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    assert.deepEqual(await nomesNaTabela('lista-modelos'), ['Declaração de residência']);
    assert.equal(await pagina.$eval('#contagem-lixeira', (el) => !el.hidden && el.textContent), '1');

    await pagina.click('a[href="#/lixeira"]');
    await telaVisivel('tela-lixeira');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    assert.deepEqual(await nomesNaTabela('lista-lixeira'), ['Declaração de residência (cópia)']);
    await capturar('04-lixeira');

    await clicarNaLinha('lista-lixeira', 'Declaração de residência (cópia)', 'Restaurar');
    await esperarAviso('restaurado');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    assert.equal(await pagina.$eval('#lixeira-vazia', (el) => el.hidden), false);
    await capturar('05-lixeira-vazia');

    await irPara('#/', 'tela-lista');
    assert.equal((await nomesNaTabela('lista-modelos')).length, 2);
  });

  await t.test('exclui definitivamente pela lixeira', async () => {
    await clicarNaLinha('lista-modelos', 'Declaração de residência (cópia)', 'Excluir');
    await confirmarDialogo();
    await esperarAviso('movido para a lixeira');
    await irPara('#/lixeira', 'tela-lixeira');

    // Cancelar não exclui.
    await clicarNaLinha('lista-lixeira', 'Declaração de residência (cópia)', 'Excluir definitivamente');
    await pagina.waitForSelector('#dialogo-confirmar[open]');
    await pagina.click('#dialogo-confirmar button[value="cancelar"]');
    await pagina.waitForSelector('#dialogo-confirmar:not([open])');
    assert.equal((await nomesNaTabela('lista-lixeira')).length, 1);

    await clicarNaLinha('lista-lixeira', 'Declaração de residência (cópia)', 'Excluir definitivamente');
    await confirmarDialogo();
    await esperarAviso('excluído definitivamente');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    assert.deepEqual(await nomesNaTabela('lista-lixeira'), []);
  });

  await t.test('gera o PDF e ele é baixado', async () => {
    await irPara('#/', 'tela-lista');
    await clicarNaLinha('lista-modelos', 'Declaração de residência', 'Gerar documento');
    await telaVisivel('tela-gerar');
    const rotulos = await pagina.$$eval('#perguntas .rotulo', (r) => r.map((x) => x.firstChild.textContent.trim()));
    assert.deepEqual(rotulos, ['NOME', 'CPF', 'ENDEREÇO']);

    // Sem responder: não gera.
    await pagina.click('#botao-gerar');
    await pagina.waitForSelector('#erro-respostas:not([hidden])');

    await pagina.type('#resposta-0', 'Maria Oliveira');
    await pagina.type('#resposta-1', '123.456.789-00');
    await pagina.type('#resposta-2', 'Rua das Flores, 10');
    const previa = await pagina.$eval('#previa', (el) => el.textContent);
    assert.match(previa, /Eu, Maria Oliveira, CPF 123\.456\.789-00, resido em Rua das Flores, 10\. Assina: Maria Oliveira/);
    await capturar('06-gerar');

    await pagina.click('#botao-gerar');
    await esperarAviso('PDF gerado');
    let arquivos = [];
    for (let i = 0; i < 50 && !arquivos.some((a) => a.endsWith('.pdf')); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      arquivos = await fs.readdir(pastaDownloads);
    }
    const pdf = arquivos.find((a) => a.endsWith('.pdf'));
    assert.match(pdf ?? '', /^Declaração de residência - \d{4}-\d{2}-\d{2}\.pdf$/);
    const conteudo = await fs.readFile(path.join(pastaDownloads, pdf));
    assert.equal(conteudo.subarray(0, 5).toString(), '%PDF-');
  });

  let recibo;
  await t.test('tipos de campo: máscara, valor por extenso, validação e Word', async () => {
    recibo = await apiTeste('POST', '/modelos', {
      nome: 'Recibo',
      conteudo: '<p>Recebi de [NOME], CPF [CPF:cpf], [VALOR:moeda] ([VALOR:extenso]) em [HOJE:extenso].</p>',
      config: { cabecalho: '<p>Empresa [NOME]</p>', numeracao: 'centro' },
    });
    await irPara(`#/gerar/${recibo.id}`, 'tela-gerar');
    const rotulos = await pagina.$$eval('#perguntas .rotulo', (r) => r.map((x) => x.firstChild.textContent.trim()));
    assert.deepEqual(rotulos, ['NOME', 'CPF', 'VALOR'], '[HOJE] não vira pergunta');
    assert.match(await pagina.$eval('#previa-numero', (el) => !el.hidden && el.textContent), /Página 1 de 1/);

    await pagina.type('#resposta-0', 'Ana Souza');
    await pagina.type('#resposta-1', '12345678900');
    assert.equal(await pagina.$eval('#resposta-1', (el) => el.value), '123.456.789-00', 'máscara do CPF');
    await pagina.type('#resposta-2', '1500');
    await pagina.focus('#resposta-0'); // sai do campo de valor: formata
    assert.equal(await pagina.$eval('#resposta-2', (el) => el.value), '1.500,00');
    const exemplo = await pagina.$$eval('.exemplo-resposta', (els) => els.map((e) => e.textContent));
    assert.ok(exemplo.some((e) => e.includes('R$ 1.500,00 · mil e quinhentos reais')), exemplo.join(' | '));
    const previa = await pagina.$eval('#folha', (el) => el.textContent);
    assert.match(previa, /Empresa Ana Souza/, 'cabeçalho na pré-visualização');
    assert.match(previa, /R\$ 1\.500,00 \(mil e quinhentos reais\) em \d{1,2}º? de [a-zç]+ de \d{4}/);

    // CPF inválido não deixa gerar.
    await pagina.click('#botao-word');
    await pagina.waitForSelector('#erro-respostas:not([hidden])');
    assert.match(await pagina.$eval('#erro-respostas', (el) => el.textContent), /CPF inválido/);

    await apagarCampo('#resposta-1');
    await pagina.type('#resposta-1', '52998224725');
    await capturar('08-gerar-tipos');
    const antes = await fs.readdir(pastaDownloads);
    await pagina.click('#botao-word');
    await esperarAviso('Word gerado');
    const docx = await esperarDownload('docx', antes);
    assert.match(docx ?? '', /^Recibo - \d{4}-\d{2}-\d{2}\.docx$/);
    const conteudo = await fs.readFile(path.join(pastaDownloads, docx));
    assert.equal(conteudo.subarray(0, 2).toString(), 'PK', '.docx é um zip');
  });

  await t.test('histórico: gerar de novo abre com as mesmas respostas; últimas respostas', async () => {
    await irPara('#/historico', 'tela-historico');
    const linhas = await pagina.$$eval('#lista-historico tr', (ls) => ls.map((l) => l.querySelector('.modelo-nome').textContent));
    assert.ok(linhas[0].startsWith('Recibo · Word'), linhas.join(' | '));
    assert.ok(linhas.some((l) => l.startsWith('Declaração de residência · PDF')));
    await capturar('09-historico');
    await pagina.click('#lista-historico tr:first-child a.botao');
    await telaVisivel('tela-gerar');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    assert.equal(await pagina.$eval('#resposta-1', (el) => el.value), '529.982.247-25');

    await pagina.click('#botao-limpar');
    await irPara(`#/gerar/${recibo.id}`, 'tela-gerar');
    assert.equal(await pagina.$eval('#ultimas-respostas', (el) => el.hidden), false);
    await pagina.click('#botao-ultimas');
    assert.equal(await pagina.$eval('#resposta-0', (el) => el.value), 'Ana Souza');
    const sugestoes = await pagina.$$eval('#perguntas datalist option', (os) => os.map((o) => o.value));
    assert.ok(sugestoes.includes('Ana Souza'), 'sugere respostas já usadas');
  });

  await t.test('editor: inserir campo, página, rodapé; versões anteriores', async () => {
    await irPara(`#/editar/${recibo.id}`, 'tela-editor');
    await pagina.click('#editor .ql-editor');
    await pagina.keyboard.down('Control');
    await pagina.keyboard.press('End');
    await pagina.keyboard.up('Control');
    await pagina.type('#inserir-campo-nome', 'vencimento');
    await pagina.select('#inserir-campo-tipo', 'data-extenso');
    await pagina.click('#inserir-campo-botao');
    await pagina.waitForFunction(() => [...document.querySelectorAll('#lista-campos-editor .chip')].some((c) => c.textContent.startsWith('VENCIMENTO · data')));
    await pagina.select('#cfg-fonte', 'Georgia');
    await pagina.select('#cfg-papel', 'Ofício');
    await pagina.click('#editor-rodape .ql-editor');
    await pagina.keyboard.type('Rua Exemplo, 100');

    // Margem impossível: avisa e não salva.
    await apagarCampo('#cfg-m-esquerda');
    await pagina.keyboard.type('20');
    await pagina.click('#botao-salvar');
    await pagina.waitForSelector('#erro-config:not([hidden])');
    await apagarCampo('#cfg-m-esquerda');
    await pagina.keyboard.type('3');
    await capturar('10-editor-config');
    await pagina.click('#botao-salvar');
    await telaVisivel('tela-lista');
    await esperarAviso('salvo');

    const salvo = await apiTeste('GET', `/modelos/${recibo.id}`);
    assert.match(salvo.conteudo, /\[VENCIMENTO:data-extenso\]/);
    assert.equal(salvo.config.fonte, 'Georgia');
    assert.equal(salvo.config.papel, 'Ofício');
    assert.equal(salvo.config.margens.esquerda, 3);
    assert.match(salvo.config.rodape, /Rua Exemplo, 100/);
    assert.match(salvo.config.cabecalho, /Empresa \[NOME\]/, 'cabeçalho mantido');

    await irPara(`#/versoes/${recibo.id}`, 'tela-versoes');
    await pagina.waitForSelector('#botao-restaurar-versao:not([disabled])');
    assert.equal(await pagina.$$eval('#lista-versoes li', (l) => l.length), 1);
    await capturar('11-versoes');
    await pagina.click('#botao-restaurar-versao');
    await pagina.waitForSelector('#dialogo-confirmar[open]');
    await pagina.click('#dialogo-botao');
    await esperarAviso('Versão restaurada');
    await telaVisivel('tela-editor');
    const restaurado = await apiTeste('GET', `/modelos/${recibo.id}`);
    assert.doesNotMatch(restaurado.conteudo, /VENCIMENTO/);
    assert.equal(restaurado.config.fonte, 'Segoe UI');
    assert.equal((await apiTeste('GET', `/modelos/${recibo.id}/versoes`)).length, 2, 'a versão desfeita ficou guardada');
    await irPara('#/', 'tela-lista');
  });

  await t.test('configurações: backup externo, atalho, exportar e importar', async () => {
    const nuvem = path.join(pasta, 'OneDrive');
    await fs.mkdir(nuvem);
    await irPara('#/configuracoes', 'tela-configuracoes');
    await pagina.type('#cfg-pasta-backup', nuvem);
    await pagina.click('#botao-salvar-backup');
    await esperarAviso('Backup externo ligado');
    assert.match(await pagina.$eval('#status-backup', (el) => el.textContent), /Último backup/);
    assert.ok((await fs.readdir(path.join(nuvem, 'GERADOC-backup', 'modelos'))).some((a) => a.startsWith(recibo.id)));

    await pagina.click('#botao-atalho');
    await esperarAviso('Atalho GERADOC criado');
    assert.equal(atalhosCriados, 1);
    await capturar('12-configuracoes');

    const exportado = await apiTeste('GET', '/exportar');
    const arquivo = path.join(pasta, 'exportado.json');
    await fs.writeFile(arquivo, JSON.stringify(exportado));
    const entrada = await pagina.$('#arquivo-importar');
    await entrada.uploadFile(arquivo);
    await esperarAviso('importados');
    await telaVisivel('tela-lista');
    await pagina.waitForNetworkIdle({ idleTime: 150 });
    const nomes = await nomesNaTabela('lista-modelos');
    assert.ok(nomes.includes('Recibo (importado)'), nomes.join(' | '));
  });

  await t.test('v1.2: perguntas que aparecem conforme as respostas, opções, conta e nome do arquivo', async () => {
    const locacao = await apiTeste('POST', '/modelos', {
      nome: 'Locação',
      conteudo: '<p>[NOME], [EC: solteiro | casado][SE EC = casado], cônjuge [CONJUGE][FIM SE].</p><p>[SE TEM FIADOR]Fiador: [FIADOR].[FIM SE]</p>'
        + '<p>Total: [=VALOR * QTD] ([VALOR:moeda] x [QTD]).[OBS:texto-longo opcional]</p>',
      config: { nomeArquivo: 'Locação - [NOME]' },
    });
    await irPara(`#/gerar/${locacao.id}`, 'tela-gerar');
    const visiveis = () => pagina.$$eval('#perguntas .pergunta', (ps) => ps.filter((p) => !p.hidden).map((p) => p.dataset.campo));
    assert.deepEqual(await visiveis(), ['NOME', 'EC', 'TEM FIADOR', 'VALOR', 'QTD', 'OBS']);
    assert.match(await pagina.$eval('#progresso-contagem', (el) => el.textContent), /0 de 4/);

    await pagina.type('#resposta-0', 'Ana');
    await pagina.select('#resposta-1', 'casado');
    assert.deepEqual(await visiveis(), ['NOME', 'EC', 'CONJUGE', 'TEM FIADOR', 'VALOR', 'QTD', 'OBS']);
    await pagina.click('#resposta-3'); // TEM FIADOR = sim
    assert.ok((await visiveis()).includes('FIADOR'));
    await pagina.click('#resposta-3'); // desmarca: a pergunta some de novo
    assert.ok(!(await visiveis()).includes('FIADOR'));

    await pagina.type('#resposta-5', '10');
    await pagina.type('#resposta-6', '3');
    // Falta só o cônjuge (o fiador está escondido e a observação é opcional).
    await pagina.click('#botao-gerar');
    await pagina.waitForSelector('#erro-respostas:not([hidden])');
    assert.equal(await pagina.$eval('#erro-respostas', (el) => el.textContent), 'Falta responder: CONJUGE.');
    await pagina.type('#resposta-2', 'Zé');
    const previa = await pagina.$eval('#previa', (el) => el.textContent);
    assert.match(previa, /Ana, casado, cônjuge Zé\.Total: R\$ 30,00 \(R\$ 10,00 x 3\)\./);
    await capturar('13-condicional');

    const antes = await fs.readdir(pastaDownloads);
    await pagina.click('#botao-gerar');
    await esperarAviso('PDF gerado');
    assert.equal(await esperarDownload('pdf', antes), 'Locação - Ana.pdf');
  });

  await t.test('v1.2: gerar em lote colando a planilha', async () => {
    await irPara(`#/gerar/${recibo.id}`, 'tela-gerar');
    await pagina.click('#link-lote');
    await telaVisivel('tela-lote');
    assert.deepEqual(await pagina.$$eval('#lote-colunas .chip', (cs) => cs.map((c) => c.textContent)), ['NOME', 'CPF', 'VALOR']);
    assert.equal(await pagina.$eval('#lote-botao-pdf', (el) => el.disabled), true);

    const colar = (texto) => pagina.$eval('#lote-texto', (el, t2) => {
      el.value = t2;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, texto);
    await colar('Coisa\tOutra\nx\ty');
    assert.match(await pagina.$eval('#lote-erro', (el) => !el.hidden && el.textContent), /Não encontrei nenhuma coluna/);

    await colar('Nome\t[CPF:cpf]\tValor\tExtra\nAna Souza\t529.982.247-25\t1500\tx\nBia Lima\t111.111.111-11\t20\ty\nCid Reis\t52998224725\t"1.234,50"\tz');
    assert.match(await pagina.$eval('#lote-resumo', (el) => el.textContent), /3 linhas: 2 prontas, 1 com problema/);
    assert.match(await pagina.$eval('#lote-erro', (el) => el.textContent), /Coluna ignorada.*Extra/);
    assert.match(await pagina.$eval('#lote-tabela-corpo tr:nth-child(2)', (el) => el.textContent), /CPF: CPF inválido/);
    assert.equal(await pagina.$eval('#lote-botao-pdf', (el) => el.textContent.trim()), 'Gerar 2 PDFs');
    await capturar('14-lote');

    const antes = await fs.readdir(pastaDownloads);
    await pagina.click('#lote-botao-pdf');
    await esperarAviso('Lote pronto');
    const zip = await esperarDownload('zip', antes);
    assert.match(zip ?? '', /^Recibo - lote - \d{4}-\d{2}-\d{2}\.zip$/);
    const { unzipSync } = await import('fflate');
    const nomes = Object.keys(unzipSync(new Uint8Array(await fs.readFile(path.join(pastaDownloads, zip)))));
    assert.deepEqual(nomes, ['Recibo - Ana Souza.pdf', 'Recibo - Cid Reis.pdf']);
    assert.match(await pagina.$eval('#lote-resultado', (el) => !el.hidden && el.textContent), /2 documentos gerados/);
    await capturar('15-lote-pronto');
    await irPara('#/', 'tela-lista');
  });

  await t.test('avisa sobre arquivo de modelo danificado', async () => {
    await fs.writeFile(path.join(pasta, 'dados', 'modelos', 'estragado.json'), '{ quebrado');
    await irPara('#/lixeira', 'tela-lixeira');
    await irPara('#/', 'tela-lista');
    const alerta = await pagina.$eval('#alerta-ilegiveis', (el) => !el.hidden && el.textContent);
    assert.match(alerta || '', /estragado\.json/);
    await capturar('07-aviso-danificado');
  });

  await t.test('encerrar pela tela', async () => {
    await irPara('#/configuracoes', 'tela-configuracoes');
    await pagina.click('#botao-encerrar');
    await pagina.waitForSelector('#dialogo-confirmar[open]');
    await pagina.click('#dialogo-botao');
    await telaVisivel('tela-encerrado');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(encerrou, true);
  });

  assert.deepEqual(errosDaPagina, [], 'sem erros no console da página');
});
