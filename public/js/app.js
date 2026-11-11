// GERADOC — frontend: navegação, lista de modelos, lixeira e importação.
// Navegação por hash: #/  ·  #/novo  ·  #/editar/<id>  ·  #/gerar/<id>[/<historico>]  ·  #/lixeira
//                     #/versoes/<id>  ·  #/historico  ·  #/configuracoes
import {
  $, api, avisar, botaoAcao, confirmar, formatarData, linhaTabela, negrito, plural,
} from './util.js';
import { abrirEditor, editorTemAlteracoes } from './editor.js';
import { abrirGerar, gerarTemAlteracoes } from './gerar.js';
import { abrirConfiguracoes, abrirHistorico, abrirVersoes } from './telas.js';

const telas = {
  lista: $('tela-lista'),
  editor: $('tela-editor'),
  gerar: $('tela-gerar'),
  lixeira: $('tela-lixeira'),
  versoes: $('tela-versoes'),
  historico: $('tela-historico'),
  configuracoes: $('tela-configuracoes'),
  encerrado: $('tela-encerrado'),
  carregando: $('tela-carregando'),
};

// Seção do menu do topo destacada para cada tela.
const SECOES = { lista: 'modelos', editor: 'modelos', gerar: 'modelos', lixeira: 'modelos', versoes: 'modelos', historico: 'historico', configuracoes: 'configuracoes' };

function mostrar(nome) {
  for (const [chave, tela] of Object.entries(telas)) tela.hidden = chave !== nome;
  if (nome === 'carregando') return;
  for (const item of document.querySelectorAll('.menu-item')) {
    const ativo = item.dataset.secao === SECOES[nome];
    item.classList.toggle('menu-item--ativo', ativo);
    if (ativo) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

const ctx = {
  mostrar,
  depoisDeSalvar: () => { location.hash = '#/'; },
};

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

// ---------- Lista de modelos ----------
let modelos = [];

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
    const gerar = botaoAcao('a', 'botao--primario', 'gerar', 'Gerar documento');
    gerar.href = `#/gerar/${modelo.id}`;

    const editar = botaoAcao('a', 'botao--fantasma', 'editar', 'Editar');
    editar.href = `#/editar/${modelo.id}`;

    const duplicar = botaoAcao('button', 'botao--fantasma', 'duplicar', 'Duplicar');
    duplicar.title = 'Criar uma cópia deste modelo';
    duplicar.addEventListener('click', () => duplicarModelo(modelo, duplicar));

    const excluir = botaoAcao('button', 'botao--fantasma botao--perigo-texto', 'lixeira', 'Excluir');
    excluir.addEventListener('click', () => confirmarExclusao(modelo));

    const linha = linhaTabela({
      nome: modelo.nome,
      href: `#/gerar/${modelo.id}`,
      titulo: 'Gerar documento com este modelo',
      data: formatarData(modelo.atualizadoEm),
      dataTitulo: `Criado em ${formatarData(modelo.criadoEm)}`,
      acoes: [gerar, editar, duplicar, excluir],
    });
    linha.className = 'cartao-modelo';
    lista.append(linha);
  }
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

// ---------- Importar ----------
function escolherArquivoImportar() {
  $('arquivo-importar').value = '';
  $('arquivo-importar').click();
}

$('arquivo-importar').addEventListener('change', async () => {
  const arquivo = $('arquivo-importar').files?.[0];
  if (!arquivo) return;
  let dados;
  try {
    dados = JSON.parse(await arquivo.text());
  } catch {
    return avisar('Este arquivo não é uma exportação do GERADOC (JSON inválido).', 'erro');
  }
  try {
    const { importados, ignorados } = await api('/importar', { method: 'POST', body: dados });
    const renomeados = importados.filter((i) => i.renomeado).length;
    let texto = `${plural(importados.length, 'modelo importado', 'modelos importados')}.`;
    if (renomeados) texto += ` ${plural(renomeados, 'ganhou', 'ganharam')} "(importado)" no nome por já existir.`;
    if (ignorados.length) texto += ` ${plural(ignorados.length, 'modelo ignorado', 'modelos ignorados')}: ${ignorados.map((i) => `${i.nome} (${i.motivo})`).join('; ')}`;
    avisar(texto, importados.length ? 'ok' : 'erro');
    if (location.hash === '#/' || location.hash === '') await abrirLista();
    else location.hash = '#/';
  } catch (erro) {
    avisar(`Não foi possível importar: ${erro.message}`, 'erro');
  }
});
$('botao-importar').addEventListener('click', escolherArquivoImportar);
$('botao-importar-config').addEventListener('click', escolherArquivoImportar);

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
    const restaurar = botaoAcao('button', 'botao--secundario', 'restaurar', 'Restaurar');
    restaurar.addEventListener('click', () => restaurarModelo(modelo));
    const apagar = botaoAcao('button', 'botao--fantasma botao--perigo-texto', 'lixeira', 'Excluir definitivamente');
    apagar.addEventListener('click', () => excluirDefinitivo(modelo));
    corpo.append(linhaTabela({
      nome: modelo.nome,
      excluido: true,
      data: modelo.excluidoEm ? formatarData(modelo.excluidoEm) : '—',
      acoes: [restaurar, apagar],
    }));
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

// ---------- Roteamento ----------
function temAlteracoes() {
  if (!telas.editor.hidden) return editorTemAlteracoes();
  if (!telas.gerar.hidden) return gerarTemAlteracoes();
  return false;
}

let hashAnterior = location.hash;
function rotear() {
  const pergunta = telas.gerar.hidden
    ? 'Há alterações não salvas neste modelo. Sair mesmo assim?'
    : 'As respostas digitadas serão perdidas. Sair mesmo assim?';
  if (location.hash !== hashAnterior && temAlteracoes() && !confirm(pergunta)) {
    history.replaceState(null, '', hashAnterior || '#/');
    return;
  }
  hashAnterior = location.hash;
  const [, rota, id, extra] = (location.hash.replace(/^#/, '') || '/').split('/');
  if (rota === 'novo') return abrirEditor(null, ctx);
  if (rota === 'editar' && id) return abrirEditor(id, ctx);
  if (rota === 'gerar' && id) return abrirGerar(id, extra ?? null, ctx);
  if (rota === 'versoes' && id) return abrirVersoes(id, ctx);
  if (rota === 'lixeira') return abrirLixeira();
  if (rota === 'historico') return abrirHistorico(ctx);
  if (rota === 'configuracoes') return abrirConfiguracoes(ctx);
  if (rota === 'encerrado') {
    mostrar('encerrado');
    $('status').textContent = 'Encerrado';
    $('status').className = 'status status--erro';
    return undefined;
  }
  return abrirLista();
}

$('busca').addEventListener('input', renderizarLista);
window.addEventListener('hashchange', rotear);
window.addEventListener('beforeunload', (evento) => {
  if (temAlteracoes()) evento.preventDefault();
});

verificarServidor();
rotear();
