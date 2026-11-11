// GERADOC — tela de gerar documento: perguntas (por tipo), pré-visualização e download em PDF ou Word.
import { $, api, avisar, baixar, chip, formatarData, nomeDoCabecalho } from './util.js';
import {
  camposDoModelo, camposInvalidos, camposPendentes, completarRespostas, formatarValor, FORMATOS,
  lerNumero, mapaDeTipos, preencherHtml, validarResposta,
} from './campos.js';
import { configOuPadrao, descreverPagina, htmlVazio, tamanhoPagina } from './pagina.js';

let geracao = null; // { modelo, config, campos, perguntas, tipos, respostas, ultima }
let gerando = false;

export function gerarTemAlteracoes() {
  return Boolean(geracao) && !$('tela-gerar').hidden && Object.values(geracao.respostas).some((v) => String(v).trim());
}

// ---------- Máscaras ----------
const MASCARAS = {
  cpf: () => '000.000.000-00',
  cnpj: () => '00.000.000/0000-00',
  cep: () => '00000-000',
  telefone: (d) => (d.length <= 10 ? '(00) 0000-0000' : '(00) 00000-0000'),
};

function aplicarMascara(valor, tipo) {
  const digitos = String(valor).replace(/\D/g, '');
  const padrao = MASCARAS[tipo](digitos);
  const maximo = (padrao.match(/0/g) || []).length;
  let saida = '';
  let i = 0;
  for (const c of padrao) {
    if (i >= Math.min(digitos.length, maximo)) break;
    saida += c === '0' ? digitos[i++] : c;
  }
  return saida;
}

const PLACEHOLDERS = {
  cpf: '000.000.000-00', cnpj: '00.000.000/0000-00', cep: '00000-000', telefone: '(00) 00000-0000',
  moeda: '0,00', numero: 'Ex.: 10',
};

// ---------- Pré-visualização ----------
const PX_POR_CM = 96 / 2.54;

function aplicarPagina(config) {
  const { largura, altura } = tamanhoPagina(config);
  const m = config.margens;
  const pct = (cm) => `${(cm / largura) * 100}%`;
  const folha = $('folha');
  $('folha-moldura').style.maxWidth = `${Math.round(largura * PX_POR_CM)}px`;
  folha.style.aspectRatio = `${largura} / ${altura}`;
  folha.style.padding = `${pct(m.superior)} ${pct(m.direita)} ${pct(m.inferior)} ${pct(m.esquerda)}`;
  folha.style.fontFamily = `"${config.fonte}", "Segoe UI", system-ui, sans-serif`;
  folha.style.fontSize = `${config.tamanhoFonte}pt`;
  $('descricao-pagina').textContent = descreverPagina(config);
}

function atualizarPrevia() {
  const { modelo, config, campos, perguntas, tipos } = geracao;
  const respostas = completarRespostas(geracao.respostas);
  const opcoes = { marcar: true, tipos };
  $('previa').innerHTML = modelo.conteudo
    ? preencherHtml(modelo.conteudo, respostas, opcoes)
    : '<p class="previa-vazia">Este modelo está vazio. Edite-o para colocar o texto do documento.</p>';

  const temCabecalho = !htmlVazio(config.cabecalho);
  $('previa-cabecalho').hidden = !temCabecalho;
  $('previa-cabecalho').innerHTML = temCabecalho ? preencherHtml(config.cabecalho, respostas, opcoes) : '';
  const temRodape = !htmlVazio(config.rodape);
  const temNumero = config.numeracao !== 'nenhuma';
  $('previa-rodape').hidden = !temRodape && !temNumero;
  $('previa-rodape-conteudo').innerHTML = temRodape ? preencherHtml(config.rodape, respostas, opcoes) : '';
  $('previa-numero').hidden = !temNumero;
  $('previa-numero').style.textAlign = config.numeracao === 'centro' ? 'center' : 'right';

  const total = perguntas.length;
  const feitas = total - camposPendentes(campos, geracao.respostas).length;
  $('progresso-contagem').textContent = total
    ? `${feitas} de ${total} ${total === 1 ? 'pergunta respondida' : 'perguntas respondidas'}`
    : 'Nenhuma pergunta';
  $('progresso-preenchido').style.width = total ? `${(feitas / total) * 100}%` : '100%';
  $('botao-gerar').classList.toggle('botao--pronto', feitas === total);
}

function destacarNaPrevia(chave, rolar = true) {
  let primeiro = null;
  for (const mark of $('folha').querySelectorAll('mark.campo')) {
    const ativo = mark.dataset.campo === chave;
    mark.classList.toggle('campo--ativo', ativo);
    if (ativo && !primeiro) primeiro = mark;
  }
  if (rolar) primeiro?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Perguntas ----------
/** "No documento: R$ 1.500,00 · mil e quinhentos reais" (só para campos com formato). */
function textoExemplo(campo, valor) {
  if (!String(valor).trim()) return '';
  if (campo.tipo === 'texto' && !campo.formatos.includes('maiusculas')) return '';
  const vistos = [...new Set(campo.formatos.map((f) => formatarValor(valor, f === 'texto' ? null : f, campo.tipo)))];
  return `No documento: ${vistos.join(' · ')}`;
}

function criarEntrada(campo, indice) {
  const { chave, tipo } = campo;
  const entrada = document.createElement('input');
  entrada.id = `resposta-${indice}`;
  entrada.className = 'campo-texto';
  entrada.autocomplete = 'off';
  entrada.dataset.campo = chave;
  entrada.dataset.tipo = tipo;
  if (tipo === 'data') {
    entrada.type = 'date';
  } else {
    entrada.type = 'text';
    if (PLACEHOLDERS[tipo]) entrada.placeholder = PLACEHOLDERS[tipo];
    if (MASCARAS[tipo]) entrada.inputMode = 'numeric';
    if (tipo === 'moeda' || tipo === 'numero') entrada.inputMode = 'decimal';
    const sugestoes = geracao.sugestoes[chave];
    if (sugestoes?.length) {
      const lista = document.createElement('datalist');
      lista.id = `sugestoes-${indice}`;
      for (const s of sugestoes) lista.append(new Option(s));
      entrada.setAttribute('list', lista.id);
      entrada.lista = lista; // vai para o DOM junto com a entrada (montarPerguntas)
    }
  }
  entrada.value = geracao.respostas[chave] ?? '';
  return entrada;
}

function mostrarErroCampo(entrada, mensagem) {
  const grupo = entrada.closest('.pergunta');
  const erro = grupo.querySelector('.erro-campo');
  erro.textContent = mensagem ?? '';
  erro.hidden = !mensagem;
  entrada.classList.toggle('campo-texto--erro', Boolean(mensagem));
}

function montarPerguntas() {
  const { perguntas, respostas } = geracao;
  const container = $('perguntas');
  container.replaceChildren();
  perguntas.forEach((campo, indice) => {
    const grupo = document.createElement('div');
    grupo.className = 'pergunta';

    const rotulo = document.createElement('label');
    rotulo.className = 'rotulo';
    rotulo.htmlFor = `resposta-${indice}`;
    rotulo.textContent = campo.chave;
    if (campo.tipo !== 'texto') rotulo.append(' ', chip(FORMATOS[campo.tipo]?.rotulo ?? campo.tipo, 'chip chip--mini chip--tipo'));
    if (campo.ocorrencias > 1) rotulo.append(' ', chip(`aparece ${campo.ocorrencias}×`, 'chip chip--mini'));

    const entrada = criarEntrada(campo, indice);
    const caixa = document.createElement('div');
    caixa.className = campo.tipo === 'moeda' ? 'entrada-moeda' : 'entrada';
    if (campo.tipo === 'moeda') caixa.append(Object.assign(document.createElement('span'), { className: 'prefixo', textContent: 'R$' }));
    caixa.append(entrada);
    if (entrada.lista) caixa.append(entrada.lista);

    const exemplo = document.createElement('p');
    exemplo.className = 'exemplo-resposta';
    exemplo.textContent = textoExemplo(campo, entrada.value);
    const erro = document.createElement('p');
    erro.className = 'erro-campo';
    erro.hidden = true;

    entrada.addEventListener('input', () => {
      if (MASCARAS[campo.tipo]) {
        const formatado = aplicarMascara(entrada.value, campo.tipo);
        if (formatado !== entrada.value) entrada.value = formatado;
      }
      respostas[campo.chave] = entrada.value;
      exemplo.textContent = textoExemplo(campo, entrada.value);
      if (!entrada.classList.contains('campo-texto--erro') || !validarResposta(campo.tipo, entrada.value)) mostrarErroCampo(entrada, null);
      $('erro-respostas').hidden = true;
      atualizarPrevia();
      destacarNaPrevia(campo.chave, false);
    });
    entrada.addEventListener('blur', () => {
      if (campo.tipo === 'moeda') {
        const n = lerNumero(entrada.value);
        if (n !== null) {
          entrada.value = n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          respostas[campo.chave] = entrada.value;
          exemplo.textContent = textoExemplo(campo, entrada.value);
          atualizarPrevia();
        }
      }
      mostrarErroCampo(entrada, validarResposta(campo.tipo, entrada.value));
      destacarNaPrevia(null);
    });
    // Enter avança para a próxima pergunta em vez de enviar o formulário.
    entrada.addEventListener('keydown', (evento) => {
      if (evento.key !== 'Enter') return;
      evento.preventDefault();
      const proxima = $(`resposta-${indice + 1}`);
      if (proxima) proxima.focus();
      else $('botao-gerar').focus();
    });
    entrada.addEventListener('focus', () => destacarNaPrevia(campo.chave));

    grupo.append(rotulo, caixa, exemplo, erro);
    container.append(grupo);
  });
  $('sem-campos').hidden = perguntas.length > 0;
}

function mostrarUltimas() {
  const { ultima, perguntas } = geracao;
  const util = ultima && perguntas.some((c) => String(ultima.respostas[c.chave] ?? '').trim());
  $('ultimas-respostas').hidden = !util;
  if (util) $('ultimas-texto').textContent = `Última geração deste modelo: ${formatarData(ultima.geradoEm)}.`;
}

function usarRespostas(respostas) {
  for (const c of geracao.perguntas) {
    if (typeof respostas[c.chave] === 'string') geracao.respostas[c.chave] = respostas[c.chave];
  }
  $('erro-respostas').hidden = true;
  montarPerguntas();
  atualizarPrevia();
}

/** @param {string} id  @param {string|null} historicoId  @param {{ mostrar: (tela: string) => void }} ctx */
export async function abrirGerar(id, historicoId, ctx) {
  ctx.mostrar('carregando');
  try {
    const [modelo, sugestoes, anteriores, registro] = await Promise.all([
      api(`/modelos/${encodeURIComponent(id)}`),
      api('/sugestoes').catch(() => ({})),
      api(`/historico?modeloId=${encodeURIComponent(id)}`).catch(() => []),
      historicoId ? api(`/historico/${encodeURIComponent(historicoId)}`).catch(() => null) : null,
    ]);
    const config = configOuPadrao(modelo.config);
    const campos = camposDoModelo({ ...modelo, config });
    geracao = {
      modelo,
      config,
      campos,
      perguntas: campos.filter((c) => !c.automatico),
      tipos: mapaDeTipos(campos),
      respostas: {},
      sugestoes,
      ultima: anteriores[0] ?? null,
    };
    if (registro) {
      for (const c of geracao.perguntas) {
        if (typeof registro.respostas[c.chave] === 'string') geracao.respostas[c.chave] = registro.respostas[c.chave];
      }
    }
  } catch (erro) {
    avisar(erro.message, 'erro');
    location.hash = '#/';
    return;
  }
  const { modelo, perguntas, campos } = geracao;
  $('titulo-gerar').textContent = modelo.nome;
  const automaticos = campos.filter((c) => c.automatico).map((c) => `[${c.chave}]`);
  $('resumo-gerar').textContent = (perguntas.length
    ? 'Responda às perguntas. As respostas entram no lugar dos campos entre colchetes.'
    : '') + (automaticos.length ? ` ${automaticos.join(', ')} é preenchido sozinho com a data de hoje.` : '');
  $('erro-respostas').hidden = true;
  aplicarPagina(geracao.config);
  montarPerguntas();
  mostrarUltimas();
  if (historicoId && !Object.keys(geracao.respostas).length) avisar('Não foi possível carregar as respostas do histórico.', 'erro');
  atualizarPrevia();
  ctx.mostrar('gerar');
  $('resposta-0')?.focus();
}

async function gerarDocumento(formato) {
  const { modelo, campos, respostas } = geracao;
  if (!modelo.conteudo) return avisar('Este modelo está vazio.', 'erro');

  // Etapa 1, Q11: nada é gerado com campos sem resposta. v1.1: nem com resposta inválida para o tipo.
  const pendentes = camposPendentes(campos, respostas);
  const invalidos = camposInvalidos(campos, respostas);
  const comErro = new Set([...pendentes, ...invalidos.map((i) => i.chave)]);
  for (const entrada of $('perguntas').querySelectorAll('input')) {
    const invalido = invalidos.find((i) => i.chave === entrada.dataset.campo);
    mostrarErroCampo(entrada, invalido?.mensagem ?? null);
    entrada.classList.toggle('campo-texto--erro', comErro.has(entrada.dataset.campo));
  }
  if (comErro.size) {
    const partes = [];
    if (pendentes.length) partes.push(pendentes.length === 1 ? `Falta responder: ${pendentes[0]}.` : `Faltam ${pendentes.length} respostas: ${pendentes.join(', ')}.`);
    if (invalidos.length) partes.push(`Corrija: ${invalidos.map((i) => `${i.chave} (${i.mensagem})`).join(', ')}.`);
    $('erro-respostas').textContent = partes.join(' ');
    $('erro-respostas').hidden = false;
    $('perguntas').querySelector('.campo-texto--erro')?.focus();
    return;
  }

  // O servidor monta o documento a partir do modelo salvo + respostas (não recebe HTML daqui).
  if (gerando) return;
  gerando = true;
  const botao = formato === 'docx' ? $('botao-word') : $('botao-gerar');
  const rotulo = botao.querySelector('.botao-rotulo');
  const textoOriginal = rotulo.textContent;
  const nomeFormato = formato === 'docx' ? 'Word' : 'PDF';
  $('botao-word').disabled = true;
  $('botao-gerar').disabled = true;
  botao.classList.add('botao--carregando');
  rotulo.textContent = `Gerando ${nomeFormato}…`;
  try {
    const resposta = await fetch('/api/documento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modeloId: modelo.id, respostas, formato }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => ({}));
      throw new Error(dados.erro || `Erro ${resposta.status}`);
    }
    const nome = nomeDoCabecalho(resposta.headers.get('Content-Disposition'), `documento.${formato}`);
    baixar(await resposta.blob(), nome);
    avisar(`${nomeFormato} gerado: ${nome} (pasta Downloads).`);
    // Atualiza sugestões e "últimas respostas" para a próxima vez.
    geracao.ultima = { respostas: { ...respostas }, geradoEm: new Date().toISOString() };
  } catch (erro) {
    avisar(`Não foi possível gerar o ${nomeFormato}: ${erro.message}`, 'erro');
  } finally {
    gerando = false;
    $('botao-word').disabled = false;
    $('botao-gerar').disabled = false;
    botao.classList.remove('botao--carregando');
    rotulo.textContent = textoOriginal;
  }
}

function limparRespostas() {
  if (!geracao) return;
  geracao.respostas = {};
  $('erro-respostas').hidden = true;
  montarPerguntas();
  atualizarPrevia();
  $('resposta-0')?.focus();
}

$('form-respostas').addEventListener('submit', (evento) => {
  evento.preventDefault();
  gerarDocumento('pdf');
});
$('botao-word').addEventListener('click', () => gerarDocumento('docx'));
$('botao-limpar').addEventListener('click', limparRespostas);
$('botao-ultimas').addEventListener('click', () => {
  if (geracao?.ultima) usarRespostas(geracao.ultima.respostas);
  $('ultimas-respostas').hidden = true;
});
