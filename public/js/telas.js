// GERADOC — telas de Histórico, Versões anteriores e Configurações.
import {
  $, api, avisar, botaoAcao, confirmar, formatarData, linhaTabela, negrito, plural,
} from './util.js';
import { configOuPadrao } from './pagina.js';

// ======================= Histórico =======================
let itensHistorico = [];
let nomesModelos = new Map(); // id → nome atual (o modelo pode ter sido renomeado ou excluído)

function resumoRespostas(respostas) {
  const valores = Object.values(respostas).map((v) => String(v).trim()).filter(Boolean);
  const texto = valores.slice(0, 3).join(' · ');
  return valores.length > 3 ? `${texto} · …` : texto;
}

function renderizarHistorico() {
  const termo = $('busca-historico').value.trim().toLocaleLowerCase('pt-BR');
  const filtrados = itensHistorico.filter((i) => !termo
    || i.modeloNome.toLocaleLowerCase('pt-BR').includes(termo)
    || Object.values(i.respostas).some((v) => String(v).toLocaleLowerCase('pt-BR').includes(termo)));
  const total = itensHistorico.length;
  $('historico-vazio').hidden = total > 0;
  $('busca-historico').closest('.painel-barra').hidden = total === 0;
  $('historico-cabecalho').hidden = filtrados.length === 0;
  $('historico-sem-resultado').hidden = total === 0 || filtrados.length > 0;
  $('botao-limpar-historico').hidden = total === 0;
  $('contagem-historico').textContent = termo ? `${filtrados.length} de ${total}` : plural(total, 'documento', 'documentos');

  const corpo = $('lista-historico');
  corpo.replaceChildren();
  for (const item of filtrados) {
    const existe = nomesModelos.has(item.modeloId);
    const formato = item.formato === 'docx' ? 'Word' : 'PDF';
    const acoes = [];
    if (existe) {
      const denovo = botaoAcao('a', 'botao--secundario', 'gerar', 'Gerar de novo');
      denovo.href = `#/gerar/${item.modeloId}/${item.id}`;
      denovo.title = 'Abrir com as mesmas respostas (dá para mudar antes de gerar)';
      acoes.push(denovo);
    }
    const excluir = botaoAcao('button', 'botao--fantasma botao--perigo-texto', 'lixeira', 'Excluir');
    excluir.title = 'Tirar este registro do histórico (não apaga arquivos baixados)';
    excluir.addEventListener('click', () => excluirRegistro(item));
    acoes.push(excluir);
    corpo.append(linhaTabela({
      nome: `${item.modeloNome} · ${formato}`,
      detalhe: (existe ? '' : '(modelo excluído) ') + resumoRespostas(item.respostas),
      data: formatarData(item.geradoEm),
      acoes,
    }));
  }
}

async function excluirRegistro(item) {
  try {
    await api(`/historico/${item.id}`, { method: 'DELETE' });
    itensHistorico = itensHistorico.filter((i) => i.id !== item.id);
    renderizarHistorico();
    avisar('Registro removido do histórico.');
  } catch (erro) {
    avisar(`Não foi possível excluir: ${erro.message}`, 'erro');
  }
}

export async function abrirHistorico(ctx) {
  ctx.mostrar('carregando');
  try {
    const [itens, modelos] = await Promise.all([api('/historico'), api('/modelos')]);
    itensHistorico = itens;
    nomesModelos = new Map(modelos.map((m) => [m.id, m.nome]));
  } catch (erro) {
    avisar(`Não foi possível abrir o histórico: ${erro.message}`, 'erro');
    itensHistorico = [];
  }
  renderizarHistorico();
  ctx.mostrar('historico');
}

$('busca-historico').addEventListener('input', renderizarHistorico);
$('botao-limpar-historico').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Limpar histórico',
    texto: ['Todos os ', negrito(plural(itensHistorico.length, 'registro', 'registros')), ' serão apagados do histórico, e as sugestões de respostas também. Os arquivos já baixados e os modelos não são afetados.'],
    botao: 'Limpar histórico',
  });
  if (!ok) return;
  try {
    await api('/historico', { method: 'DELETE' });
    itensHistorico = [];
    renderizarHistorico();
    avisar('Histórico limpo.');
  } catch (erro) {
    avisar(`Não foi possível limpar: ${erro.message}`, 'erro');
  }
});

// ======================= Versões anteriores =======================
let versaoModelo = null;
let versaoSelecionada = null;

async function selecionarVersao(versao, elemento) {
  for (const li of $('lista-versoes').children) li.classList.toggle('selecionada', li === elemento);
  $('botao-restaurar-versao').disabled = true;
  try {
    const dados = await api(`/modelos/${versaoModelo.id}/versoes/${versao.versao}`);
    versaoSelecionada = dados;
    $('titulo-versao').textContent = dados.nome || 'Versão';
    const previa = $('previa-versao');
    const config = configOuPadrao(dados.config);
    previa.style.fontFamily = `"${config.fonte}", "Segoe UI", system-ui, sans-serif`;
    previa.style.fontSize = `${config.tamanhoFonte}pt`;
    // A prévia mostra o modelo com os campos destacados, sem preencher nada.
    const { preencherHtml } = await import('./campos.js');
    previa.innerHTML = dados.conteudo
      ? preencherHtml(dados.conteudo, {}, { marcar: true })
      : '<p class="previa-vazia">Esta versão estava vazia.</p>';
    $('botao-restaurar-versao').disabled = false;
  } catch (erro) {
    avisar(erro.message, 'erro');
  }
}

export async function abrirVersoes(id, ctx) {
  ctx.mostrar('carregando');
  let versoes;
  try {
    [versaoModelo, versoes] = await Promise.all([api(`/modelos/${encodeURIComponent(id)}`), api(`/modelos/${encodeURIComponent(id)}/versoes`)]);
  } catch (erro) {
    avisar(erro.message, 'erro');
    location.hash = '#/';
    return;
  }
  versaoSelecionada = null;
  $('migalha-versoes-modelo').textContent = versaoModelo.nome;
  $('migalha-versoes-modelo').href = `#/editar/${versaoModelo.id}`;
  $('titulo-versao').textContent = 'Selecione uma versão';
  $('previa-versao').innerHTML = '';
  $('botao-restaurar-versao').disabled = true;
  $('contagem-versoes').textContent = versoes.length ? plural(versoes.length, 'versão', 'versões') : '';
  $('versoes-vazia').hidden = versoes.length > 0;
  const lista = $('lista-versoes');
  lista.replaceChildren();
  for (const v of versoes) {
    const li = document.createElement('li');
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'versao';
    const quando = document.createElement('strong');
    quando.textContent = `Salva em ${formatarData(v.atualizadoEm ?? v.guardadoEm)}`;
    const nome = document.createElement('span');
    nome.textContent = v.nome === versaoModelo.nome ? 'mesmo nome' : `nome: ${v.nome}`;
    botao.append(quando, nome);
    botao.addEventListener('click', () => selecionarVersao(v, li));
    li.append(botao);
    lista.append(li);
  }
  ctx.mostrar('versoes');
  if (versoes.length) selecionarVersao(versoes[0], lista.firstElementChild);
}

$('botao-restaurar-versao').addEventListener('click', async () => {
  if (!versaoSelecionada || !versaoModelo) return;
  const ok = await confirmar({
    titulo: 'Restaurar versão',
    texto: ['O modelo ', negrito(versaoModelo.nome), ' voltará a ficar como nesta versão. A versão atual fica guardada nesta mesma lista, então dá para desfazer.'],
    botao: 'Restaurar',
    perigo: false,
    nomeIcone: 'restaurar',
  });
  if (!ok) return;
  try {
    const { modelo, nomeMantido } = await api(`/modelos/${versaoModelo.id}/versoes/${versaoSelecionada.versao}/restaurar`, { method: 'POST' });
    avisar(nomeMantido
      ? `Versão restaurada. O nome antigo já é usado por outro modelo, então ficou "${modelo.nome}".`
      : `Versão restaurada em "${modelo.nome}".`);
    location.hash = `#/editar/${modelo.id}`;
  } catch (erro) {
    avisar(`Não foi possível restaurar: ${erro.message}`, 'erro');
  }
});

// ======================= Configurações =======================
function mostrarStatusBackup(estado) {
  const b = estado.backupExterno;
  const caixa = $('status-backup');
  caixa.className = 'status-backup';
  if (!b.pasta) {
    caixa.textContent = 'Backup externo desligado. Os modelos ficam só neste computador (e na pasta dados/backup).';
    caixa.classList.add('status-backup--neutro');
  } else if (b.ultimoErro) {
    caixa.textContent = b.ultimoErro;
    caixa.classList.add('status-backup--erro');
  } else if (b.ultimoEm) {
    caixa.textContent = `Último backup: ${formatarData(b.ultimoEm)}, em ${b.pasta}\\GERADOC-backup.`;
    caixa.classList.add('status-backup--ok');
  } else {
    caixa.textContent = `Backup ligado para ${b.pasta}. A primeira cópia é feita em instantes.`;
    caixa.classList.add('status-backup--neutro');
  }
  $('botao-backup-agora').hidden = !b.pasta;
  $('botao-desligar-backup').hidden = !b.pasta;
}

function mostrarSugestoes(sugestoes) {
  const caixa = $('sugestoes-pasta');
  caixa.replaceChildren();
  if (!sugestoes.length) return;
  caixa.append(Object.assign(document.createElement('span'), { className: 'dica', textContent: 'Encontradas neste computador:' }));
  for (const s of sugestoes) {
    const botao = botaoAcao('button', 'botao--secundario', 'pasta', `${s.rotulo} (${s.pasta})`);
    botao.addEventListener('click', () => {
      $('cfg-pasta-backup').value = s.pasta;
      $('cfg-pasta-backup').focus();
    });
    caixa.append(botao);
  }
}

export async function abrirConfiguracoes(ctx) {
  ctx.mostrar('carregando');
  try {
    const [estado, saude] = await Promise.all([api('/configuracoes'), api('/saude')]);
    $('cfg-pasta-backup').value = estado.backupExterno.pasta ?? '';
    $('erro-backup').hidden = true;
    mostrarStatusBackup(estado);
    mostrarSugestoes(estado.sugestoesPasta);
    $('sobre-versao').textContent = saude.versao;
    $('sobre-pasta').textContent = estado.pastaDados;
    $('botao-encerrar').closest('.secao').hidden = !saude.podeEncerrar;
  } catch (erro) {
    avisar(`Não foi possível abrir as configurações: ${erro.message}`, 'erro');
  }
  ctx.mostrar('configuracoes');
}

async function salvarPastaBackup(pasta) {
  const botao = $('botao-salvar-backup');
  botao.disabled = true;
  botao.classList.add('botao--carregando');
  try {
    const estado = await api('/configuracoes/backup', { method: 'PUT', body: { pasta } });
    $('erro-backup').hidden = true;
    $('cfg-pasta-backup').classList.remove('campo-texto--erro');
    $('cfg-pasta-backup').value = estado.backupExterno.pasta ?? '';
    mostrarStatusBackup(estado);
    avisar(pasta ? 'Backup externo ligado e cópia feita.' : 'Backup externo desligado.');
  } catch (erro) {
    $('erro-backup').textContent = erro.message;
    $('erro-backup').hidden = false;
    $('cfg-pasta-backup').classList.add('campo-texto--erro');
  } finally {
    botao.disabled = false;
    botao.classList.remove('botao--carregando');
  }
}

$('botao-salvar-backup').addEventListener('click', () => salvarPastaBackup($('cfg-pasta-backup').value.trim()));
$('cfg-pasta-backup').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') salvarPastaBackup($('cfg-pasta-backup').value.trim());
});
$('botao-desligar-backup').addEventListener('click', () => {
  $('cfg-pasta-backup').value = '';
  salvarPastaBackup('');
});
$('botao-backup-agora').addEventListener('click', async () => {
  const botao = $('botao-backup-agora');
  botao.disabled = true;
  try {
    const estado = await api('/backup-externo', { method: 'POST' });
    mostrarStatusBackup(estado);
    if (estado.backupExterno.ultimoErro) avisar(estado.backupExterno.ultimoErro, 'erro');
    else avisar('Backup feito.');
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    botao.disabled = false;
  }
});

$('botao-atalho').addEventListener('click', async () => {
  const botao = $('botao-atalho');
  botao.disabled = true;
  try {
    await api('/atalho', { method: 'POST' });
    avisar('Atalho GERADOC criado na Área de Trabalho.');
  } catch (erro) {
    avisar(erro.message, 'erro');
  } finally {
    botao.disabled = false;
  }
});

$('botao-encerrar').addEventListener('click', async () => {
  const ok = await confirmar({
    titulo: 'Encerrar o GERADOC',
    texto: ['O GERADOC será desligado. Para usar de novo, abra pelo atalho ou pelo GERADOC.bat.'],
    botao: 'Encerrar',
    perigo: false,
    nomeIcone: 'desligar',
  });
  if (!ok) return;
  try {
    await api('/encerrar', { method: 'POST' });
  } catch { /* o servidor pode cair antes de responder */ }
  location.hash = '#/encerrado';
});
