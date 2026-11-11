import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarCampo, localizarCampos, extrairCampos, preencherTexto, camposPendentes, analisarCampo,
  formatarValor, validarResposta, camposInvalidos, inteiroPorExtenso, moedaPorExtenso, numeroPorExtenso,
  lerNumero, lerData, completarRespostas, mapaDeTipos,
} from '../public/js/campos.js';

const resumo = (campos) => campos.map(({ chave, ocorrencias }) => ({ chave, ocorrencias }));

test('normaliza: maiúsculas, espaços nas pontas e repetidos; acentos diferenciam', () => {
  assert.equal(normalizarCampo('NoMe'), 'NOME');
  assert.equal(normalizarCampo('  nome  '), 'NOME');
  assert.equal(normalizarCampo('nome   completo'), 'NOME COMPLETO');
  assert.equal(normalizarCampo('endereço'), 'ENDEREÇO');
  assert.notEqual(normalizarCampo('endereço'), normalizarCampo('endereco'));
});

test('mesmo campo com grafias diferentes vira uma única pergunta, na ordem de aparição', () => {
  const campos = extrairCampos(['Eu, [Nome], CPF [cpf].', 'Assina: [ NOME ] em [DATA]. CPF: [CPF]']);
  assert.deepEqual(resumo(campos), [
    { chave: 'NOME', ocorrencias: 2 },
    { chave: 'CPF', ocorrencias: 2 },
    { chave: 'DATA', ocorrencias: 1 },
  ]);
  assert.ok(campos.every((c) => c.tipo === 'texto' && !c.automatico), 'sem formato = texto');
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

// ---------------- v1.1: tipos de campo ----------------

test('formato depois dos dois-pontos: não muda o nome; formato desconhecido faz parte do nome', () => {
  assert.deepEqual(analisarCampo('Valor : Moeda'), { chave: 'VALOR', formato: 'moeda' });
  assert.deepEqual(analisarCampo('data:data extenso'), { chave: 'DATA', formato: 'data-extenso' });
  assert.deepEqual(analisarCampo('OBS: livre'), { chave: 'OBS: LIVRE', formato: null });
  assert.deepEqual(analisarCampo(':cpf'), { chave: ':CPF', formato: null });
});

test('[VALOR:moeda] e [VALOR:extenso] são uma pergunta só, do tipo moeda', () => {
  const campos = extrairCampos(['Pago [VALOR:moeda] ([valor:extenso]) em [DATA:data] por [CPF:cpf]. Hoje: [HOJE:extenso]']);
  assert.deepEqual(campos.map((c) => [c.chave, c.tipo, c.ocorrencias, c.automatico]), [
    ['VALOR', 'moeda', 2, false],
    ['DATA', 'data', 1, false],
    ['CPF', 'cpf', 1, false],
    ['HOJE', 'data', 1, true],
  ]);
  assert.deepEqual(campos[0].formatos, ['moeda', 'extenso']);
  assert.deepEqual(camposPendentes(campos, {}), ['VALOR', 'DATA', 'CPF'], '[HOJE] não é pergunta');
  assert.equal(extrairCampos(['[N:numero] [N:extenso]'])[0].tipo, 'numero');
  assert.equal(extrairCampos(['[X:extenso]'])[0].tipo, 'moeda');
});

test('preenche com formatação conforme o tipo', () => {
  const texto = '[VALOR:moeda] ([VALOR:extenso]) em [DATA:data] / [DATA:data-extenso] — [CPF:cpf] / [CPF] — [nome:maiusculas] [HOJE] [HOJE:extenso]';
  const tipos = mapaDeTipos(extrairCampos([texto]));
  const respostas = completarRespostas({ VALOR: '1.500,50', DATA: '2026-11-01', CPF: '52998224725', NOME: 'José da Silva' }, new Date(2026, 10, 11));
  assert.equal(preencherTexto(texto, respostas, tipos),
    'R$ 1.500,50 (mil e quinhentos reais e cinquenta centavos) em 01/11/2026 / 1º de novembro de 2026 — 529.982.247-25 / 529.982.247-25 — JOSÉ DA SILVA 11/11/2026 11 de novembro de 2026');
});

test('números por extenso', () => {
  const casos = {
    0: 'zero', 1: 'um', 10: 'dez', 15: 'quinze', 21: 'vinte e um', 100: 'cem', 101: 'cento e um',
    110: 'cento e dez', 999: 'novecentos e noventa e nove', 1000: 'mil', 1001: 'mil e um', 1100: 'mil e cem',
    1250: 'mil, duzentos e cinquenta', 2000: 'dois mil', 21000: 'vinte e um mil', 100000: 'cem mil',
    1000000: 'um milhão', 2500000: 'dois milhões e quinhentos mil', 1000001: 'um milhão e um',
    1234567: 'um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete',
    3000000000: 'três bilhões',
  };
  for (const [n, esperado] of Object.entries(casos)) assert.equal(inteiroPorExtenso(Number(n)), esperado, n);
});

test('valores em reais por extenso', () => {
  assert.equal(moedaPorExtenso(1), 'um real');
  assert.equal(moedaPorExtenso(0), 'zero reais');
  assert.equal(moedaPorExtenso(0.01), 'um centavo');
  assert.equal(moedaPorExtenso(0.5), 'cinquenta centavos');
  assert.equal(moedaPorExtenso(1.99), 'um real e noventa e nove centavos');
  assert.equal(moedaPorExtenso(1500), 'mil e quinhentos reais');
  assert.equal(moedaPorExtenso(1000000), 'um milhão de reais');
  assert.equal(moedaPorExtenso(2000000.1), 'dois milhões de reais e dez centavos');
  assert.equal(moedaPorExtenso(1500000), 'um milhão e quinhentos mil reais');
  assert.equal(numeroPorExtenso(3.25), 'três vírgula vinte e cinco');
  assert.equal(numeroPorExtenso(2.05), 'dois vírgula zero cinco');
});

test('lê números e datas no padrão brasileiro', () => {
  assert.equal(lerNumero('1.500,50'), 1500.5);
  assert.equal(lerNumero('R$ 1.500'), 1500);
  assert.equal(lerNumero('1500.5'), 1500.5);
  assert.equal(lerNumero('1,5'), 1.5);
  assert.equal(lerNumero('-10'), -10);
  for (const ruim of ['', 'abc', '1,2,3', '15.00.0', '1.50.000']) assert.equal(lerNumero(ruim), null, ruim);
  assert.deepEqual(lerData('2026-02-28'), { d: 28, m: 2, a: 2026 });
  assert.deepEqual(lerData('5/3/2026'), { d: 5, m: 3, a: 2026 });
  assert.equal(lerData('2026-02-30'), null);
  assert.equal(lerData('31/04/2026'), null);
});

test('valida respostas conforme o tipo', () => {
  assert.equal(validarResposta('cpf', '529.982.247-25'), null);
  assert.equal(validarResposta('cpf', '123.456.789-00'), 'CPF inválido');
  assert.equal(validarResposta('cpf', '111.111.111-11'), 'CPF inválido');
  assert.equal(validarResposta('cnpj', '11.222.333/0001-81'), null);
  assert.equal(validarResposta('cnpj', '11.222.333/0001-80'), 'CNPJ inválido');
  assert.equal(validarResposta('cep', '01310-100'), null);
  assert.match(validarResposta('cep', '0131'), /8 números/);
  assert.equal(validarResposta('telefone', '(11) 98765-4321'), null);
  assert.equal(validarResposta('data', '2026-13-01'), 'data inválida');
  assert.equal(validarResposta('moeda', 'mil'), 'número inválido');
  assert.equal(validarResposta('moeda', '1e3'), 'número inválido');
  assert.equal(validarResposta('texto', 'qualquer coisa'), null);
  assert.equal(validarResposta('cpf', '   '), null, 'vazio é "pendente", não "inválido"');

  const campos = extrairCampos(['[CPF:cpf] [V:moeda] [HOJE] [NOME]']);
  assert.deepEqual(camposInvalidos(campos, { CPF: '1', V: '10', NOME: 'x' }), [{ chave: 'CPF', mensagem: 'CPF inválido' }]);
});

test('resposta que não dá para formatar sai como foi digitada', () => {
  assert.equal(formatarValor('abc', 'moeda', 'moeda'), 'abc');
  assert.equal(formatarValor('12', 'cpf', 'cpf'), '12');
  assert.equal(formatarValor('  Ana ', null, 'texto'), '  Ana ');
  assert.equal(formatarValor('2026-11-11', 'extenso', 'data'), '11 de novembro de 2026');
  assert.equal(formatarValor('1234,5', 'numero', 'numero'), '1.234,5');
  assert.equal(formatarValor('11987654321', 'telefone', 'telefone'), '(11) 98765-4321');
  assert.equal(formatarValor('12345678000195', 'cnpj', 'cnpj'), '12.345.678/0001-95');
});
