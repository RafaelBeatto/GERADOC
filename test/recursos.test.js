// v1.1: configuração de página, versões, exportar/importar, histórico, sugestões, backup externo,
// proteção do servidor local e atalho. (Sem navegador — a geração real fica em documentos.test.js.)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../src/app.js';
import { criarHistorico } from '../src/historico.js';
import { sugerirPastas } from '../src/backup-externo.js';
import { validarConfig, ErroConfig, descreverPagina } from '../public/js/pagina.js';

let pasta, servidor, base, app, atalhos;

beforeEach(async () => {
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'geradoc-v11-'));
  atalhos = [];
  app = criarApp({
    pastaDados: path.join(pasta, 'dados'),
    esperaBackup: 20,
    criarAtalho: async () => { atalhos.push(Date.now()); return 'C:\\falso\\GERADOC.lnk'; },
  });
  servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

afterEach(async () => {
  app.locals.backup.cancelar();
  await app.locals.backup.parar();
  await new Promise((r) => servidor.close(r));
  await fs.rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function chamar(metodo, caminho, corpo, cabecalhos = {}) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...cabecalhos },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let dados;
  try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: r.status, dados, headers: r.headers };
}

test('configuração de página: padrão igual à v1.0, validação e mensagens claras', () => {
  const padrao = validarConfig(undefined);
  assert.deepEqual(padrao, {
    papel: 'A4', orientacao: 'retrato', margens: { superior: 2.5, inferior: 2.5, esquerda: 2.5, direita: 2.5 },
    fonte: 'Segoe UI', tamanhoFonte: 12, cabecalho: '', rodape: '', numeracao: 'nenhuma', nomeArquivo: '',
  });
  assert.equal(validarConfig({ margens: { superior: '3,5' } }).margens.superior, 3.5, 'aceita vírgula');
  assert.throws(() => validarConfig({ papel: 'A3' }), ErroConfig);
  assert.throws(() => validarConfig({ margens: { esquerda: 0.1 } }), /margem esquerda/);
  assert.throws(() => validarConfig({ papel: 'A5', margens: { esquerda: 6, direita: 6 } }), /grandes demais/);
  assert.throws(() => validarConfig({ tamanhoFonte: 40 }), /tamanho da letra/);
  assert.throws(() => validarConfig({ fonte: 'Comic Sans' }), /Fonte/);
  assert.throws(() => validarConfig({ numeracao: 'topo' }), /Numeração/);
  assert.equal(descreverPagina({ papel: 'Carta', orientacao: 'paisagem' }), 'Carta · paisagem · margens de 2,5 cm');
});

test('modelo guarda a configuração; modelo antigo (sem config) abre com o padrão', async () => {
  const config = { papel: 'Ofício', fonte: 'Arial', tamanhoFonte: 11, cabecalho: '<p>Empresa</p>', numeracao: 'centro' };
  const criado = await chamar('POST', '/modelos', { nome: 'Com config', conteudo: '<p>x</p>', config });
  assert.equal(criado.status, 201);
  assert.equal(criado.dados.config.papel, 'Ofício');
  assert.equal(criado.dados.config.cabecalho, '<p>Empresa</p>');

  const ruim = await chamar('PUT', `/modelos/${criado.dados.id}`, { nome: 'Com config', config: { papel: 'A0' } });
  assert.equal(ruim.status, 400);
  assert.match(ruim.dados.erro, /papel/);

  // Só mudar a configuração também cria versão anterior.
  await chamar('PUT', `/modelos/${criado.dados.id}`, { nome: 'Com config', config: { ...config, fonte: 'Georgia' } });
  assert.equal((await chamar('GET', `/modelos/${criado.dados.id}/versoes`)).dados.length, 1);

  const id = '11111111-2222-4333-8444-555555555555';
  await fs.writeFile(path.join(pasta, 'dados', 'modelos', `${id}.json`), JSON.stringify({ id, nome: 'Antigo', conteudo: '<p>a</p>', versaoFormato: 1 }));
  const antigo = await chamar('GET', `/modelos/${id}`);
  assert.equal(antigo.dados.config.papel, 'A4');
  assert.equal(antigo.dados.config.fonte, 'Segoe UI');
});

test('versões anteriores: lista, abre e restaura (a atual vira mais uma versão)', async () => {
  const { dados: m } = await chamar('POST', '/modelos', { nome: 'Contrato', conteudo: '<p>v1</p>' });
  await chamar('PUT', `/modelos/${m.id}`, { nome: 'Contrato novo', conteudo: '<p>v2</p>' });
  await chamar('PUT', `/modelos/${m.id}`, { nome: 'Contrato novo', conteudo: '<p>v3</p>' });

  const versoes = (await chamar('GET', `/modelos/${m.id}/versoes`)).dados;
  assert.equal(versoes.length, 2);
  assert.deepEqual(versoes.map((v) => v.nome), ['Contrato novo', 'Contrato'], 'mais recente primeiro');

  const v1 = await chamar('GET', `/modelos/${m.id}/versoes/${versoes[1].versao}`);
  assert.equal(v1.dados.conteudo, '<p>v1</p>');

  // Outro modelo pegou o nome antigo: restaura o conteúdo, mas mantém o nome atual.
  await chamar('POST', '/modelos', { nome: 'contrato', conteudo: '' });
  const r = await chamar('POST', `/modelos/${m.id}/versoes/${versoes[1].versao}/restaurar`);
  assert.equal(r.status, 200);
  assert.equal(r.dados.nomeMantido, true);
  assert.equal(r.dados.modelo.nome, 'Contrato novo');
  assert.equal((await chamar('GET', `/modelos/${m.id}`)).dados.conteudo, '<p>v1</p>');
  assert.equal((await chamar('GET', `/modelos/${m.id}/versoes`)).dados.length, 3, 'a v3 ficou guardada');

  assert.equal((await chamar('GET', `/modelos/${m.id}/versoes/../../x`)).status, 404);
  assert.equal((await chamar('GET', `/modelos/${m.id}/versoes/1234`)).status, 404);
});

test('exportar e importar: tudo ou um modelo; importar nunca substitui', async () => {
  await chamar('POST', '/modelos', { nome: 'Recibo', conteudo: '<p>[VALOR:moeda]</p>', config: { fonte: 'Arial' } });
  await chamar('POST', '/modelos', { nome: 'Declaração', conteudo: '<p>[NOME]</p>' });

  const tudo = await chamar('GET', '/exportar');
  assert.equal(tudo.status, 200);
  assert.match(tudo.headers.get('content-disposition'), /filename\*=UTF-8''GERADOC%20-%20modelos%20-%20\d{4}-\d{2}-\d{2}\.json/);
  assert.equal(tudo.dados.formato, 'geradoc-modelos');
  assert.deepEqual(tudo.dados.modelos.map((m) => m.nome), ['Declaração', 'Recibo']);
  assert.equal(tudo.dados.modelos[1].config.fonte, 'Arial');
  assert.equal(tudo.dados.modelos[0].id, undefined, 'exportação não leva o id');

  const importado = await chamar('POST', '/importar', tudo.dados);
  assert.equal(importado.status, 200);
  assert.deepEqual(importado.dados.importados.map((i) => [i.nome, i.renomeado]), [
    ['Declaração (importado)', true], ['Recibo (importado)', true],
  ]);
  const lista = (await chamar('GET', '/modelos')).dados.map((m) => m.nome);
  assert.equal(lista.length, 4);

  const um = await chamar('GET', `/modelos/${importado.dados.importados[1].id}/exportar`);
  assert.equal(um.dados.modelos.length, 1);

  // Modelo com problema é listado e os outros entram.
  const misto = await chamar('POST', '/importar', { modelos: [{ nome: '', conteudo: 'x' }, { nome: 'Novo', conteudo: '<p>a</p>', config: { papel: 'A0' } }, { nome: 'Bom' }] });
  assert.deepEqual(misto.dados.importados.map((i) => i.nome), ['Bom']);
  assert.equal(misto.dados.ignorados.length, 2);
  assert.match(misto.dados.ignorados[1].motivo, /papel/);

  assert.equal((await chamar('POST', '/importar', { qualquer: 1 })).status, 400);
  assert.equal((await chamar('POST', '/importar', { modelos: [] })).status, 400);
  const quebrado = await fetch(`${base}/importar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ quebrado' });
  assert.equal(quebrado.status, 400);
});

test('histórico: registra, lista por modelo, sugere respostas, exclui e limpa', async () => {
  const arquivo = path.join(pasta, 'hist.json');
  const historico = criarHistorico({ arquivo });
  const modelo = { id: 'm1', nome: 'Recibo' };
  const campos = [{ chave: 'NOME', automatico: false }, { chave: 'HOJE', automatico: true }];
  // Gravações simultâneas não se perdem.
  await Promise.all([
    historico.registrar({ modelo, formato: 'pdf', respostas: { NOME: 'Ana', HOJE: 'x', EXTRA: 'y' }, campos }),
    historico.registrar({ modelo, formato: 'docx', respostas: { NOME: 'Bia' }, campos }),
    historico.registrar({ modelo: { id: 'm2', nome: 'Outro' }, formato: 'pdf', respostas: { NOME: 'Ana' }, campos }),
  ]);
  const itens = await historico.listar();
  assert.equal(itens.length, 3);
  assert.deepEqual(itens.find((i) => i.formato === 'pdf' && i.modeloId === 'm1').respostas, { NOME: 'Ana' }, 'só respostas de perguntas');
  assert.equal((await historico.listar({ modeloId: 'm1' })).length, 2);
  const sugestoes = await historico.sugestoes();
  assert.deepEqual(new Set(sugestoes.NOME), new Set(['Ana', 'Bia']), 'sem repetir');

  await historico.excluir(itens[0].id);
  assert.equal((await historico.listar()).length, 2);
  await assert.rejects(historico.excluir('nao-existe'), /não encontrado/);
  assert.deepEqual(await historico.limpar(), { removidos: 2 });

  // Arquivo danificado é guardado com outro nome e o histórico recomeça.
  await fs.writeFile(arquivo, '{ quebrado');
  const novo = criarHistorico({ arquivo });
  assert.deepEqual(await novo.listar(), []);
  assert.ok((await fs.readdir(pasta)).some((a) => a.startsWith('hist.json.danificado-')));
});

test('servidor só aceita pedidos para localhost e de páginas do próprio GERADOC', async () => {
  const porta = servidor.address().port;
  const pedir = (cabecalhos, metodo = 'GET') => new Promise((resolver, rejeitar) => {
    const req = http.request({ host: '127.0.0.1', port: porta, path: '/api/modelos', method: metodo, headers: cabecalhos }, (res) => {
      res.resume();
      resolver(res.statusCode);
    });
    req.on('error', rejeitar);
    req.end();
  });
  assert.equal(await pedir({ Host: `localhost:${porta}` }), 200);
  assert.equal(await pedir({ Host: `127.0.0.1:${porta}` }), 200);
  assert.equal(await pedir({ Host: 'site-malicioso.com' }), 403, 'DNS rebinding');
  assert.equal(await pedir({ Host: `localhost:${porta}`, Origin: 'https://site-malicioso.com' }, 'DELETE'), 403);
  assert.equal(await pedir({ Host: `localhost:${porta}`, Origin: 'null' }, 'POST'), 403);
  assert.equal(await pedir({ Host: `localhost:${porta}`, Origin: `http://localhost:${porta}` }), 200);
});

test('backup externo: valida a pasta, copia tudo e não apaga nada do destino', async () => {
  const destino = path.join(pasta, 'nuvem');
  await fs.mkdir(destino);

  assert.equal((await chamar('PUT', '/configuracoes/backup', { pasta: 'relativa' })).status, 400);
  assert.match((await chamar('PUT', '/configuracoes/backup', { pasta: path.join(pasta, 'nao-existe') })).dados.erro, /não encontrada/);
  assert.match((await chamar('PUT', '/configuracoes/backup', { pasta: path.join(pasta, 'dados', 'modelos') })).dados.erro, /dentro da pasta de dados/);
  assert.match((await chamar('POST', '/backup-externo')).dados.erro, /Escolha antes/);

  const { dados: m } = await chamar('POST', '/modelos', { nome: 'Recibo', conteudo: '<p>a</p>' });
  const ligado = await chamar('PUT', '/configuracoes/backup', { pasta: destino });
  assert.equal(ligado.status, 200);
  assert.equal(ligado.dados.backupExterno.pasta, destino);
  assert.equal(ligado.dados.backupExterno.ultimoErro, null);
  assert.ok(ligado.dados.backupExterno.ultimoEm);
  const copia = path.join(destino, 'GERADOC-backup');
  assert.ok(await fs.stat(path.join(copia, 'modelos', `${m.id}.json`)));
  assert.ok(await fs.stat(path.join(copia, 'LEIA-ME.txt')));

  // Alteração dispara cópia automática (alguns ms depois, neste teste).
  const { dados: m2 } = await chamar('POST', '/modelos', { nome: 'Outro', conteudo: '' });
  await chamar('DELETE', `/modelos/${m.id}`);
  for (let i = 0; i < 50; i += 1) {
    try { await fs.stat(path.join(copia, 'lixeira', `${m.id}.json`)); break; } catch { await new Promise((r) => setTimeout(r, 40)); }
  }
  await app.locals.backup.parar();
  assert.ok(await fs.stat(path.join(copia, 'modelos', `${m2.id}.json`)));
  assert.ok(await fs.stat(path.join(copia, 'lixeira', `${m.id}.json`)));
  assert.ok(await fs.stat(path.join(copia, 'modelos', `${m.id}.json`)), 'o excluído continua no backup externo');

  const agora = await chamar('POST', '/backup-externo');
  assert.equal(agora.status, 200);

  // Pasta sumiu (pendrive desconectado): erro claro no status, sem derrubar nada.
  await fs.rm(destino, { recursive: true, force: true });
  await fs.writeFile(destino, 'agora é arquivo');
  const falhou = await chamar('POST', '/backup-externo');
  assert.match(falhou.dados.backupExterno.ultimoErro, /Não foi possível copiar/);

  const desligado = await chamar('PUT', '/configuracoes/backup', { pasta: '' });
  assert.equal(desligado.dados.backupExterno.pasta, null);
});

test('sugere OneDrive e Google Drive que existirem', () => {
  const existe = (p) => ['C:\\Users\\Ana\\OneDrive', 'G:\\Meu Drive'].includes(p);
  assert.deepEqual(sugerirPastas({ OneDrive: 'C:\\Users\\Ana\\OneDrive', OneDriveConsumer: 'C:\\Users\\Ana\\OneDrive' }, existe), [
    { rotulo: 'OneDrive', pasta: 'C:\\Users\\Ana\\OneDrive' },
    { rotulo: 'Google Drive', pasta: 'G:\\Meu Drive' },
  ]);
});

test('atalho e encerrar', { skip: process.platform !== 'win32' && 'só Windows' }, async () => {
  const r = await chamar('POST', '/atalho');
  assert.equal(r.status, 200);
  assert.equal(atalhos.length, 1);
  assert.equal((await chamar('GET', '/saude')).dados.podeEncerrar, false);
  assert.equal((await chamar('POST', '/encerrar')).status, 400, 'sem aoEncerrar não encerra');
});
