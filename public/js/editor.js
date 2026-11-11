// GERADOC — tela de criar/editar modelo.
// Conteúdo, cabeçalho e rodapé (editores Quill), imagens, quebra de página, inserir campo e configuração de página.
import { $, api, avisar, chip, lerImagem } from './util.js';
import { camposDoHtml, FORMATOS, rotuloTipo } from './campos.js';
import {
  CONFIG_PADRAO, FONTES, NUMERACAO, PAPEIS, ErroConfig, configOuPadrao, htmlVazio, validarConfig,
} from './pagina.js';

const Quill = window.Quill;

// ---------- Quebra de página (linha <hr class="quebra-pagina">) ----------
const BlockEmbed = Quill.import('blots/block/embed');
class QuebraPagina extends BlockEmbed {
  static blotName = 'quebra-pagina';
  static tagName = 'hr';
  static className = 'quebra-pagina';
}
Quill.register(QuebraPagina);

const ICONE_QUEBRA = '<svg viewBox="0 0 18 18"><path class="ql-stroke" d="M3 3v4h12V3M3 15v-4h12v4"/><path class="ql-stroke" stroke-dasharray="2 1.5" d="M1 9h16"/></svg>';

/** Pede uma imagem ao usuário e insere no editor (reduzida para não pesar o modelo). */
function inserirImagem(quill) {
  const entrada = document.createElement('input');
  entrada.type = 'file';
  entrada.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp';
  entrada.addEventListener('change', async () => {
    const arquivo = entrada.files?.[0];
    if (!arquivo) return;
    try {
      const dados = await lerImagem(arquivo);
      const posicao = quill.getSelection(true)?.index ?? quill.getLength();
      quill.insertEmbed(posicao, 'image', dados, 'user');
      quill.setSelection(posicao + 1, 0, 'silent');
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  });
  entrada.click();
}

function criarEditor(seletor, { placeholder, completo }) {
  const toolbar = completo
    ? [
      [{ header: [1, 2, 3, false] }],
      [{ size: ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
      ['image', 'quebra-pagina'],
      ['clean'],
    ]
    : [
      [{ size: ['small', false, 'large'] }],
      ['bold', 'italic', 'underline'],
      [{ color: [] }],
      [{ align: [] }],
      ['image'],
      ['clean'],
    ];
  const quill = new Quill(seletor, {
    theme: 'snow',
    placeholder,
    modules: {
      toolbar: {
        container: toolbar,
        handlers: {
          image() { inserirImagem(quill); },
          'quebra-pagina'() {
            const posicao = quill.getSelection(true)?.index ?? quill.getLength();
            quill.insertEmbed(posicao, 'quebra-pagina', true, 'user');
            quill.setSelection(posicao + 1, 0, 'silent');
          },
        },
      },
    },
  });
  const barra = quill.getModule('toolbar').container;
  const botaoQuebra = barra.querySelector('button.ql-quebra-pagina');
  if (botaoQuebra) {
    botaoQuebra.innerHTML = ICONE_QUEBRA;
    botaoQuebra.title = 'Quebra de página (o que vier depois começa numa nova página)';
  }
  barra.querySelector('button.ql-image')?.setAttribute('title', 'Inserir imagem (logotipo, assinatura…)');
  return quill;
}

const quill = criarEditor('#editor', { placeholder: 'Ex.: Eu, [NOME], portador do CPF [CPF:cpf], declaro que…', completo: true });
const quillCabecalho = criarEditor('#editor-cabecalho', { placeholder: 'Ex.: logotipo e nome da empresa (opcional)', completo: false });
const quillRodape = criarEditor('#editor-rodape', { placeholder: 'Ex.: endereço e telefone (opcional)', completo: false });
const editores = [quill, quillCabecalho, quillRodape];

// ---------- Tamanho das imagens ----------
const ferramenta = $('ferramenta-imagem');
document.body.append(ferramenta);
let imagemSelecionada = null;

function esconderFerramenta() {
  ferramenta.hidden = true;
  imagemSelecionada?.classList.remove('imagem-selecionada');
  imagemSelecionada = null;
}

for (const q of editores) {
  q.root.addEventListener('click', (evento) => {
    if (evento.target.tagName !== 'IMG') return esconderFerramenta();
    esconderFerramenta();
    imagemSelecionada = evento.target;
    imagemSelecionada.classList.add('imagem-selecionada');
    const r = imagemSelecionada.getBoundingClientRect();
    ferramenta.hidden = false;
    ferramenta.style.top = `${window.scrollY + r.bottom + 6}px`;
    ferramenta.style.left = `${window.scrollX + r.left}px`;
  });
  q.on('text-change', () => { if (imagemSelecionada && !imagemSelecionada.isConnected) esconderFerramenta(); });
}
document.addEventListener('mousedown', (evento) => {
  if (!ferramenta.hidden && !ferramenta.contains(evento.target) && evento.target !== imagemSelecionada) esconderFerramenta();
});
ferramenta.addEventListener('click', (evento) => {
  const botao = evento.target.closest('button[data-largura]');
  if (!botao || !imagemSelecionada) return;
  if (botao.dataset.largura) imagemSelecionada.setAttribute('width', botao.dataset.largura);
  else imagemSelecionada.removeAttribute('width');
  imagemSelecionada.removeAttribute('height');
  for (const q of editores) q.update('user');
  esconderFerramenta();
});

// ---------- Inserir campo ----------
const seletorTipo = $('inserir-campo-tipo');
for (const [valor, { rotulo }] of Object.entries(FORMATOS)) {
  seletorTipo.add(new Option(rotulo, valor));
}
seletorTipo.add(new Option('Lista de opções', 'opcoes'));
function atualizarExemplo() {
  const lista = seletorTipo.value === 'opcoes';
  $('inserir-campo-opcoes').hidden = !lista;
  $('inserir-campo-exemplo').textContent = lista ? 'Sai como: a opção escolhida' : `Sai como: ${FORMATOS[seletorTipo.value].exemplo}`;
}
seletorTipo.addEventListener('change', atualizarExemplo);
atualizarExemplo();

function nomeParaInserir() {
  const nome = $('inserir-campo-nome').value.replace(/[[\]:|=<>]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
  if (!nome) {
    $('inserir-campo-nome').focus();
    avisar('Digite o nome do campo (ex.: VALOR).', 'erro');
  }
  return nome;
}

function inserirCampo() {
  const nome = nomeParaInserir();
  if (!nome) return;
  const opcional = $('inserir-campo-opcional').checked;
  let sufixo = seletorTipo.value === 'texto' ? '' : seletorTipo.value;
  if (seletorTipo.value === 'opcoes') {
    const opcoes = $('inserir-campo-opcoes').value.split(/[|;,]/).map((o) => o.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (opcoes.length < 2) {
      $('inserir-campo-opcoes').focus();
      avisar('Escreva pelo menos duas opções, separadas por | (ex.: solteiro | casado).', 'erro');
      return;
    }
    sufixo = ` ${[...opcoes, ...(opcional ? ['opcional'] : [])].join(' | ')}`;
  } else if (opcional) {
    sufixo = sufixo ? `${sufixo} opcional` : 'opcional';
  }
  const texto = sufixo ? `[${nome}:${sufixo}]` : `[${nome}]`;
  const posicao = quill.getSelection(true)?.index ?? quill.getLength() - 1;
  quill.insertText(posicao, texto, 'user');
  quill.setSelection(posicao + texto.length, 0, 'user');
  $('inserir-campo-nome').value = '';
  $('inserir-campo-opcoes').value = '';
  $('inserir-campo-opcional').checked = false;
}

/** Envolve o trecho selecionado em [SE CAMPO] … [FIM SE]. */
function inserirCondicao() {
  const nome = nomeParaInserir();
  if (!nome) return;
  const selecao = quill.getSelection(true) ?? { index: quill.getLength() - 1, length: 0 };
  const abre = `[SE ${nome}]`;
  const fecha = '[FIM SE]';
  quill.insertText(selecao.index + selecao.length, fecha, 'user');
  quill.insertText(selecao.index, abre, 'user');
  quill.setSelection(selecao.index + abre.length, selecao.length, 'user');
  $('inserir-campo-nome').value = '';
  avisar(selecao.length
    ? `O trecho selecionado só aparece se ${nome} for respondido (ou marcado como Sim).`
    : `Escreva entre [SE ${nome}] e [FIM SE] o que só aparece se ${nome} for respondido (ou marcado como Sim).`);
}
$('inserir-condicao-botao').addEventListener('click', inserirCondicao);
$('inserir-campo-botao').addEventListener('click', inserirCampo);
$('inserir-campo-nome').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') {
    evento.preventDefault();
    inserirCampo();
  }
});

// ---------- Configuração da página ----------
for (const [valor, { rotulo }] of Object.entries(PAPEIS)) $('cfg-papel').add(new Option(rotulo, valor));
for (const fonte of FONTES) {
  const opcao = new Option(fonte, fonte);
  opcao.style.fontFamily = `"${fonte}"`;
  $('cfg-fonte').add(opcao);
}
for (const [valor, rotulo] of Object.entries(NUMERACAO)) $('cfg-numeracao').add(new Option(rotulo, valor));

const LADOS = ['superior', 'inferior', 'esquerda', 'direita'];

function htmlDe(q) {
  // Editor vazio no Quill = "<p><br></p>"; guardamos string vazia nesse caso.
  // Usa o HTML interno do Quill (classes ql-*) — reabre idêntico e é renderizado no PDF com o CSS do Quill.
  const html = q.root.innerHTML;
  return htmlVazio(html) && !q.root.querySelector('hr') ? '' : html;
}

function lerConfig() {
  const margens = {};
  for (const lado of LADOS) margens[lado] = $(`cfg-m-${lado}`).value;
  return {
    papel: $('cfg-papel').value,
    orientacao: $('cfg-orientacao').value,
    margens,
    fonte: $('cfg-fonte').value,
    tamanhoFonte: $('cfg-tamanho').value,
    cabecalho: htmlDe(quillCabecalho),
    rodape: htmlDe(quillRodape),
    numeracao: $('cfg-numeracao').value,
    nomeArquivo: $('cfg-nome-arquivo').value.replace(/\s+/g, ' ').trim(),
  };
}

function preencherConfig(config) {
  const c = configOuPadrao(config);
  $('cfg-papel').value = c.papel;
  $('cfg-orientacao').value = c.orientacao;
  for (const lado of LADOS) $(`cfg-m-${lado}`).value = c.margens[lado];
  $('cfg-fonte').value = c.fonte;
  $('cfg-tamanho').value = c.tamanhoFonte;
  $('cfg-numeracao').value = c.numeracao;
  $('cfg-nome-arquivo').value = c.nomeArquivo;
  for (const [q, html] of [[quillCabecalho, c.cabecalho], [quillRodape, c.rodape]]) {
    q.setContents([]);
    if (html) q.clipboard.dangerouslyPasteHTML(html, 'silent');
    q.history.clear();
  }
  aplicarFonte();
}

/** O editor mostra a fonte e o tamanho escolhidos (12 pt = 16 px, igual à folha). */
function aplicarFonte() {
  const fonte = $('cfg-fonte').value || CONFIG_PADRAO.fonte;
  const tamanho = Number($('cfg-tamanho').value) || CONFIG_PADRAO.tamanhoFonte;
  for (const q of editores) {
    q.root.style.fontFamily = `"${fonte}", "Segoe UI", system-ui, sans-serif`;
    q.root.style.fontSize = `${Math.min(20, Math.max(8, tamanho))}pt`;
  }
}

function validarConfigNaTela() {
  try {
    validarConfig(lerConfig());
    $('erro-config').hidden = true;
    return true;
  } catch (erro) {
    if (!(erro instanceof ErroConfig)) throw erro;
    $('erro-config').textContent = erro.message;
    $('erro-config').hidden = false;
    return false;
  }
}

for (const id of ['cfg-fonte', 'cfg-tamanho']) $(id).addEventListener('input', aplicarFonte);
// Valida enquanto se digita (evento "input"): se a mensagem sumisse só ao sair do campo, o layout
// mudaria no meio do clique em "Salvar" e o clique se perderia.
for (const id of ['cfg-papel', 'cfg-orientacao', ...LADOS.map((l) => `cfg-m-${l}`), 'cfg-tamanho']) {
  $(id).addEventListener('input', validarConfigNaTela);
}

// ---------- Perguntas geradas (ao vivo) ----------
function atualizarCamposEditor() {
  const campos = camposDoHtml(htmlDe(quillCabecalho), htmlDe(quill), htmlDe(quillRodape));
  const alvo = $('lista-campos-editor');
  if (!campos.length) {
    alvo.replaceChildren(chip('Nenhuma ainda — use [NOME], [CPF:cpf]…', 'chip chip--vazio'));
    return;
  }
  alvo.replaceChildren(...campos.map((c) => {
    let texto = c.ocorrencias > 1 ? `${c.chave} ×${c.ocorrencias}` : c.chave;
    if (c.automatico) texto += ' · automático';
    else if (c.tipo !== 'texto') texto += ` · ${c.tipo}`;
    if (c.opcional) texto += ' · opcional';
    const el = chip(texto, c.automatico ? 'chip chip--auto' : 'chip');
    el.title = c.automatico
      ? 'Preenchido sozinho com a data do dia'
      : `${rotuloTipo(c.tipo)}${c.opcoes ? ` (${c.opcoes.join(', ')})` : ''}${c.formatos.length ? ` — formatos usados: ${c.formatos.map(rotuloTipo).join(', ')}` : ' — usado em condição ou conta'}`;
    return el;
  }));
}

let temporizadorCampos;
for (const q of editores) {
  q.on('text-change', () => {
    clearTimeout(temporizadorCampos);
    temporizadorCampos = setTimeout(atualizarCamposEditor, 200);
  });
}

// ---------- Abrir / salvar ----------
let modeloAtual = null;    // modelo aberto no editor (null = novo)
let estadoSalvo = '';      // snapshot para detectar alterações não salvas
let salvando = false;
let aoSalvar = () => {};

function snapshot() {
  return JSON.stringify([$('nome-modelo').value.trim(), htmlDe(quill), lerConfig()]);
}

export function editorTemAlteracoes() {
  return snapshot() !== estadoSalvo;
}

function preencherEditor(modelo) {
  modeloAtual = modelo;
  esconderFerramenta();
  $('titulo-editor').textContent = modelo ? modelo.nome : 'Novo modelo';
  $('migalha-editor').textContent = modelo ? 'Editar modelo' : 'Novo modelo';
  $('acoes-editor-existente').hidden = !modelo;
  if (modelo) {
    $('link-versoes').href = `#/versoes/${modelo.id}`;
    $('link-exportar-modelo').href = `/api/modelos/${modelo.id}/exportar`;
  }
  $('nome-modelo').value = modelo?.nome ?? '';
  $('erro-nome').hidden = true;
  $('erro-config').hidden = true;
  $('nome-modelo').classList.remove('campo-texto--erro');
  quill.setContents([]);
  if (modelo?.conteudo) quill.clipboard.dangerouslyPasteHTML(modelo.conteudo, 'silent');
  quill.history.clear();
  preencherConfig(modelo?.config);
  atualizarCamposEditor();
  estadoSalvo = snapshot();
}

/** @param {string|null} id  @param {{ mostrar: (tela: string) => void, depoisDeSalvar: () => void }} ctx */
export async function abrirEditor(id, ctx) {
  aoSalvar = ctx.depoisDeSalvar;
  if (!id) {
    preencherEditor(null);
    ctx.mostrar('editor');
    $('nome-modelo').focus();
    return;
  }
  ctx.mostrar('carregando');
  try {
    preencherEditor(await api(`/modelos/${encodeURIComponent(id)}`));
    ctx.mostrar('editor');
    $('nome-modelo').focus();
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
  if (!validarConfigNaTela()) {
    $('erro-config').scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }

  salvando = true;
  $('botao-salvar').disabled = true;
  try {
    const corpo = { nome, conteudo: htmlDe(quill), config: lerConfig() };
    const salvo = modeloAtual
      ? await api(`/modelos/${modeloAtual.id}`, { method: 'PUT', body: corpo })
      : await api('/modelos', { method: 'POST', body: corpo });
    estadoSalvo = snapshot();
    avisar(`Modelo "${salvo.nome}" salvo.`);
    aoSalvar(salvo);
  } catch (erro) {
    if (erro.status === 409 || (erro.status === 400 && /nome/i.test(erro.message))) mostrarErroNome(erro.message);
    else avisar(`Não foi possível salvar: ${erro.message}`, 'erro');
  } finally {
    salvando = false;
    $('botao-salvar').disabled = false;
  }
}

$('nome-modelo').addEventListener('input', () => {
  $('erro-nome').hidden = true;
  $('nome-modelo').classList.remove('campo-texto--erro');
});
$('form-modelo').addEventListener('submit', salvar);
// Enter num campo de configuração não envia o formulário sem querer.
$('form-modelo').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter' && evento.target.matches('input:not(#nome-modelo)')) evento.preventDefault();
});
