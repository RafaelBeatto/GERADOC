import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../src/app.js';

let pasta, servidor, base;

beforeEach(async () => {
  pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'geradoc-teste-'));
  servidor = criarApp({ pastaDados: pasta }).listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;
});

afterEach(async () => {
  await new Promise((r) => servidor.close(r));
  await fs.rm(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function chamar(metodo, caminho, corpo) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: r.status, dados: await r.json() };
}

test('cria, lista, obtém, edita e exclui um modelo', async () => {
  const conteudo = '<p>Eu, <strong>[NOME]</strong>, CPF [CPF].</p>';
  const criado = await chamar('POST', '/modelos', { nome: '  Declaração   simples ', conteudo });
  assert.equal(criado.status, 201);
  assert.equal(criado.dados.nome, 'Declaração simples');
  assert.equal(criado.dados.conteudo, conteudo);

  const arquivo = path.join(pasta, 'modelos', `${criado.dados.id}.json`);
  assert.equal(JSON.parse(await fs.readFile(arquivo, 'utf8')).nome, 'Declaração simples');

  const lista = await chamar('GET', '/modelos');
  assert.deepEqual(lista.dados.map((m) => m.nome), ['Declaração simples']);
  assert.equal(lista.dados[0].conteudo, undefined, 'listagem não traz o conteúdo');

  const obtido = await chamar('GET', `/modelos/${criado.dados.id}`);
  assert.equal(obtido.dados.conteudo, conteudo);

  const editado = await chamar('PUT', `/modelos/${criado.dados.id}`, { nome: 'Declaração', conteudo: '<p>[DATA]</p>' });
  assert.equal(editado.status, 200);
  assert.equal(editado.dados.conteudo, '<p>[DATA]</p>');
  assert.equal(editado.dados.criadoEm, criado.dados.criadoEm);

  const excluido = await chamar('DELETE', `/modelos/${criado.dados.id}`);
  assert.equal(excluido.status, 200);
  assert.deepEqual((await chamar('GET', '/modelos')).dados, []);

  // Excluir nunca apaga: vai para a lixeira com a data da exclusão.
  const naLixeira = JSON.parse(await fs.readFile(path.join(pasta, 'lixeira', `${criado.dados.id}.json`), 'utf8'));
  assert.equal(naLixeira.nome, 'Declaração');
  assert.ok(naLixeira.excluidoEm);
});

test('nome é obrigatório e limitado', async () => {
  assert.equal((await chamar('POST', '/modelos', { nome: '   ', conteudo: '' })).status, 400);
  assert.equal((await chamar('POST', '/modelos', {})).status, 400);
  assert.equal((await chamar('POST', '/modelos', { nome: 'x'.repeat(121) })).status, 400);
  assert.equal((await chamar('POST', '/modelos', { nome: 'ok', conteudo: 123 })).status, 400);
});

test('não permite dois modelos com o mesmo nome (ignora maiúsculas)', async () => {
  const a = await chamar('POST', '/modelos', { nome: 'Contrato' });
  assert.equal((await chamar('POST', '/modelos', { nome: 'CONTRATO' })).status, 409);
  const b = await chamar('POST', '/modelos', { nome: 'Recibo' });
  assert.equal((await chamar('PUT', `/modelos/${b.dados.id}`, { nome: 'contrato' })).status, 409);
  // Renomear o próprio modelo para a mesma grafia é permitido.
  assert.equal((await chamar('PUT', `/modelos/${a.dados.id}`, { nome: 'contrato' })).status, 200);
});

test('lista em ordem alfabética', async () => {
  for (const nome of ['recibo', 'Árvore', 'Contrato', 'aluguel']) await chamar('POST', '/modelos', { nome });
  const { dados } = await chamar('GET', '/modelos');
  assert.deepEqual(dados.map((m) => m.nome), ['aluguel', 'Árvore', 'Contrato', 'recibo']);
});

test('ids inválidos ou inexistentes retornam 404 (sem acesso a outros arquivos)', async () => {
  assert.equal((await chamar('GET', '/modelos/..%2F..%2Fpackage')).status, 404);
  assert.equal((await chamar('GET', '/modelos/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await chamar('DELETE', '/modelos/00000000-0000-0000-0000-000000000000')).status, 404);
  assert.equal((await chamar('PUT', '/modelos/abc', { nome: 'x' })).status, 404);
});

test('arquivo corrompido é ignorado na lista, informado no diagnóstico e não é apagado', async () => {
  await chamar('POST', '/modelos', { nome: 'Bom' });
  const ruim = path.join(pasta, 'modelos', 'corrompido.json');
  await fs.writeFile(ruim, '{ isto não é json');
  const { dados } = await chamar('GET', '/modelos');
  assert.deepEqual(dados.map((m) => m.nome), ['Bom']);
  assert.deepEqual((await chamar('GET', '/diagnostico')).dados, { modelosIlegiveis: ['corrompido.json'], lixeiraIlegiveis: [] });
  await fs.access(ruim);
});

test('modelo com arquivo danificado: abre com erro claro (não 500 genérico) e nada é apagado', async () => {
  const { dados: m } = await chamar('POST', '/modelos', { nome: 'Vai quebrar' });
  const arquivo = path.join(pasta, 'modelos', `${m.id}.json`);
  await fs.writeFile(arquivo, '{"id": "trunc');
  const r = await chamar('GET', `/modelos/${m.id}`);
  assert.equal(r.status, 500);
  assert.match(r.dados.erro, /danificado/);
  assert.equal((await chamar('DELETE', `/modelos/${m.id}`)).status, 500);
  await fs.access(arquivo);
});

test('arquivo cujo id não bate com o nome do arquivo é ignorado (cópia manual)', async () => {
  const { dados: m } = await chamar('POST', '/modelos', { nome: 'Original' });
  const conteudo = await fs.readFile(path.join(pasta, 'modelos', `${m.id}.json`), 'utf8');
  await fs.writeFile(path.join(pasta, 'modelos', 'copia de seguranca.json'), conteudo);
  assert.deepEqual((await chamar('GET', '/modelos')).dados.map((x) => x.nome), ['Original']);
});

test('salvar guarda a versão anterior em dados/backup e mantém só as 20 mais recentes', async () => {
  const { dados: m } = await chamar('POST', '/modelos', { nome: 'Contrato', conteudo: '<p>v0</p>' });
  const pastaBackup = path.join(pasta, 'backup', m.id);

  // Salvar sem mudança nenhuma não gera backup.
  await chamar('PUT', `/modelos/${m.id}`, { nome: 'Contrato', conteudo: '<p>v0</p>' });
  assert.deepEqual(await fs.readdir(pastaBackup).catch(() => []), []);

  await chamar('PUT', `/modelos/${m.id}`, { nome: 'Contrato', conteudo: '<p>v1</p>' });
  let copias = (await fs.readdir(pastaBackup)).sort();
  assert.equal(copias.length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(pastaBackup, copias[0]), 'utf8')).conteudo, '<p>v0</p>');

  for (let i = 2; i <= 25; i += 1) await chamar('PUT', `/modelos/${m.id}`, { nome: 'Contrato', conteudo: `<p>v${i}</p>` });
  copias = (await fs.readdir(pastaBackup)).sort();
  assert.equal(copias.length, 20);
  const maisNova = JSON.parse(await fs.readFile(path.join(pastaBackup, copias.at(-1)), 'utf8'));
  assert.equal(maisNova.conteudo, '<p>v24</p>');
});

test('não deixa arquivos temporários para trás e limpa temporários órfãos antigos', async () => {
  await chamar('POST', '/modelos', { nome: 'A' });
  const pastaModelos = path.join(pasta, 'modelos');
  assert.deepEqual((await fs.readdir(pastaModelos)).filter((a) => a.endsWith('.tmp')), []);

  // Simula uma gravação interrompida há 2 horas e reinicia o servidor.
  const orfao = path.join(pastaModelos, 'x.json.123.tmp');
  const recente = path.join(pastaModelos, 'y.json.456.tmp');
  await fs.writeFile(orfao, '{');
  await fs.writeFile(recente, '{');
  const duasHorasAtras = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(orfao, duasHorasAtras, duasHorasAtras);
  await new Promise((r) => servidor.close(r));
  servidor = criarApp({ pastaDados: pasta }).listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}/api`;

  assert.equal((await chamar('GET', '/modelos')).dados.length, 1);
  await assert.rejects(fs.access(orfao));
  await fs.access(recente); // recente pode ser uma gravação em andamento: não mexe
});

test('duplicar cria "(cópia)", "(cópia 2)"… com o mesmo conteúdo', async () => {
  const { dados: m } = await chamar('POST', '/modelos', { nome: 'Recibo', conteudo: '<p>[VALOR]</p>' });
  const c1 = await chamar('POST', `/modelos/${m.id}/duplicar`);
  assert.equal(c1.status, 201);
  assert.equal(c1.dados.nome, 'Recibo (cópia)');
  assert.equal(c1.dados.conteudo, '<p>[VALOR]</p>');
  assert.notEqual(c1.dados.id, m.id);
  assert.equal((await chamar('POST', `/modelos/${m.id}/duplicar`)).dados.nome, 'Recibo (cópia 2)');
  assert.equal((await chamar('POST', '/modelos/00000000-0000-0000-0000-000000000000/duplicar')).status, 404);

  // Nome no limite: o nome base é encurtado para caber o sufixo.
  const { dados: longo } = await chamar('POST', '/modelos', { nome: 'L'.repeat(120) });
  const copia = await chamar('POST', `/modelos/${longo.id}/duplicar`);
  assert.equal(copia.status, 201);
  assert.equal(copia.dados.nome.length, 120);
  assert.ok(copia.dados.nome.endsWith(' (cópia)'));
});

test('lixeira: lista, restaura (renomeando se o nome estiver em uso) e exclui definitivamente', async () => {
  const { dados: a } = await chamar('POST', '/modelos', { nome: 'Contrato', conteudo: '<p>A</p>' });
  const { dados: b } = await chamar('POST', '/modelos', { nome: 'Recibo' });
  await chamar('DELETE', `/modelos/${a.id}`);
  await chamar('DELETE', `/modelos/${b.id}`);

  const lixeira = (await chamar('GET', '/lixeira')).dados;
  assert.deepEqual(lixeira.map((m) => m.nome), ['Recibo', 'Contrato'], 'mais recente primeiro');
  assert.ok(lixeira[0].excluidoEm);
  assert.equal(lixeira[0].conteudo, undefined);

  // Restaurar simples.
  const r1 = await chamar('POST', `/lixeira/${a.id}/restaurar`);
  assert.equal(r1.status, 200);
  assert.equal(r1.dados.renomeado, false);
  const restaurado = (await chamar('GET', `/modelos/${a.id}`)).dados;
  assert.equal(restaurado.conteudo, '<p>A</p>');
  assert.equal(restaurado.excluidoEm, undefined);
  assert.equal(restaurado.criadoEm, a.criadoEm);
  assert.equal((await chamar('POST', `/lixeira/${a.id}/restaurar`)).status, 404);

  // Restaurar com nome já usado por outro modelo.
  await chamar('POST', '/modelos', { nome: 'RECIBO' });
  const r2 = await chamar('POST', `/lixeira/${b.id}/restaurar`);
  assert.equal(r2.dados.nome, 'Recibo (restaurado)');
  assert.equal(r2.dados.renomeado, true);

  // Excluir definitivamente: sai da lixeira, mas fica uma última cópia em dados/backup.
  await chamar('DELETE', `/modelos/${b.id}`);
  const d = await chamar('DELETE', `/lixeira/${b.id}`);
  assert.equal(d.status, 200);
  assert.deepEqual((await chamar('GET', '/lixeira')).dados, []);
  const copias = await fs.readdir(path.join(pasta, 'backup', b.id));
  assert.equal(copias.length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(pasta, 'backup', b.id, copias[0]), 'utf8')).nome, 'Recibo (restaurado)');
  assert.equal((await chamar('DELETE', `/lixeira/${b.id}`)).status, 404);
  assert.equal((await chamar('DELETE', '/lixeira/..%2F..%2Fpackage')).status, 404);
});
