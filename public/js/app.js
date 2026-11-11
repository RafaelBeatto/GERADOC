// GERADOC — frontend.
// F1: lista, criação, edição e exclusão de modelos.  F2: perguntas a partir dos campos [X].  F3: PDF.
// F5: duplicar e lixeira (restaurar / excluir definitivamente).
// Navegação por hash: #/  ·  #/novo  ·  #/editar/<id>  ·  #/gerar/<id>  ·  #/lixeira
import { camposDoHtml, camposPendentes, preencherHtml } from './campos.js';

const $ = (id) => document.getElementById(id);

// Ícone do sprite SVG em index.html (#i-<nome>).
function icone(nome) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'icone');
  svg.setAttribute('aria-hidden', 'true');
  const uso = document.createElementNS(NS, 'use');
  uso.setAttribute('href', `#i-${nome}`);
  svg.append(uso);
  return svg;
}

const telas = {
  lista: $('tela-lista'),
  editor: $('tela-editor'),
  gerar: $('tela-gerar'),
  lixeira: $('tela-lixeira'),
  carregando: $('tela-carregando'),
};

let modelos = [];          // cache da listagem
let modeloAtual = null;    // modelo aberto no editor (null = novo)
let estadoSalvo = '';      // snapshot para detectar alterações não salvas
let salvando = false;
let geracao = null;        // { modelo, campos, respostas } da tela de perguntas

// ---------- API ----------
async function api(caminho, opcoes = {}) {
  const resposta = await fetch(`/api${caminho}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const erro = new Error(dados.erro || `Erro ${resposta.status}`);
    erro.status = resposta.status;
    throw erro;
  }
  return dados;
}

// ---------- Avisos ----------
let temporizadorAviso;
function avisar(texto, tipo = 'ok') {
  const aviso = $('aviso');
  aviso.textContent = texto;
  aviso.className = `aviso aviso--${tipo}`;
  aviso.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { aviso.hidden = true; }, 3500);
}

// ---------- Status do servidor ----------
async function verificarServidor() {
  const status = $('status');
  try {
    const dados = await api('/saude');
    status.textContent = `Online · v${dados.versao}`;
    status.className = 'status status--ok';
  } catch {
    status.textContent = 'Servidor desligado';
    status.className = 'status status--erro';
  }
}

// ---------- Editor (Quill) ----------
const quill = new window.Quill('#editor', {
  theme: 'snow',
  placeholder: 'Ex.: Eu, [NOME], portador do CPF [CPF], declaro que…',
  modules: {
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      [{ size: ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
      ['clean'],
    ],
  },
});

function conteudoEditor() {
  // Editor vazio no Quill = "<p><br></p>"; guardamos string vazia nesse caso.
  // Usa o HTML interno do Quill (classes ql-*) — reabre idêntico e será renderizado no PDF com o CSS do Quill.
  return quill.getText().trim() ? quill.root.innerHTML : '';
}

function snapshot() {
  return JSON.stringify([$('nome-modelo').value.trim(), conteudoEditor()]);
}

function temAlteracoes() {
  if (!telas.editor.hidden) return snapshot() !== estadoSalvo;
  if (!telas.gerar.hidden && geracao) return Object.values(geracao.respostas).some((v) => v.trim());
  return false;
}

// Mostra, enquanto se digita, quais perguntas o modelo vai gerar.
function chip(texto, classe = 'chip') {
  const el = document.createElement('span');
  el.className = classe;
  el.textContent = texto;
  return el;
}

function atualizarCamposEditor() {
  const campos = camposDoHtml(conteudoEditor());
  const alvo = $('lista-campos-editor');
  if (!campos.length) {
    alvo.replaceChildren(chip('Nenhuma ainda — use [NOME], [CPF]…', 'chip chip--vazio'));
    return;
  }
  alvo.replaceChildren(...campos.map((c) => chip(c.ocorrencias > 1 ? `${c.chave} ×${c.ocorrencias}` : c.chave)));
}

let temporizadorCampos;
quill.on('text-change', () => {
  clearTimeout(temporizadorCampos);
  temporizadorCampos = setTimeout(atualizarCamposEditor, 200);
});

// ---------- Telas ----------
function mostrar(nome) {
  for (const [chave, tela] of Object.entries(telas)) tela.hidden = chave !== nome;
}

function formatarData(iso) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function botaoAcao(tag, classe, nomeIcone, texto) {
  const el = document.createElement(tag);
  el.className = `botao botao--pequeno ${classe}`;
  el.append(icone(nomeIcone), texto);
  return el;
}

function renderizarLista() {
  const termo = $('busca').value.trim().toLocaleLowerCase('pt-BR');
  const filtrados = modelos.filter((m) => m.nome.toLocaleLowerCase('pt-BR').includes(termo));
  const lista = $('lista-modelos');
  lista.replaceChildren();

  const total = modelos.length;
  $('lista-vazia').hidden = total > 0;
  $('busca').closest('.painel-barra').hidden = total === 0;
  $('tabela-cabecalho').hidden = filtrados.length === 0;
  $('busca-sem-resultado').hidden = total === 0 || filtrados.length > 0;
  $('contagem-modelos').textContent = termo
    ? `${filtrados.length} de ${total}`
    : `${total} ${total === 1 ? 'modelo' : 'modelos'}`;

  for (const modelo of filtrados) {
    const linha = document.createElement('tr');
    linha.className = 'cartao-modelo';

    const celulaNome = document.createElement('td');
    const nome = document.createElement('div');
    nome.className = 'modelo-nome';
    const iconeNome = document.createElement('span');
    iconeNome.className = 'modelo-nome-icone';
    iconeNome.append(icone('documento'));
    const link = document.createElement('a');
    link.href = `#/gerar/${modelo.id}`;
    link.textContent = modelo.nome;
    link.title = 'Gerar documento com este modelo';
    nome.append(iconeNome, link);
    celulaNome.append(nome);

    const data = document.createElement('td');
    data.className = 'cartao-data';
    data.textContent = formatarData(modelo.atualizadoEm);
    data.title = `Criado em ${formatarData(modelo.criadoEm)}`;

    const celulaAcoes = document.createElement('td');
    const acoes = document.createElement('div');
    acoes.className = 'cartao-acoes';

    const gerar = botaoAcao('a', 'botao--primario', 'gerar', 'Gerar documento');
    gerar.href = `#/gerar/${modelo.id}`;

    const editar = botaoAcao('a', 'botao--fantasma', 'editar', 'Editar');
    editar.href = `#/editar/${modelo.id}`;

    const duplicar = botaoAcao('button', 'botao--fantasma', 'duplicar', 'Duplicar');
    duplicar.type = 'button';
    duplicar.title = 'Criar uma cópia deste modelo';
    duplicar.addEventListener('click', () => duplicarModelo(modelo, duplicar));

    const excluir = botaoAcao('button', 'botao--fantasma botao--perigo-texto', 'lixeira', 'Excluir');
    excluir.type = 'button';
    excluir.addEventListener('click', () => confirmarExclusao(modelo));

    acoes.append(gerar, editar, duplicar, excluir);
    celulaAcoes.append(acoes);
    linha.append(celulaNome, data, celulaAcoes);
    lista.append(linha);
  }
}

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Avisa sobre arquivos de modelo que existem mas não puderam ser lidos (nunca são apagados). */
function mostrarIlegiveis(diagnostico) {
  const alerta = $('alerta-ilegiveis');
  const arquivos = diagnostico?.modelosIlegiveis ?? [];
  alerta.hidden = arquivos.length === 0;
  if (!arquivos.length) return;
  const lista = arquivos.slice(0, 5).join(', ') + (arquivos.length > 5 ? '…' : '');
  alerta.textContent = `${plural(arquivos.length, 'arquivo', 'arquivos')} da pasta dados/modelos não ${arquivos.length === 1 ? 'pôde' : 'puderam'} ser ${arquivos.length === 1 ? 'lido' : 'lidos'} e ${arquivos.length === 1 ? 'ficou' : 'ficaram'} fora da lista: ${lista}. `
    + 'Nada foi apagado; versões anteriores de cada modelo ficam em dados/backup.';
}

async function abrirLista() {
  mostrar('carregando');
  const [lista, lixeira, diagnostico] = await Promise.allSettled([api('/modelos'), api('/lixeira'), api('/diagnostico')]);
  if (lista.status === 'fulfilled') {
    modelos = lista.value;
  } else {
    avisar(`Não foi possível carregar os modelos: ${lista.reason.message}`, 'erro');
    modelos = [];
  }
  const naLixeira = lixeira.status === 'fulfilled' ? lixeira.value.length : 0;
  $('contagem-lixeira').textContent = naLixeira;
  $('contagem-lixeira').hidden = naLixeira === 0;
  mostrarIlegiveis(diagnostico.status === 'fulfilled' ? diagnostico.value : null);
  renderizarLista();
  mostrar('lista');
}

let duplicando = false;
async function duplicarModelo(modelo, botao) {
  if (duplicando) return;
  duplicando = true;
  botao.disabled = true;
  try {
    const copia = await api(`/modelos/${modelo.id}/duplicar`, { method: 'POST' });
    avisar(`Cópia criada: "${copia.nome}".`);
    await abrirLista();
  } catch (erro) {
    avisar(`Não foi possível duplicar: ${erro.message}`, 'erro');
    botao.disabled = false;
  } finally {
    duplicando = false;
  }
}

// ---------- Diálogo de confirmação ----------
// A resposta vem do clique no botão (submit) ou do Esc (cancel), que acontecem na hora.
// Não usamos o evento "close": ele chega atrasado e poderia responder um diálogo aberto logo em seguida.
let respostaDialogo = null;
function encerrarDialogo(ok) {
  const resolver = respostaDialogo;
  respostaDialogo = null;
  resolver?.(ok);
}
$('dialogo-confirmar').querySelector('form').addEventListener('submit', (evento) => {
  encerrarDialogo(evento.submitter?.value === 'confirmar');
});
$('dialogo-confirmar').addEventListener('cancel', () => encerrarDialogo(false));

/** @returns {Promise<boolean>} */
function confirmar({ titulo, texto, botao }) {
  const dialogo = $('dialogo-confirmar');
  encerrarDialogo(false); // por garantia, nenhum pedido anterior fica pendurado
  $('dialogo-titulo').textContent = titulo;
  $('dialogo-texto').replaceChildren(...texto);
  $('dialogo-botao').textContent = botao;
  if (!dialogo.open) dialogo.showModal();
  return new Promise((resolver) => { respostaDialogo = resolver; });
}

function negrito(texto) {
  const el = document.createElement('strong');
  el.textContent = texto;
  return el;
}

// ---------- Lixeira ----------
let excluidos = [];
let acaoLixeira = false; // evita cliques duplos enquanto uma ação está em andamento

function renderizarLixeira() {
  const corpo = $('lista-lixeira');
  corpo.replaceChildren();
  $('lixeira-vazia').hidden = excluidos.length > 0;
  $('lixeira-cabecalho').hidden = excluidos.length === 0;
  $('contagem-excluidos').textContent = excluidos.length ? plural(excluidos.length, 'modelo', 'modelos') : '';

  for (const modelo of excluidos) {
    const linha = document.createElement('tr');

    const celulaNome = document.createElement('td');
    const nome = document.createElement('div');
    nome.className = 'modelo-nome modelo-nome--excluido';
    const iconeNome = document.createElement('span');
    iconeNome.className = 'modelo-nome-icone';
    iconeNome.append(icone('documento'));
    const texto = document.createElement('span');
    texto.textContent = modelo.nome;
    nome.append(iconeNome, texto);
    celulaNome.append(nome);

    const data = document.createElement('td');
    data.className = 'cartao-data';
    data.textContent = modelo.excluidoEm ? formatarData(modelo.excluidoEm) : '—';

    const celulaAcoes = document.createElement('td');
    const acoes = document.createElement('div');
    acoes.className = 'cartao-acoes';
    const restaurar = botaoAcao('button', 'botao--secundario', 'restaurar', 'Restaurar');
    restaurar.type = 'button';
    restaurar.addEventListener('click', () => restaurarModelo(modelo));
    const apagar = botaoAcao('button', 'botao--fantasma botao--perigo-texto', 'lixeira', 'Excluir definitivamente');
    apagar.type = 'button';
    apagar.addEventListener('click', () => excluirDefinitivo(modelo));
    acoes.append(restaurar, apagar);
    celulaAcoes.append(acoes);

    linha.append(celulaNome, data, celulaAcoes);
    corpo.append(linha);
  }
}

async function abrirLixeira() {
  mostrar('carregando');
  try {
    excluidos = await api('/lixeira');
  } catch (erro) {
    avisar(`Não foi possível abrir a lixeira: ${erro.message}`, 'erro');
    excluidos = [];
  }
  renderizarLixeira();
  mostrar('lixeira');
}

async function restaurarModelo(modelo) {
  if (acaoLixeira) return;
  acaoLixeira = true;
  try {
    const restaurado = await api(`/lixeira/${modelo.id}/restaurar`, { method: 'POST' });
    avisar(restaurado.renomeado
      ? `Já havia um modelo com esse nome; restaurado como "${restaurado.nome}".`
      : `Modelo "${restaurado.nome}" restaurado.`);
    await abrirLixeira();
  } catch (erro) {
    avisar(`Não foi possível restaurar: ${erro.message}`, 'erro');
  } finally {
    acaoLixeira = false;
  }
}

async function excluirDefinitivo(modelo) {
  if (acaoLixeira) return;
  const ok = await confirmar({
    titulo: 'Excluir definitivamente',
    texto: ['O modelo ', negrito(modelo.nome), ' sairá da lixeira e não poderá mais ser restaurado pelo GERADOC. ',
      'Por segurança, uma última cópia fica guardada na pasta dados/backup.'],
    botao: 'Excluir definitivamente',
  });
  if (!ok) return;
  acaoLixeira = true;
  try {
    await api(`/lixeira/${modelo.id}`, { method: 'DELETE' });
    avisar(`Modelo "${modelo.nome}" excluído definitivamente.`);
    await abrirLixeira();
  } catch (erro) {
    avisar(`Não foi possível excluir: ${erro.message}`, 'erro');
  } finally {
    acaoLixeira = false;
  }
}

function preencherEditor(modelo) {
  modeloAtual = modelo;
  $('titulo-editor').textContent = modelo ? modelo.nome : 'Novo modelo';
  $('migalha-editor').textContent = modelo ? 'Editar modelo' : 'Novo modelo';
  $('nome-modelo').value = modelo?.nome ?? '';
  $('erro-nome').hidden = true;
  $('nome-modelo').classList.remove('campo-texto--erro');
  quill.setContents([]);
  if (modelo?.conteudo) quill.clipboard.dangerouslyPasteHTML(modelo.conteudo, 'silent');
  quill.history.clear();
  atualizarCamposEditor();
  estadoSalvo = snapshot();
  mostrar('editor');
  $('nome-modelo').focus();
}

async function abrirEditor(id) {
  if (!id) return preencherEditor(null);
  mostrar('carregando');
  try {
    preencherEditor(await api(`/modelos/${encodeURIComponent(id)}`));
  } catch (erro) {
    avisar(erro.message, 'erro');
    location.hash = '#/';
  }
}

function mostrarErroNome(texto) {
  $('erro-nome').textContent = texto;
  $('erro-nome').hidden = false;
  $('nome-modelo').classList.add('campo-texto--erro');
  $('nome-modelo').focus();
}

async function salvar(evento) {
  evento.preventDefault();
  if (salvando) return;
  const nome = $('nome-modelo').value.trim();
  if (!nome) return mostrarErroNome('Dê um nome ao modelo antes de salvar.');

  salvando = true;
  $('botao-salvar').disabled = true;
  try {
    const corpo = { nome, conteudo: conteudoEditor() };
    const salvo = modeloAtual
      ? await api(`/modelos/${modeloAtual.id}`, { method: 'PUT', body: corpo })
      : await api('/modelos', { method: 'POST', body: corpo });
    estadoSalvo = snapshot();
    avisar(`Modelo "${salvo.nome}" salvo.`);
    location.hash = '#/';
  } catch (erro) {
    if (erro.status === 409 || erro.status === 400) mostrarErroNome(erro.message);
    else avisar(`Não foi possível salvar: ${erro.message}`, 'erro');
  } finally {
    salvando = false;
    $('botao-salvar').disabled = false;
  }
}

async function confirmarExclusao(modelo) {
  const ok = await confirmar({
    titulo: 'Excluir modelo',
    texto: ['O modelo ', negrito(modelo.nome), ' será movido para a lixeira. Você pode restaurá-lo depois pela tela Lixeira.'],
    botao: 'Excluir',
  });
  if (!ok) return;
  try {
    await api(`/modelos/${modelo.id}`, { method: 'DELETE' });
    avisar(`Modelo "${modelo.nome}" movido para a lixeira.`);
    await abrirLista();
  } catch (erro) {
    avisar(`Não foi possível excluir: ${erro.message}`, 'erro');
  }
}

// ---------- Gerar: perguntas ----------
function atualizarPrevia() {
  const { modelo, campos, respostas } = geracao;
  $('previa').innerHTML = modelo.conteudo
    ? preencherHtml(modelo.conteudo, respostas, { marcar: true })
    : '<p class="previa-vazia">Este modelo está vazio. Edite-o para colocar o texto do documento.</p>';

  const total = campos.length;
  const feitas = total - camposPendentes(campos, respostas).length;
  $('progresso-contagem').textContent = total
    ? `${feitas} de ${total} ${total === 1 ? 'pergunta respondida' : 'perguntas respondidas'}`
    : 'Nenhuma pergunta';
  $('progresso-preenchido').style.width = total ? `${(feitas / total) * 100}%` : '100%';
  $('botao-gerar').classList.toggle('botao--pronto', feitas === total);
}

function montarPerguntas() {
  const { campos, respostas } = geracao;
  const container = $('perguntas');
  container.replaceChildren();
  campos.forEach((campo, indice) => {
    const id = `resposta-${indice}`;
    const grupo = document.createElement('div');
    grupo.className = 'pergunta';

    const rotulo = document.createElement('label');
    rotulo.className = 'rotulo';
    rotulo.htmlFor = id;
    rotulo.textContent = campo.chave;
    if (campo.ocorrencias > 1) {
      rotulo.append(' ', chip(`aparece ${campo.ocorrencias}×`, 'chip chip--mini'));
    }

    const entrada = document.createElement('input');
    entrada.id = id;
    entrada.className = 'campo-texto';
    entrada.type = 'text';
    entrada.autocomplete = 'off';
    entrada.value = respostas[campo.chave] ?? '';
    entrada.dataset.campo = campo.chave;
    entrada.addEventListener('input', () => {
      respostas[campo.chave] = entrada.value;
      entrada.classList.remove('campo-texto--erro');
      $('erro-respostas').hidden = true;
      atualizarPrevia();
      destacarNaPrevia(campo.chave, false);
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
    entrada.addEventListener('blur', () => destacarNaPrevia(null));

    grupo.append(rotulo, entrada);
    container.append(grupo);
  });
  $('sem-campos').hidden = campos.length > 0;
}

function destacarNaPrevia(chave, rolar = true) {
  let primeiro = null;
  for (const mark of $('previa').querySelectorAll('mark.campo')) {
    const ativo = mark.dataset.campo === chave;
    mark.classList.toggle('campo--ativo', ativo);
    if (ativo && !primeiro) primeiro = mark;
  }
  if (rolar) primeiro?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

async function abrirGerar(id) {
  mostrar('carregando');
  try {
    const modelo = await api(`/modelos/${encodeURIComponent(id)}`);
    geracao = { modelo, campos: camposDoHtml(modelo.conteudo), respostas: {} };
  } catch (erro) {
    avisar(erro.message, 'erro');
    location.hash = '#/';
    return;
  }
  const { modelo, campos } = geracao;
  $('titulo-gerar').textContent = modelo.nome;
  $('resumo-gerar').textContent = campos.length
    ? 'Responda às perguntas. As respostas entram no lugar dos campos entre colchetes.'
    : '';
  $('erro-respostas').hidden = true;
  montarPerguntas();
  atualizarPrevia();
  mostrar('gerar');
  $('resposta-0')?.focus();
}

function nomeDoCabecalho(cabecalho) {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(cabecalho ?? '');
  if (utf8) { try { return decodeURIComponent(utf8[1]); } catch { /* usa o padrão */ } }
  return 'documento.pdf';
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let gerandoPdf = false;
async function gerarDocumento(evento) {
  evento.preventDefault();
  const { modelo, campos, respostas } = geracao;
  if (!modelo.conteudo) return avisar('Este modelo está vazio.', 'erro');

  // Etapa 1, Q11: nada é gerado com campos sem resposta.
  const pendentes = camposPendentes(campos, respostas);
  for (const entrada of $('perguntas').querySelectorAll('input')) {
    entrada.classList.toggle('campo-texto--erro', pendentes.includes(entrada.dataset.campo));
  }
  if (pendentes.length) {
    $('erro-respostas').textContent = pendentes.length === 1
      ? `Falta responder: ${pendentes[0]}.`
      : `Faltam ${pendentes.length} respostas: ${pendentes.join(', ')}.`;
    $('erro-respostas').hidden = false;
    $('perguntas').querySelector('.campo-texto--erro')?.focus();
    return;
  }

  // O servidor monta o PDF a partir do modelo salvo + respostas (não recebe HTML daqui).
  if (gerandoPdf) return;
  gerandoPdf = true;
  const botao = $('botao-gerar');
  botao.disabled = true;
  botao.classList.add('botao--carregando');
  botao.querySelector('.botao-rotulo').textContent = 'Gerando PDF…';
  try {
    const resposta = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modeloId: modelo.id, respostas }),
    });
    if (!resposta.ok) {
      const dados = await resposta.json().catch(() => ({}));
      throw new Error(dados.erro || `Erro ${resposta.status}`);
    }
    const nome = nomeDoCabecalho(resposta.headers.get('Content-Disposition'));
    baixar(await resposta.blob(), nome);
    avisar(`PDF gerado: ${nome} (pasta Downloads).`);
  } catch (erro) {
    avisar(`Não foi possível gerar o PDF: ${erro.message}`, 'erro');
  } finally {
    gerandoPdf = false;
    botao.disabled = false;
    botao.classList.remove('botao--carregando');
    botao.querySelector('.botao-rotulo').textContent = 'Gerar PDF';
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

// ---------- Roteamento ----------
let hashAnterior = location.hash;
function rotear() {
  const pergunta = telas.gerar.hidden
    ? 'Há alterações não salvas neste modelo. Sair mesmo assim?'
    : 'As respostas digitadas serão perdidas. Sair mesmo assim?';
  if (temAlteracoes() && !confirm(pergunta)) {
    history.replaceState(null, '', hashAnterior || '#/');
    return;
  }
  hashAnterior = location.hash;
  const [, rota, id] = (location.hash.replace(/^#/, '') || '/').split('/');
  if (rota === 'novo') return abrirEditor(null);
  if (rota === 'editar' && id) return abrirEditor(id);
  if (rota === 'gerar' && id) return abrirGerar(id);
  if (rota === 'lixeira') return abrirLixeira();
  return abrirLista();
}

$('busca').addEventListener('input', renderizarLista);
$('nome-modelo').addEventListener('input', () => {
  $('erro-nome').hidden = true;
  $('nome-modelo').classList.remove('campo-texto--erro');
});
$('form-modelo').addEventListener('submit', salvar);
$('form-respostas').addEventListener('submit', gerarDocumento);
$('botao-limpar').addEventListener('click', limparRespostas);
window.addEventListener('hashchange', rotear);
window.addEventListener('beforeunload', (evento) => {
  if (temAlteracoes()) evento.preventDefault();
});

verificarServidor();
rotear();
