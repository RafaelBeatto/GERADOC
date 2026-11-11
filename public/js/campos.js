// GERADOC — campos [X] dos modelos.
// Regras (aprovadas em 2026-11-10):
//  - não diferencia maiúsculas: [Nome], [NOME] e [nome] são o mesmo campo, exibido em MAIÚSCULAS;
//  - espaços nas pontas são ignorados ([ NOME ] = [NOME]); espaços repetidos no meio contam como um;
//  - acentos diferenciam ([ENDEREÇO] ≠ [ENDERECO]);
//  - campos com o mesmo nome geram UMA pergunta, e a resposta substitui todas as ocorrências.
//
// v1.1 — tipos de campo: [CAMPO:formato]. Ex.: [DATA:data], [CPF:cpf], [VALOR:moeda], [VALOR:extenso].
//  - o formato não muda o nome: [VALOR:moeda] e [VALOR:extenso] são a MESMA pergunta, escrita de dois jeitos;
//  - o formato só vale se for um dos conhecidos (FORMATOS); senão o texto todo é o nome ([OBS: livre] continua igual);
//  - [HOJE] é preenchido sozinho com a data do dia (não vira pergunta).
//
// As funções "puras" (sem DOM) rodam no navegador e no Node (testes / servidor).
// As funções "*Html" usam o DOM e só rodam no navegador.

export const CAMPO_MAX = 80;

// Um campo é qualquer texto entre [ e ] sem outros colchetes nem quebra de linha.
const REGEX_CAMPO = /\[([^[\]\n]+)\]/g;

/** Campos preenchidos automaticamente (não viram pergunta). */
export const CAMPOS_AUTOMATICOS = { HOJE: 'data' };

/**
 * Formatos aceitos depois dos dois-pontos. "tipo" define o tipo da pergunta (o que se digita);
 * "exemplo" é como a resposta aparece no documento.
 */
export const FORMATOS = {
  texto: { tipo: 'texto', rotulo: 'Texto livre', exemplo: 'como foi digitado' },
  maiusculas: { tipo: 'texto', rotulo: 'Texto em MAIÚSCULAS', exemplo: 'MARIA DA SILVA' },
  data: { tipo: 'data', rotulo: 'Data', exemplo: '11/11/2026' },
  'data-extenso': { tipo: 'data', rotulo: 'Data por extenso', exemplo: '11 de novembro de 2026' },
  cpf: { tipo: 'cpf', rotulo: 'CPF', exemplo: '123.456.789-09' },
  cnpj: { tipo: 'cnpj', rotulo: 'CNPJ', exemplo: '12.345.678/0001-95' },
  cep: { tipo: 'cep', rotulo: 'CEP', exemplo: '01310-100' },
  telefone: { tipo: 'telefone', rotulo: 'Telefone', exemplo: '(11) 98765-4321' },
  moeda: { tipo: 'moeda', rotulo: 'Valor em reais', exemplo: 'R$ 1.500,00' },
  extenso: { tipo: null, rotulo: 'Valor (ou data) por extenso', exemplo: 'mil e quinhentos reais' },
  numero: { tipo: 'numero', rotulo: 'Número', exemplo: '1.500' },
  'numero-extenso': { tipo: 'numero', rotulo: 'Número por extenso', exemplo: 'mil e quinhentos' },
};

const APELIDOS = {
  'data extenso': 'data-extenso', dataextenso: 'data-extenso', 'data-por-extenso': 'data-extenso',
  'numero extenso': 'numero-extenso', 'número-extenso': 'numero-extenso', 'número extenso': 'numero-extenso',
  'número': 'numero', 'maiúsculas': 'maiusculas', maiuscula: 'maiusculas', 'maiúscula': 'maiusculas',
  valor: 'moeda', reais: 'moeda', dinheiro: 'moeda', fone: 'telefone', celular: 'telefone',
  'valor-extenso': 'extenso', 'moeda-extenso': 'extenso', 'valor extenso': 'extenso',
};

export function normalizarCampo(nome) {
  return String(nome ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
}

function normalizarFormato(texto) {
  const f = String(texto).replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  if (FORMATOS[f]) return f;
  return APELIDOS[f] ?? null;
}

/** "Valor : Moeda" → { chave: 'VALOR', formato: 'moeda' }. Formato desconhecido = parte do nome. */
export function analisarCampo(interno) {
  const texto = String(interno ?? '');
  const pos = texto.lastIndexOf(':');
  if (pos > 0) {
    const formato = normalizarFormato(texto.slice(pos + 1));
    const chave = normalizarCampo(texto.slice(0, pos));
    if (formato && chave) return { chave, formato };
  }
  return { chave: normalizarCampo(texto), formato: null };
}

function campoValido(chave) {
  return chave.length > 0 && chave.length <= CAMPO_MAX;
}

/**
 * Localiza os campos num bloco de texto que pode estar quebrado em pedaços
 * (no editor, "[NO<b>ME</b>]" vira os pedaços "[NO" e "ME]").
 * Retorna, para cada ocorrência, a chave normalizada, o formato e os trechos de cada pedaço que ela ocupa.
 */
export function localizarCampos(pedacos) {
  const texto = pedacos.join('');
  const inicios = [];
  let soma = 0;
  for (const p of pedacos) { inicios.push(soma); soma += p.length; }

  const ocorrencias = [];
  for (const m of texto.matchAll(REGEX_CAMPO)) {
    const { chave, formato } = analisarCampo(m[1]);
    if (!campoValido(chave)) continue;
    const de = m.index;
    const ate = m.index + m[0].length;
    const partes = [];
    pedacos.forEach((p, i) => {
      const a = Math.max(de, inicios[i]);
      const b = Math.min(ate, inicios[i] + p.length);
      if (a < b) partes.push({ i, de: a - inicios[i], ate: b - inicios[i] });
    });
    ocorrencias.push({ chave, formato, original: m[0], partes });
  }
  return ocorrencias;
}

/**
 * Tipo da pergunta: o do primeiro formato que define tipo (data, cpf, moeda…).
 * Só "extenso" → moeda. Nada → texto. Campos automáticos têm tipo fixo.
 */
function tipoDoCampo(chave, formatos) {
  if (CAMPOS_AUTOMATICOS[chave]) return CAMPOS_AUTOMATICOS[chave];
  for (const f of formatos) {
    const tipo = FORMATOS[f]?.tipo;
    if (tipo && tipo !== 'texto') return tipo;
  }
  return formatos.includes('extenso') ? 'moeda' : 'texto';
}

/**
 * Lista de campos únicos, na ordem da primeira aparição:
 * { chave, ocorrencias, tipo, formatos[], automatico }.
 */
export function extrairCampos(blocos) {
  const mapa = new Map();
  for (const pedacos of blocos) {
    for (const { chave, formato } of localizarCampos(Array.isArray(pedacos) ? pedacos : [pedacos])) {
      let item = mapa.get(chave);
      if (!item) {
        item = { chave, ocorrencias: 0, formatos: [] };
        mapa.set(chave, item);
      }
      item.ocorrencias += 1;
      const f = formato ?? 'texto';
      if (!item.formatos.includes(f)) item.formatos.push(f);
    }
  }
  return [...mapa.values()].map((c) => ({
    ...c,
    tipo: tipoDoCampo(c.chave, c.formatos),
    automatico: Boolean(CAMPOS_AUTOMATICOS[c.chave]),
  }));
}

/** Mapa chave → tipo, usado para escrever cada ocorrência. */
export function mapaDeTipos(campos) {
  return Object.fromEntries(campos.map((c) => [c.chave, c.tipo]));
}

// ---------------- Valores ----------------

const digitos = (v) => String(v ?? '').replace(/\D/g, '');

function dataLocalIso(data) {
  return [data.getFullYear(), String(data.getMonth() + 1).padStart(2, '0'), String(data.getDate()).padStart(2, '0')].join('-');
}

/** Respostas + campos automáticos ([HOJE] = data do dia). */
export function completarRespostas(respostas, agora = new Date()) {
  return { ...respostas, HOJE: dataLocalIso(agora) };
}

/** Aceita "2026-11-11" (campo de data) ou "11/11/2026". Devolve {d, m, a} ou null. */
export function lerData(valor) {
  const texto = String(valor ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  let d, mes, a;
  if (m) [, a, mes, d] = m.map(Number);
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto);
    if (!m) return null;
    [, d, mes, a] = m.map(Number);
  }
  const data = new Date(a, mes - 1, d);
  if (a < 1000 || data.getFullYear() !== a || data.getMonth() !== mes - 1 || data.getDate() !== d) return null;
  return { d, m: mes, a };
}

/**
 * Número digitado no padrão brasileiro: "1.500,50", "R$ 1500", "1500.5" (ponto com 1–2 casas = decimal).
 * Devolve Number ou null.
 */
export function lerNumero(valor) {
  let texto = String(valor ?? '').replace(/R\$|\s| /gi, '');
  if (!texto) return null;
  const negativo = texto.startsWith('-');
  if (negativo) texto = texto.slice(1);
  if (!/^[\d.,]+$/.test(texto) || !/\d/.test(texto)) return null;
  if (texto.includes(',')) {
    if ((texto.match(/,/g) || []).length > 1) return null;
    const [inteiro, decimal] = texto.split(',');
    if (inteiro.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(inteiro)) return null;
    texto = `${inteiro.replace(/\./g, '')}.${decimal}`;
  } else if (/^\d+\.\d{1,2}$/.test(texto)) {
    // "1500.5" → decimal
  } else if (texto.includes('.')) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(texto)) return null;
    texto = texto.replace(/\./g, '');
  }
  const n = Number(texto);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

function cpfValido(cpf) {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += Number(cpf[i]) * (tamanho + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(cpf[tamanho])) return false;
  }
  return true;
}

function cnpjValido(cnpj) {
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  for (const tamanho of [12, 13]) {
    let soma = 0;
    let peso = tamanho - 7;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(cnpj[i]) * peso;
      peso = peso === 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(cnpj[tamanho])) return false;
  }
  return true;
}

const LIMITE_NUMERO = 1e15; // até 999 trilhões

/** Mensagem de erro da resposta para o tipo da pergunta, ou null se estiver boa (vazia não é erro aqui). */
export function validarResposta(tipo, valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  switch (tipo) {
    case 'data': return lerData(texto) ? null : 'data inválida';
    case 'cpf': return cpfValido(digitos(texto)) ? null : 'CPF inválido';
    case 'cnpj': return cnpjValido(digitos(texto)) ? null : 'CNPJ inválido';
    case 'cep': return digitos(texto).length === 8 ? null : 'CEP deve ter 8 números';
    case 'telefone': return [10, 11].includes(digitos(texto).length) ? null : 'telefone deve ter DDD + 8 ou 9 números';
    case 'moeda':
    case 'numero': {
      const n = lerNumero(texto);
      if (n === null) return 'número inválido';
      if (Math.abs(n) >= LIMITE_NUMERO) return 'número grande demais';
      return null;
    }
    default: return null;
  }
}

/** Campos com resposta preenchida mas inválida para o tipo: [{ chave, mensagem }]. */
export function camposInvalidos(campos, respostas) {
  const invalidos = [];
  for (const { chave, tipo, automatico } of campos) {
    if (automatico) continue;
    const mensagem = validarResposta(tipo, respostas[chave]);
    if (mensagem) invalidos.push({ chave, mensagem });
  }
  return invalidos;
}

// ---- Por extenso ----
const UNIDADES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
const GRUPOS = [null, ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões'], ['trilhão', 'trilhões']];

function ate999(n) {
  if (n === 100) return 'cem';
  const partes = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(UNIDADES[r]);
    else partes.push(DEZENAS[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES[r % 10]}` : ''));
  }
  return partes.join(' e ');
}

/** Inteiro não negativo por extenso: 1250 → "mil duzentos e cinquenta". */
export function inteiroPorExtenso(numero) {
  let n = Math.floor(Math.abs(numero));
  if (n === 0) return 'zero';
  const grupos = [];
  for (let i = 0; n > 0; i += 1) {
    grupos.push({ valor: n % 1000, nivel: i });
    n = Math.floor(n / 1000);
  }
  const usados = grupos.filter((g) => g.valor > 0).reverse(); // do maior para o menor
  const textos = usados.map(({ valor, nivel }) => {
    if (nivel === 0) return ate999(valor);
    if (nivel === 1) return valor === 1 ? 'mil' : `${ate999(valor)} mil`;
    return `${ate999(valor)} ${GRUPOS[nivel][valor === 1 ? 0 : 1]}`;
  });
  let saida = textos[0];
  for (let i = 1; i < textos.length; i += 1) {
    const ultimo = i === textos.length - 1;
    const { valor } = usados[i];
    // "mil e cem", "mil e vinte", "um milhão e quinhentos mil"; senão vírgula: "um milhão, duzentos e trinta mil".
    const comE = ultimo && (valor < 100 || valor % 100 === 0);
    saida += comE ? ` e ${textos[i]}` : `, ${textos[i]}`;
  }
  return saida;
}

/** Valor em reais por extenso: 1500.5 → "mil e quinhentos reais e cinquenta centavos". */
export function moedaPorExtenso(valor) {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100);
  const centavos = centavosTotais % 100;
  const partes = [];
  if (reais > 0 || centavos === 0) {
    const de = reais >= 1e6 && reais % 1e6 === 0 ? ' de' : ''; // "um milhão de reais"
    partes.push(`${inteiroPorExtenso(reais)}${de} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos > 0) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return (valor < 0 && centavosTotais > 0 ? 'menos ' : '') + partes.join(' e ');
}

/** Número por extenso: 3.25 → "três vírgula vinte e cinco". */
export function numeroPorExtenso(valor) {
  const [inteiro, decimal] = String(Math.abs(valor)).split('.');
  let saida = inteiroPorExtenso(Number(inteiro));
  if (decimal) {
    const zeros = /^0*/.exec(decimal)[0].length;
    saida += ` vírgula ${'zero '.repeat(zeros)}${inteiroPorExtenso(Number(decimal))}`;
  }
  return (valor < 0 ? 'menos ' : '') + saida;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function formatarMoeda(n) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

/**
 * Como a resposta aparece no documento, conforme o formato da ocorrência e o tipo da pergunta.
 * Se não der para formatar (resposta inválida), devolve a resposta como foi digitada.
 */
export function formatarValor(valor, formato, tipo = 'texto') {
  const texto = String(valor ?? '');
  // Sem formato na ocorrência: usa o formato natural do tipo ([CPF] junto de [CPF:cpf] sai formatado).
  const f = formato ?? (FORMATOS[tipo] ? tipo : 'texto');
  const limpo = texto.trim();
  try {
    switch (f) {
      case 'maiusculas': return texto.toLocaleUpperCase('pt-BR');
      case 'data': {
        const d = lerData(limpo);
        return d ? `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.a}` : texto;
      }
      case 'data-extenso': {
        const d = lerData(limpo);
        return d ? `${d.d === 1 ? '1º' : d.d} de ${MESES[d.m - 1]} de ${d.a}` : texto;
      }
      case 'cpf': {
        const n = digitos(limpo);
        return n.length === 11 ? n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : texto;
      }
      case 'cnpj': {
        const n = digitos(limpo);
        return n.length === 14 ? n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : texto;
      }
      case 'cep': {
        const n = digitos(limpo);
        return n.length === 8 ? n.replace(/^(\d{5})(\d{3})$/, '$1-$2') : texto;
      }
      case 'telefone': {
        const n = digitos(limpo);
        if (n.length === 11) return n.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
        if (n.length === 10) return n.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
        return texto;
      }
      case 'moeda': {
        const n = lerNumero(limpo);
        return n === null ? texto : formatarMoeda(n);
      }
      case 'numero': {
        const n = lerNumero(limpo);
        return n === null ? texto : n.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
      }
      case 'numero-extenso': {
        const n = lerNumero(limpo);
        return n === null || Math.abs(n) >= LIMITE_NUMERO ? texto : numeroPorExtenso(n);
      }
      case 'extenso': {
        if (tipo === 'data') return formatarValor(valor, 'data-extenso', tipo);
        const n = lerNumero(limpo);
        if (n === null || Math.abs(n) >= LIMITE_NUMERO) return texto;
        return tipo === 'numero' ? numeroPorExtenso(n) : moedaPorExtenso(n);
      }
      default: return texto;
    }
  } catch {
    return texto;
  }
}

/** Substitui os campos num texto simples. Campos sem resposta ficam como estão. */
export function preencherTexto(texto, respostas, tipos = {}) {
  return String(texto).replace(REGEX_CAMPO, (inteiro, interno) => {
    const { chave, formato } = analisarCampo(interno);
    const valor = respostas[chave];
    if (!campoValido(chave) || typeof valor !== 'string' || !valor.trim()) return inteiro;
    return formatarValor(valor, formato, tipos[chave] ?? CAMPOS_AUTOMATICOS[chave] ?? 'texto');
  });
}

/** Campos ainda sem resposta (resposta vazia ou só com espaços não vale — Etapa 1, Q11). */
export function camposPendentes(campos, respostas) {
  return campos
    .filter(({ chave, automatico }) => !automatico && !String(respostas[chave] ?? '').trim())
    .map(({ chave }) => chave);
}

// ---------------- DOM (somente navegador) ----------------

const SELETOR_BLOCO = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th,div';

/** Agrupa os nós de texto por bloco (parágrafo, título, item de lista…), na ordem do documento. */
function blocosDeTexto(raiz) {
  const blocos = new Map();
  const percurso = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let no = percurso.nextNode(); no; no = percurso.nextNode()) {
    const bloco = no.parentElement?.closest(SELETOR_BLOCO) ?? raiz;
    if (!blocos.has(bloco)) blocos.set(bloco, []);
    blocos.get(bloco).push(no);
  }
  return [...blocos.values()];
}

const PERIGOSOS = 'script,iframe,frame,object,embed,link,meta,base,form,input,button,textarea,select';

/**
 * Tira do modelo tudo que poderia executar código (modelo editado à mão no JSON, por exemplo).
 * O editor nunca gera nada disso; é só garantia para a pré-visualização e o PDF.
 */
function limpar(raiz) {
  raiz.querySelectorAll(PERIGOSOS).forEach((el) => el.remove());
  for (const el of raiz.querySelectorAll('*')) {
    for (const { name, value } of [...el.attributes]) {
      const nome = name.toLowerCase();
      const url = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      if (nome.startsWith('on') || (/^(href|src|xlink:href|action|formaction|srcset)$/.test(nome) && /^(javascript|vbscript):/.test(url))) {
        el.removeAttribute(name);
      }
    }
  }
  // O Quill desenha o número/marcador da lista num <span class="ql-ui"> dentro de cada item.
  // Se faltar (HTML editado à mão), recoloca para a lista não sair sem números no PDF.
  for (const li of raiz.querySelectorAll('li')) {
    if (li.firstElementChild?.classList.contains('ql-ui')) continue;
    const ui = li.ownerDocument.createElement('span');
    ui.className = 'ql-ui';
    ui.setAttribute('contenteditable', 'false');
    li.prepend(ui);
  }
  return raiz;
}

function fragmentoDe(html) {
  const modelo = document.createElement('template'); // conteúdo inerte: nada carrega nem executa aqui
  modelo.innerHTML = html ?? '';
  return limpar(modelo.content);
}

export function camposDoHtml(...htmls) {
  const blocos = [];
  for (const html of htmls) {
    blocos.push(...blocosDeTexto(fragmentoDe(html)).map((nos) => nos.map((n) => n.data)));
  }
  return extrairCampos(blocos);
}

/** Campos de um modelo inteiro: cabeçalho, conteúdo e rodapé (nessa ordem). */
export function camposDoModelo(modelo) {
  const config = modelo?.config ?? {};
  return camposDoHtml(config.cabecalho ?? '', modelo?.conteudo ?? '', config.rodape ?? '');
}

/**
 * Devolve o HTML com os campos substituídos pelas respostas (já formatadas conforme o tipo).
 * A resposta herda a formatação do início do campo (ex.: [NOME] em negrito → resposta em negrito).
 * Com { marcar: true }, envolve cada campo num <mark> para a pré-visualização.
 * "tipos" (chave → tipo) vem do modelo inteiro; se faltar, é calculado só com este HTML.
 */
export function preencherHtml(html, respostas, { marcar = false, tipos = null } = {}) {
  const raiz = fragmentoDe(html);
  const blocos = blocosDeTexto(raiz);
  const tiposFinais = tipos ?? mapaDeTipos(extrairCampos(blocos.map((nos) => nos.map((n) => n.data))));
  for (const nos of blocos) {
    const ocorrencias = localizarCampos(nos.map((n) => n.data));
    // De trás para frente: assim as posições das ocorrências anteriores continuam válidas.
    for (const { chave, formato, original, partes } of ocorrencias.reverse()) {
      const valor = String(respostas[chave] ?? '');
      const respondido = valor.trim() !== '';
      const texto = respondido ? formatarValor(valor, formato, tiposFinais[chave] ?? 'texto') : original;
      if (!respondido && !marcar) continue;

      for (const { i, de, ate } of partes.slice(1).reverse()) {
        nos[i].data = nos[i].data.slice(0, de) + nos[i].data.slice(ate);
      }
      const { i, de, ate } = partes[0];
      const meio = nos[i].splitText(de);
      meio.splitText(ate - de);
      let novo = document.createTextNode(texto);
      if (marcar) {
        const mark = document.createElement('mark');
        mark.className = respondido ? 'campo campo--ok' : 'campo campo--vazio';
        mark.dataset.campo = chave;
        mark.append(novo);
        novo = mark;
      }
      meio.replaceWith(novo);
    }
  }
  const saida = document.createElement('div');
  saida.append(raiz);
  return saida.innerHTML;
}
