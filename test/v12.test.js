// v1.2: condições [SE …], contas [=…], opções, opcionais, formatos novos, planilha do lote e .zip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  extrairCampos, preencherTexto, camposPendentes, camposInvalidos, camposAtivos, completarRespostas,
  mapaDeTipos, formatarValor, validarResposta, localizarCampos, verdadeiro,
} from '../public/js/campos.js';
import { lerTabela, linhasParaRespostas, gerarCsv, detectarSeparador, chaveDaColuna, decodificarArquivo } from '../public/js/tabela.js';
import { montarZip, nomeSemRepetir, crc32 } from '../src/zip.js';
import { nomeDocumento, limparNomeArquivo } from '../src/gerador.js';
import { validarConfig } from '../public/js/pagina.js';

const descrever = (campos) => Object.fromEntries(campos.map((c) => [c.chave, c.tipo + (c.opcional ? '?' : '')]));

/** Preenche um texto como o gerador faz: completa as respostas e usa tipos/opcionais do próprio texto. */
function gerar(texto, respostas, agora = new Date(2026, 10, 11)) {
  const campos = extrairCampos([texto]);
  const completas = completarRespostas(respostas, agora, campos);
  return preencherTexto(texto, completas, mapaDeTipos(campos), campos.filter((c) => c.opcional).map((c) => c.chave));
}

test('formatos novos: nome próprio, minúsculas, partes da data, hora, e-mail, porcento, sim/não', () => {
  assert.equal(formatarValor('MARIA DA SILVA e souza', 'nome'), 'Maria da Silva e Souza');
  assert.equal(formatarValor("ana d'ávila", 'nome'), "Ana D'Ávila");
  assert.equal(formatarValor('ABC', 'minusculas'), 'abc');
  assert.equal(formatarValor('2026-11-11', 'dia'), '11');
  assert.equal(formatarValor('2026-11-11', 'mes'), 'novembro');
  assert.equal(formatarValor('2026-11-11', 'ano'), '2026');
  assert.equal(formatarValor('2026-11-11', 'dia-semana'), 'quarta-feira');
  assert.equal(formatarValor('9h', 'hora'), '09:00');
  assert.equal(formatarValor('14h30', 'hora'), '14:30');
  assert.equal(formatarValor(' Ana@Exemplo.COM ', 'email'), 'ana@exemplo.com');
  assert.equal(formatarValor('12,5', 'porcento'), '12,5%');
  assert.equal(formatarValor('sim', 'sim-nao'), 'Sim');
  assert.equal(formatarValor('não', 'sim-nao'), 'Não');
  assert.equal(validarResposta('email', 'ana@'), 'e-mail inválido');
  assert.equal(validarResposta('email', 'ana@x.com'), null);
  assert.equal(validarResposta('hora', '25:00'), 'hora inválida (use 14:30)');
  assert.equal(validarResposta('hora', '23:59'), null);
  assert.ok(verdadeiro('Sim') && verdadeiro('x') && !verdadeiro('NÃO') && !verdadeiro('') && !verdadeiro('0'));
});

test('lista de opções: [X: a | b | c] vira pergunta de escolha e só aceita uma das opções', () => {
  const campos = extrairCampos(['Estado civil: [EC: solteiro | casado | União Estável] e de novo [EC].']);
  assert.equal(campos.length, 1);
  assert.equal(campos[0].tipo, 'opcoes');
  assert.deepEqual(campos[0].opcoes, ['solteiro', 'casado', 'União Estável']);
  assert.equal(campos[0].ocorrencias, 2);
  assert.deepEqual(camposInvalidos(campos, { EC: 'divorciado' }).map((i) => i.chave), ['EC']);
  assert.deepEqual(camposInvalidos(campos, { EC: 'CASADO' }), []);
  assert.equal(gerar('[EC: solteiro | casado]!', { EC: 'casado' }), 'casado!');
  // Dois-pontos sem formato conhecido e sem "|" continua sendo parte do nome (regra da v1.1).
  assert.equal(extrairCampos(['[OBS: livre]'])[0].chave, 'OBS: LIVRE');
});

test('opcional: pode ficar sem resposta e some do documento', () => {
  const texto = 'Rua [RUA][COMPL:opcional], tel. [TEL:telefone opcional].';
  const campos = extrairCampos([texto]);
  assert.deepEqual(descrever(campos), { RUA: 'texto', COMPL: 'texto?', TEL: 'telefone?' });
  assert.deepEqual(camposPendentes(campos, {}), ['RUA']);
  assert.equal(gerar(texto, { RUA: 'A' }), 'Rua A, tel. .');
  assert.equal(gerar(texto, { RUA: 'A', COMPL: ' ap 2', TEL: '11987654321' }), 'Rua A ap 2, tel. (11) 98765-4321.');
  // Opcional preenchido ainda é validado.
  assert.deepEqual(camposInvalidos(campos, { TEL: '123' }).map((i) => i.chave), ['TEL']);
});

test('[SE]…[SENÃO]…[FIM SE]: mostra o trecho certo; marcador sem par continua sendo campo', () => {
  const texto = 'A[SE TEM FIADOR] com fiador [FIADOR][SENÃO] sem fiador[FIM SE].';
  const campos = extrairCampos([texto]);
  assert.deepEqual(descrever(campos), { 'TEM FIADOR': 'sim-nao', FIADOR: 'texto' });
  assert.equal(gerar(texto, { 'TEM FIADOR': 'sim', FIADOR: 'Zé' }), 'A com fiador Zé.');
  assert.equal(gerar(texto, {}), 'A sem fiador.');
  assert.equal(gerar('x[SE NÃO A]sem a[FIM SE]', {}), 'xsem a');
  assert.equal(gerar('x[SE NÃO A]sem a[FIM SE]', { A: 'sim' }), 'x');
  assert.equal(gerar('[se a]1[senao]2[fim se] [SE A]3[CASO CONTRÁRIO]4[FIMSE]', { A: 'sim' }), '1 3', 'maiúsculas e grafias');

  // Sem [FIM SE], "[SE X]" é um campo comum chamado "SE X" (modelos antigos não mudam).
  const antigo = extrairCampos(['[FIM SE] Valor [SE HOUVER] e [SENÃO]']);
  assert.deepEqual(antigo.map((c) => c.chave), ['FIM SE', 'SE HOUVER', 'SENÃO']);
  assert.deepEqual(localizarCampos(['[SE X] [NOME]']).map((o) => o.chave), ['SE X', 'NOME']);
});

test('perguntas de trechos escondidos não são obrigatórias; aninhamento', () => {
  const texto = '[NOME][SE CASADO] casado com [CONJUGE][SE TEM FILHOS], filhos: [FILHOS][FIM SE][FIM SE].';
  const campos = extrairCampos([texto]);
  const pendentes = (r) => {
    const completas = completarRespostas(r, new Date(), campos);
    return camposPendentes(campos, completas, camposAtivos([texto], completas));
  };
  assert.deepEqual(pendentes({}), ['NOME']);
  assert.deepEqual(pendentes({ NOME: 'a', CASADO: 'sim' }), ['CONJUGE']);
  assert.deepEqual(pendentes({ NOME: 'a', CASADO: 'sim', 'TEM FILHOS': 'sim' }), ['CONJUGE', 'FILHOS']);
  assert.deepEqual(pendentes({ NOME: 'a', 'TEM FILHOS': 'sim' }), [], 'filhos está dentro de casado');
  assert.equal(gerar(texto, { NOME: 'Ana', CASADO: 'sim', CONJUGE: 'Zé', 'TEM FILHOS': 'sim', FILHOS: '2' }), 'Ana casado com Zé, filhos: 2.');
  assert.equal(gerar(texto, { NOME: 'Ana', FILHOS: '2', 'TEM FILHOS': 'sim' }), 'Ana.');
  // Resposta inválida num trecho escondido não impede gerar.
  const c2 = extrairCampos(['[SE PJ][CNPJ:cnpj][FIM SE]']);
  const r2 = completarRespostas({ CNPJ: '123' }, new Date(), c2);
  assert.deepEqual(camposInvalidos(c2, r2, camposAtivos(['[SE PJ][CNPJ:cnpj][FIM SE]'], r2)), []);
});

test('condições com comparação: =, ≠, >, datas; o campo só de condição vira lista de opções', () => {
  const texto = '[SE EC = casado | união estável]cônjuge: [CONJUGE][FIM SE][SE VALOR >= 1000] alto[SENÃO] baixo[FIM SE] [VALOR:moeda]';
  const campos = extrairCampos([texto]);
  assert.deepEqual(descrever(campos), { EC: 'opcoes', CONJUGE: 'texto', VALOR: 'moeda' });
  assert.deepEqual(campos[0].opcoes, ['casado', 'união estável']);
  assert.equal(gerar(texto, { EC: 'União Estável', CONJUGE: 'Zé', VALOR: '1.000,00' }), 'cônjuge: Zé alto R$ 1.000,00');
  assert.equal(gerar(texto, { EC: 'solteiro', VALOR: '999,99' }), ' baixo R$ 999,99');
  assert.equal(gerar('[SE EC != casado]não casado[FIM SE]', { EC: 'viúvo' }), 'não casado');
  assert.equal(gerar('[D:data][SE D < 01/01/2026] antiga[FIM SE]', { D: '2025-12-31' }), '31/12/2025 antiga');
  assert.equal(gerar('[D:data][SE D < 01/01/2026] antiga[FIM SE]', { D: '2026-01-01' }), '01/01/2026');
});

test('"[SE X]…[X]…[FIM SE]": o campo fica opcional (a condição pergunta se foi preenchido)', () => {
  const texto = 'Rua A[SE COMPL], [COMPL][FIM SE].';
  const campos = extrairCampos([texto]);
  assert.deepEqual(descrever(campos), { COMPL: 'texto?' });
  assert.equal(gerar(texto, {}), 'Rua A.');
  assert.equal(gerar(texto, { COMPL: 'ap 2' }), 'Rua A, ap 2.');
});

test('contas: números, moeda, porcentagem e formato do resultado', () => {
  const texto = '[VALOR:moeda] x [QTD] = [=VALOR * QTD] ([=VALOR*QTD:extenso]); multa [=VALOR * 10%]; média [=(A + B) / 2]; [=QTD - 1:numero-extenso]';
  const campos = extrairCampos([texto]);
  assert.deepEqual(descrever(campos), { VALOR: 'moeda', QTD: 'numero', A: 'numero', B: 'numero' });
  assert.equal(gerar(texto, { VALOR: '1.500,50', QTD: '3', A: '7', B: '8' }),
    'R$ 1.500,50 x 3 = R$ 4.501,50 (quatro mil, quinhentos e um reais e cinquenta centavos); multa R$ 150,05; média 7,5; dois');
  // Conta sem as respostas (ou impossível) fica como está: o gerador recusa em vez de imprimir errado.
  assert.equal(gerar('[=A / B]', { A: '1', B: '0' }), '[=A / B]');
  assert.equal(gerar('[=A + B]', { A: '1' }), '[=A + B]');
  // "[=" que não é conta continua sendo um campo comum.
  assert.deepEqual(extrairCampos(['[=== aviso ===]']).map((c) => c.chave), ['=== AVISO ===']);
  assert.equal(gerar('[= 2 + 3 * 4 ]', {}), '14');
  assert.equal(gerar('[=1.000,5 + 0,5]', {}), '1.001');
});

test('contas com datas: prazos em dias, meses e anos; diferença em dias; fim de mês', () => {
  const texto = 'de [INICIO:data] a [=INICIO + PRAZO meses], [=INICIO + 12 meses:data-extenso], [=INICIO + 10 dias], [=INICIO - 1 ano:ano], [=FIM - INICIO] dias [FIM:data]';
  const campos = extrairCampos([texto]);
  assert.deepEqual(descrever(campos), { INICIO: 'data', PRAZO: 'numero', FIM: 'data' });
  assert.equal(gerar(texto, { INICIO: '2026-01-31', PRAZO: '1', FIM: '2026-03-01' }),
    'de 31/01/2026 a 28/02/2026, 31 de janeiro de 2027, 10/02/2026, 2025, 29 dias 01/03/2026');
  assert.equal(gerar('[=HOJE + 30 dias] [=HOJE + 1 mês:data-extenso] [=HOJE:dia-semana]', {}), '11/12/2026 11 de dezembro de 2026 quarta-feira');
  assert.equal(gerar('[=A + B]', {}), '[=A + B]');
  assert.equal(gerar('[D:data] [=D * 2]', { D: '2026-01-01' }), '01/01/2026 [=D * 2]', 'multiplicar data não faz sentido');
});

test('planilha do lote: separadores, aspas, títulos com colchetes e ligação com as perguntas', () => {
  assert.equal(detectarSeparador('a\tb;c'), '\t');
  assert.equal(detectarSeparador('a;b,c;d'), ';');
  assert.equal(detectarSeparador('a,b,c'), ',');
  assert.equal(chaveDaColuna(' [Valor:moeda] '), 'VALOR');
  assert.equal(chaveDaColuna('nome'), 'NOME');

  const tabela = lerTabela('﻿Nome;[VALOR:moeda];Obs;Extra\r\nAna;"1.500,00";"linha 1\nlinha ""2""";x\r\n\r\n;;;\r\nBia;20;;\r\n');
  assert.deepEqual(tabela.cabecalho, ['Nome', '[VALOR:moeda]', 'Obs', 'Extra']);
  assert.deepEqual(tabela.linhas, [['Ana', '1.500,00', 'linha 1\nlinha "2"', 'x'], ['Bia', '20', '', '']]);

  const campos = extrairCampos(['[NOME] [VALOR:moeda] [OBS:texto-longo opcional] [EC: solteiro | casado] [VIP:sim-nao] [HOJE]']);
  const { respostas, ignoradas, faltando } = linhasParaRespostas(tabela, campos);
  assert.deepEqual(respostas, [{ NOME: 'Ana', VALOR: '1.500,00', OBS: 'linha 1\nlinha "2"' }, { NOME: 'Bia', VALOR: '20', OBS: '' }]);
  assert.deepEqual(ignoradas, ['Extra']);
  assert.deepEqual(faltando, ['EC', 'VIP']);

  const colado = lerTabela('NOME\tEC\tVIP\nAna\tCASADO\tS\nBia\tsolteiro\tnão');
  assert.deepEqual(linhasParaRespostas(colado, campos).respostas, [
    { NOME: 'Ana', EC: 'casado', VIP: 'sim' }, { NOME: 'Bia', EC: 'solteiro', VIP: 'não' },
  ]);

  const csv = gerarCsv(campos, [{ NOME: 'a;b', VALOR: '1' }]);
  assert.equal(csv, '﻿NOME;VALOR;OBS;EC;VIP\r\n"a;b";1;;;\r\n');
  assert.deepEqual(lerTabela(csv).cabecalho, ['NOME', 'VALOR', 'OBS', 'EC', 'VIP'], '[HOJE] não vira coluna');
  assert.equal(decodificarArquivo(new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f])), 'João', 'CSV antigo do Excel (ANSI)');
  assert.equal(decodificarArquivo(new TextEncoder().encode('João')), 'João');
});

test('zip: arquivos legíveis, nomes com acento e sem repetição', () => {
  const usados = new Set();
  assert.equal(nomeSemRepetir('Recibo - Ana.pdf', usados), 'Recibo - Ana.pdf');
  assert.equal(nomeSemRepetir('recibo - ana.pdf', usados), 'recibo - ana (2).pdf');
  assert.equal(nomeSemRepetir('Recibo - Ana.pdf', usados), 'Recibo - Ana (3).pdf');
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);

  const zip = montarZip([
    { nome: 'Declaração - João.txt', conteudo: Buffer.from('olá') },
    { nome: 'vazio.txt', conteudo: Buffer.alloc(0) },
  ]);
  const aberto = unzipSync(new Uint8Array(zip));
  assert.deepEqual(Object.keys(aberto), ['Declaração - João.txt', 'vazio.txt']);
  assert.equal(strFromU8(aberto['Declaração - João.txt']), 'olá');
});

test('nome do arquivo com campos: usa as respostas, tira caracteres proibidos e cai no padrão se ficar vazio', () => {
  const campos = extrairCampos(['[NOME:nome] [D:data] [VALOR:moeda] [OBS:opcional] [HOJE]']);
  const modelo = (nomeArquivo) => ({ nome: 'Contrato', config: validarConfig({ nomeArquivo }) });
  const data = new Date(2026, 10, 11);
  const r = { NOME: 'ana souza', D: '2026-01-02', VALOR: '10' };
  assert.equal(nomeDocumento(modelo('Contrato - [NOME:nome] - [D] - [HOJE]'), r, campos, 'pdf', { data }), 'Contrato - Ana Souza - 02-01-2026 - 11-11-2026.pdf');
  assert.equal(nomeDocumento(modelo('[nome:maiusculas] [OBS] ([VALOR])'), r, campos, 'docx', { data }), 'ANA SOUZA (R$ 10,00).docx');
  assert.equal(nomeDocumento(modelo('[INEXISTENTE]'), r, campos, 'pdf', { data }), 'Contrato - 2026-11-11.pdf');
  assert.equal(nomeDocumento(modelo(''), r, campos, 'pdf', { data }), 'Contrato - 2026-11-11.pdf');
  assert.equal(nomeDocumento(modelo(''), r, campos, 'pdf', { data, sufixo: 'Ana: 1/2' }), 'Contrato - Ana 1-2.pdf', 'lote');
  assert.equal(limparNomeArquivo(' a<b>:c?*.. '), 'a b c');
  assert.throws(() => validarConfig({ nomeArquivo: 'x'.repeat(151) }), /nome do arquivo/);
});
