import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarCampo, localizarCampos, extrairCampos, preencherTexto, camposPendentes,
} from '../public/js/campos.js';

test('normaliza: maiúsculas, espaços nas pontas e repetidos; acentos diferenciam', () => {
  assert.equal(normalizarCampo('NoMe'), 'NOME');
  assert.equal(normalizarCampo('  nome  '), 'NOME');
  assert.equal(normalizarCampo('nome   completo'), 'NOME COMPLETO');
  assert.equal(normalizarCampo('endereço'), 'ENDEREÇO');
  assert.notEqual(normalizarCampo('endereço'), normalizarCampo('endereco'));
});

test('mesmo campo com grafias diferentes vira uma única pergunta, na ordem de aparição', () => {
  const campos = extrairCampos(['Eu, [Nome], CPF [cpf].', 'Assina: [ NOME ] em [DATA]. CPF: [CPF]']);
  assert.deepEqual(campos, [
    { chave: 'NOME', ocorrencias: 2 },
    { chave: 'CPF', ocorrencias: 2 },
    { chave: 'DATA', ocorrencias: 1 },
  ]);
});

test('ignora colchetes vazios, aninhados e campos longos demais', () => {
  assert.deepEqual(extrairCampos(['[] [   ] [[X]] [' + 'A'.repeat(81) + ']']).map((c) => c.chave), ['X']);
  assert.deepEqual(extrairCampos(['texto sem campos', '[ aberto sem fechar']), []);
});

test('localiza campo quebrado em vários pedaços (formatação no meio do campo)', () => {
  const ocorrencias = localizarCampos(['Sr. [NO', 'ME', '] e [CPF]']);
  assert.equal(ocorrencias.length, 2);
  assert.equal(ocorrencias[0].chave, 'NOME');
  assert.deepEqual(ocorrencias[0].partes, [
    { i: 0, de: 4, ate: 7 },
    { i: 1, de: 0, ate: 2 },
    { i: 2, de: 0, ate: 1 },
  ]);
  assert.deepEqual(ocorrencias[1].partes, [{ i: 2, de: 4, ate: 9 }]);
});

test('preenche todas as ocorrências; sem resposta o campo fica como está', () => {
  const r = { NOME: 'Ana', CPF: '123' };
  assert.equal(preencherTexto('[Nome] / [NOME] / [cpf] / [DATA]', r), 'Ana / Ana / 123 / [DATA]');
  // A resposta é texto literal: não é reprocessada nem interpretada.
  assert.equal(preencherTexto('[A]', { A: '[B] $& $1' }), '[B] $& $1');
});

test('respostas vazias ou só com espaços contam como pendentes', () => {
  const campos = extrairCampos(['[NOME] [CPF] [DATA]']);
  assert.deepEqual(camposPendentes(campos, { NOME: 'Ana', CPF: '   ' }), ['CPF', 'DATA']);
  assert.deepEqual(camposPendentes(campos, { NOME: 'a', CPF: 'b', DATA: 'c' }), []);
});
