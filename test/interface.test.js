// Teste de ponta a ponta: usa a interface de verdade no Edge/Chrome sem janela.
// Defina GERADOC_CAPTURAS=<pasta> para salvar capturas de tela de cada etapa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { criarApp } from '../src/app.js';
import { localizarNavegador } from '../src/pdf.js';

const executavel = localizarNavegador();
const pular = !executavel && 'Edge/Chrome não encontrado';

let pasta, pastaDownloads, app, servidor, url, navegador, pagina;
const errosDaPagina = [];

before(async () => {
  if (pular) return;
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'geradoc-ui-'));
  pastaDownloads = path.join(pasta, 'downloads');
  await fs.mkdir(pastaDownloads);
  app = criarApp({ pastaDados: path.join(pasta, 'dados') });
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
  await app.locals.pdf.fechar();
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

  await t.test('avisa sobre arquivo de modelo danificado', async () => {
    await fs.writeFile(path.join(pasta, 'dados', 'modelos', 'estragado.json'), '{ quebrado');
    await irPara('#/lixeira', 'tela-lixeira');
    await irPara('#/', 'tela-lista');
    const alerta = await pagina.$eval('#alerta-ilegiveis', (el) => !el.hidden && el.textContent);
    assert.match(alerta || '', /estragado\.json/);
    await capturar('07-aviso-danificado');
  });

  assert.deepEqual(errosDaPagina, [], 'sem erros no console da página');
});
