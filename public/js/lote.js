// GERADOC — tela "Gerar em lote" (v1.2): uma planilha, um documento por linha, tudo num .zip.
import { $, api, avisar, baixar, chip, nomeDoCabecalho, plural } from './util.js';
import {
  camposAtivosDoModelo, camposDoModelo, camposInvalidos, camposPendentes, completarRespostas,
} from './campos.js';
import { configOuPadrao } from './pagina.js';
import { decodificarArquivo, gerarCsv, lerTabela, linhasParaRespostas, LINHAS_MAX } from './tabela.js';

const LINHAS_NA_TELA = 100;

let lote = null; // { modelo, campos, perguntas, linhas: [{ respostas, problema }], trabalho }
let acompanhando = 0; // muda a cada lote/tela: interrompe o acompanhamento antigo

export function loteEmAndamento() {
  return Boolean(lote?.trabalho) && !$('tela-lote').hidden;
}

const validas = () => lote.linhas.filter((l) => !l.problema);

function problemaDaLinha(respostas) {
  const { modelo, campos } = lote;
  const completas = completarRespostas(respostas, new Date(), campos);
  const ativos = camposAtivosDoModelo(modelo, completas);
  const pendentes = camposPendentes(campos, completas, ativos);
  const invalidos = camposInvalidos(campos, completas, ativos);
  const partes = [];
  if (pendentes.length) partes.push(`falta ${pendentes.join(', ')}`);
  if (invalidos.length) partes.push(invalidos.map((i) => `${i.chave}: ${i.mensagem}`).join('; '));
  return partes.join(' · ') || null;
}

function celula(tag, texto, classe) {
  const el = document.createElement(tag);
  el.textContent = texto;
  if (classe) el.className = classe;
  return el;
}

function renderizar() {
  const { perguntas, linhas } = lote;
  const boas = validas().length;
  const ruins = linhas.length - boas;
  const tem = linhas.length > 0;
  $('lote-conferencia').hidden = !tem;
  $('lote-botao-pdf').disabled = boas === 0;
  $('lote-botao-word').disabled = boas === 0;
  $('lote-botao-pdf').querySelector('.botao-rotulo').textContent = boas ? `Gerar ${plural(boas, 'PDF', 'PDFs')}` : 'Gerar PDFs';
  $('lote-botao-word').querySelector('.botao-rotulo').textContent = boas ? `Gerar ${plural(boas, 'Word', 'Words')}` : 'Gerar Words';
  if (!tem) return;

  let resumo = `${plural(linhas.length, 'linha', 'linhas')}: ${plural(boas, 'pronta', 'prontas')}`;
  if (ruins) resumo += `, ${ruins} com problema (${ruins === 1 ? 'fica' : 'ficam'} de fora — corrija na planilha e cole de novo)`;
  $('lote-resumo').textContent = `${resumo}.`;
  $('lote-resumo').className = ruins ? 'alerta-aviso' : 'alerta-ok';

  const cabecalho = document.createElement('tr');
  cabecalho.append(celula('th', '#'), ...perguntas.map((c) => celula('th', c.chave)), celula('th', 'Situação'));
  $('lote-tabela-cabecalho').replaceChildren(cabecalho);
  const corpo = $('lote-tabela-corpo');
  corpo.replaceChildren();
  linhas.slice(0, LINHAS_NA_TELA).forEach(({ respostas, problema }, i) => {
    const tr = document.createElement('tr');
    if (problema) tr.className = 'linha-problema';
    tr.append(celula('td', String(i + 1), 'lote-numero'), ...perguntas.map((c) => celula('td', respostas[c.chave] ?? '')));
    const situacao = document.createElement('td');
    situacao.append(chip(problema ?? 'pronta', problema ? 'chip chip--mini chip--erro' : 'chip chip--mini chip--auto'));
    tr.append(situacao);
    corpo.append(tr);
  });
  $('lote-mais').hidden = linhas.length <= LINHAS_NA_TELA;
  $('lote-mais').textContent = `Mostrando as ${LINHAS_NA_TELA} primeiras de ${linhas.length} linhas.`;
}

function mostrarErro(texto) {
  $('lote-erro').textContent = texto ?? '';
  $('lote-erro').hidden = !texto;
}

function lerPlanilha(texto) {
  mostrarErro(null);
  $('lote-resultado').hidden = true;
  lote.linhas = [];
  if (!texto.trim()) return renderizar();
  const tabela = lerTabela(texto);
  const { respostas, ignoradas, faltando } = linhasParaRespostas(tabela, lote.campos);
  const obrigatorias = new Set(lote.perguntas.filter((c) => !c.opcional && c.tipo !== 'sim-nao').map((c) => c.chave));
  const semColuna = faltando.filter((c) => obrigatorias.has(c));
  if (faltando.length === lote.perguntas.length) {
    mostrarErro('Não encontrei nenhuma coluna com o nome de uma pergunta deste modelo. A primeira linha da planilha precisa ter os títulos: '
      + `${lote.perguntas.map((c) => c.chave).join(', ')}.`);
  } else if (!respostas.length) {
    mostrarErro('A planilha só tem a linha de títulos. Preencha uma linha para cada documento.');
  } else if (respostas.length > LINHAS_MAX) {
    mostrarErro(`A planilha tem ${respostas.length} linhas; o máximo por lote é ${LINHAS_MAX}. Divida em partes.`);
  } else {
    const avisos = [];
    if (semColuna.length) avisos.push(`Sem coluna na planilha: ${semColuna.join(', ')}.`);
    if (ignoradas.length) avisos.push(`${plural(ignoradas.length, 'Coluna ignorada', 'Colunas ignoradas')} (não é pergunta deste modelo): ${ignoradas.join(', ')}.`);
    mostrarErro(avisos.join(' ') || null);
    lote.linhas = respostas.map((r) => ({ respostas: r, problema: problemaDaLinha(r) }));
  }
  return renderizar();
}

/** @param {string} id  @param {{ mostrar: (tela: string) => void }} ctx */
export async function abrirLote(id, ctx) {
  ctx.mostrar('carregando');
  acompanhando += 1;
  try {
    const modelo = await api(`/modelos/${encodeURIComponent(id)}`);
    modelo.config = configOuPadrao(modelo.config);
    const campos = camposDoModelo(modelo);
    lote = { modelo, campos, perguntas: campos.filter((c) => !c.automatico), linhas: [], trabalho: null };
  } catch (erro) {
    avisar(erro.message, 'erro');
    location.hash = '#/';
    return;
  }
  const { modelo, perguntas } = lote;
  $('lote-migalha-modelo').textContent = modelo.nome;
  $('lote-migalha-modelo').href = `#/gerar/${modelo.id}`;
  $('lote-colunas').replaceChildren(...perguntas.map((c) => chip(c.opcional || c.tipo === 'sim-nao' ? `${c.chave} (opcional)` : c.chave)));
  $('lote-texto').value = '';
  $('lote-progresso').hidden = true;
  $('lote-resultado').hidden = true;
  $('lote-sem-perguntas').hidden = perguntas.length > 0;
  $('lote-planilha').hidden = perguntas.length === 0;
  mostrarErro(null);
  renderizar();
  ctx.mostrar('lote');
}

function mostrarProgresso(estado) {
  $('lote-progresso').hidden = false;
  $('lote-progresso-texto').textContent = `Gerando ${Math.min(estado.feitos + 1, estado.total)} de ${estado.total}…`;
  $('lote-progresso-preenchido').style.width = `${(estado.feitos / estado.total) * 100}%`;
}

function mostrarResultado(estado, nomeZip) {
  const caixa = $('lote-resultado');
  caixa.hidden = false;
  caixa.className = estado.estado === 'pronto' && !estado.falhas.length ? 'alerta-ok' : 'alerta-aviso';
  let texto;
  if (estado.estado === 'pronto') texto = `${plural(estado.gerados, 'documento gerado', 'documentos gerados')} em ${nomeZip} (pasta Downloads).`;
  else if (estado.estado === 'cancelado') texto = 'Lote cancelado. Nenhum arquivo foi baixado.';
  else texto = 'Nenhum documento pôde ser gerado.';
  const itens = estado.falhas.slice(0, 20).map((f) => celula('li', `Linha ${f.linha}: ${f.erro}`));
  caixa.replaceChildren(celula('p', texto));
  if (itens.length) {
    const lista = document.createElement('ul');
    lista.append(...itens);
    caixa.append(celula('p', `${plural(estado.falhas.length, 'linha não gerada', 'linhas não geradas')}:`), lista);
  }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function gerarLote(formato) {
  if (!lote || lote.trabalho) return;
  const linhas = validas().map((l) => l.respostas);
  if (!linhas.length) return;
  const vez = (acompanhando += 1);
  $('lote-resultado').hidden = true;
  $('lote-botao-pdf').disabled = true;
  $('lote-botao-word').disabled = true;
  try {
    let estado = await api('/lote', { method: 'POST', body: { modeloId: lote.modelo.id, linhas, formato } });
    lote.trabalho = estado.id;
    mostrarProgresso(estado);
    while (estado.estado === 'gerando') {
      await espera(350);
      if (vez !== acompanhando) return; // saiu da tela
      estado = await api(`/lote/${estado.id}`);
      mostrarProgresso(estado);
    }
    let nome = '';
    if (estado.estado === 'pronto') {
      const resposta = await fetch(`/api/lote/${estado.id}/arquivo`);
      if (!resposta.ok) throw new Error((await resposta.json().catch(() => ({}))).erro || `Erro ${resposta.status}`);
      nome = nomeDoCabecalho(resposta.headers.get('Content-Disposition'), 'documentos.zip');
      baixar(await resposta.blob(), nome);
      avisar(`Lote pronto: ${nome} (pasta Downloads).`);
      api(`/lote/${estado.id}`, { method: 'DELETE' }).catch(() => {}); // libera a memória do servidor
    }
    mostrarResultado(estado, nome);
  } catch (erro) {
    avisar(`Não foi possível gerar o lote: ${erro.message}`, 'erro');
  } finally {
    if (vez === acompanhando) {
      lote.trabalho = null;
      $('lote-progresso').hidden = true;
      renderizar();
    }
  }
}

$('lote-texto').addEventListener('input', () => { if (lote) lerPlanilha($('lote-texto').value); });
$('lote-botao-pdf').addEventListener('click', () => gerarLote('pdf'));
$('lote-botao-word').addEventListener('click', () => gerarLote('docx'));
$('lote-cancelar').addEventListener('click', () => {
  if (lote?.trabalho) api(`/lote/${lote.trabalho}`, { method: 'DELETE' }).catch(() => {});
});
$('lote-baixar-planilha').addEventListener('click', () => {
  if (!lote) return;
  baixar(new Blob([gerarCsv(lote.campos)], { type: 'text/csv;charset=utf-8' }), `${lote.modelo.nome.replace(/[<>:"/\\|?*]/g, ' ')} - planilha.csv`);
  avisar('Planilha baixada. Abra no Excel, preencha uma linha por documento e traga de volta aqui.');
});
$('lote-abrir-arquivo').addEventListener('click', () => {
  $('lote-arquivo').value = '';
  $('lote-arquivo').click();
});
$('lote-arquivo').addEventListener('change', async () => {
  const arquivo = $('lote-arquivo').files?.[0];
  if (!arquivo || !lote) return;
  if (/\.xlsx?$/i.test(arquivo.name)) {
    return mostrarErro('Arquivos .xlsx não são lidos direto. No Excel, selecione as células (com os títulos), copie e cole no quadro abaixo — ou salve como "CSV UTF-8".');
  }
  const texto = decodificarArquivo(new Uint8Array(await arquivo.arrayBuffer()));
  $('lote-texto').value = texto;
  return lerPlanilha(texto);
});
