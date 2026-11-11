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
  minusculas: { tipo: 'texto', rotulo: 'Texto em minúsculas', exemplo: 'maria da silva' },
  nome: { tipo: 'texto', rotulo: 'Nome próprio', exemplo: 'Maria da Silva' },
  'texto-longo': { tipo: 'texto-longo', rotulo: 'Texto longo (várias linhas)', exemplo: 'parágrafos, com quebras de linha' },
  data: { tipo: 'data', rotulo: 'Data', exemplo: '11/11/2026' },
  'data-extenso': { tipo: 'data', rotulo: 'Data por extenso', exemplo: '11 de novembro de 2026' },
  dia: { tipo: 'data', rotulo: 'Data: só o dia', exemplo: '11' },
  mes: { tipo: 'data', rotulo: 'Data: só o mês', exemplo: 'novembro' },
  ano: { tipo: 'data', rotulo: 'Data: só o ano', exemplo: '2026' },
  'dia-semana': { tipo: 'data', rotulo: 'Data: dia da semana', exemplo: 'quarta-feira' },
  hora: { tipo: 'hora', rotulo: 'Hora', exemplo: '14:30' },
  cpf: { tipo: 'cpf', rotulo: 'CPF', exemplo: '123.456.789-09' },
  cnpj: { tipo: 'cnpj', rotulo: 'CNPJ', exemplo: '12.345.678/0001-95' },
  cep: { tipo: 'cep', rotulo: 'CEP', exemplo: '01310-100' },
  telefone: { tipo: 'telefone', rotulo: 'Telefone', exemplo: '(11) 98765-4321' },
  email: { tipo: 'email', rotulo: 'E-mail', exemplo: 'maria@exemplo.com' },
  moeda: { tipo: 'moeda', rotulo: 'Valor em reais', exemplo: 'R$ 1.500,00' },
  extenso: { tipo: null, rotulo: 'Valor (ou data) por extenso', exemplo: 'mil e quinhentos reais' },
  numero: { tipo: 'numero', rotulo: 'Número', exemplo: '1.500' },
  'numero-extenso': { tipo: 'numero', rotulo: 'Número por extenso', exemplo: 'mil e quinhentos' },
  porcento: { tipo: 'numero', rotulo: 'Porcentagem', exemplo: '10%' },
  'sim-nao': { tipo: 'sim-nao', rotulo: 'Sim ou não', exemplo: 'Sim' },
};

const ROTULOS_TIPO = { opcoes: 'Lista de opções' };

/** Nome legível do tipo de uma pergunta ("Data", "Sim ou não", "Lista de opções"…). */
export function rotuloTipo(tipo) {
  return ROTULOS_TIPO[tipo] ?? FORMATOS[tipo]?.rotulo ?? tipo;
}

const APELIDOS = {
  'data extenso': 'data-extenso', dataextenso: 'data-extenso', 'data-por-extenso': 'data-extenso',
  'numero extenso': 'numero-extenso', 'número-extenso': 'numero-extenso', 'número extenso': 'numero-extenso',
  'número': 'numero', 'maiúsculas': 'maiusculas', maiuscula: 'maiusculas', 'maiúscula': 'maiusculas',
  'minúsculas': 'minusculas', minuscula: 'minusculas', 'minúscula': 'minusculas',
  'nome-proprio': 'nome', 'nome próprio': 'nome', 'nome proprio': 'nome',
  'texto longo': 'texto-longo', textolongo: 'texto-longo', paragrafo: 'texto-longo', 'parágrafo': 'texto-longo',
  valor: 'moeda', reais: 'moeda', dinheiro: 'moeda', fone: 'telefone', celular: 'telefone',
  'valor-extenso': 'extenso', 'moeda-extenso': 'extenso', 'valor extenso': 'extenso',
  'mês': 'mes', 'dia da semana': 'dia-semana', 'dia semana': 'dia-semana', semana: 'dia-semana',
  'e-mail': 'email', horario: 'hora', 'horário': 'hora',
  porcentagem: 'porcento', percentual: 'porcento', '%': 'porcento',
  simnao: 'sim-nao', 'sim-não': 'sim-nao', 'sim/não': 'sim-nao', 'sim/nao': 'sim-nao', 'sim ou não': 'sim-nao', 'sim ou nao': 'sim-nao',
};

export function normalizarCampo(nome) {
  return String(nome ?? '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
}

function normalizarFormato(texto) {
  const f = String(texto).replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  if (Object.hasOwn(FORMATOS, f)) return f;
  return Object.hasOwn(APELIDOS, f) ? APELIDOS[f] : null;
}

function campoValido(chave) {
  return chave.length > 0 && chave.length <= CAMPO_MAX;
}

/** "telefone, opcional" → { formato: 'telefone', opcional: true }. Não reconhecido → null. */
function analisarSufixo(texto) {
  let resto = String(texto).replace(/\s+/g, ' ').trim();
  let opcional = false;
  const m = /^(?:(.*?)[\s,;]+)?opciona(?:l|is)$/i.exec(resto) ?? /^opcional[\s,;]+(.*)$/i.exec(resto);
  if (m) {
    opcional = true;
    resto = (m[1] ?? '').trim();
  }
  if (!resto) return opcional ? { formato: null, opcional } : null;
  const formato = normalizarFormato(resto);
  return formato ? { formato, opcional } : null;
}

/**
 * Campo comum: "Valor : Moeda" → { chave: 'VALOR', formato: 'moeda' }.
 *  - "[X:opcional]" / "[X:telefone opcional]" → pode ficar sem resposta;
 *  - "[X: a | b | c]" → lista de opções;
 *  - formato desconhecido = parte do nome.
 */
function analisarComum(interno) {
  const texto = String(interno ?? '');
  const pos = texto.lastIndexOf(':');
  if (pos > 0) {
    const sufixo = analisarSufixo(texto.slice(pos + 1));
    const chave = normalizarCampo(texto.slice(0, pos));
    if (sufixo && chave) return { chave, formato: sufixo.formato, opcional: sufixo.opcional, opcoes: null };
    const primeiro = texto.indexOf(':');
    const depois = texto.slice(primeiro + 1);
    const nome = normalizarCampo(texto.slice(0, primeiro));
    if (nome && depois.includes('|')) {
      let opcional = false;
      const opcoes = [];
      for (const bruto of depois.split('|')) {
        const o = bruto.replace(/\s+/g, ' ').trim();
        if (!o) continue;
        if (/^opcional$/i.test(o)) opcional = true;
        else if (!opcoes.some((x) => mesmoTexto(x, o))) opcoes.push(o);
      }
      if (opcoes.length >= 2) return { chave: nome, formato: 'opcoes', opcional, opcoes };
    }
  }
  return { chave: normalizarCampo(texto), formato: null, opcional: false, opcoes: null };
}

/** "Valor : Moeda" → { chave: 'VALOR', formato: 'moeda' }. Formato desconhecido = parte do nome. */
export function analisarCampo(interno) {
  const { chave, formato } = analisarComum(interno);
  return { chave, formato };
}

// ---------------- Condições: [SE …] … [SENÃO] … [FIM SE] ----------------

const chaveTexto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
const mesmoTexto = (a, b) => chaveTexto(a) === chaveTexto(b);
const NEGATIVOS = new Set(['', 'não', 'nao', 'n', '0', 'falso', 'false', 'no']);

/** Resposta "marcada": qualquer coisa que não seja vazio, "não", "n", "0"… */
export function verdadeiro(valor) {
  return !NEGATIVOS.has(chaveTexto(valor));
}

const OPERADORES = { '<>': '!=', '≠': '!=', '≥': '>=', '≤': '<=' };

/** "ESTADO CIVIL = casado | união estável" → { campo, op, valores }. */
function analisarCondicao(texto) {
  const m = /^(.*?)\s*(!=|<>|≠|>=|<=|≥|≤|=|>|<)\s*(.*)$/.exec(texto);
  if (m) {
    const campo = normalizarCampo(m[1]);
    const op = OPERADORES[m[2]] ?? m[2];
    const valores = (op === '=' || op === '!=' ? m[3].split('|') : [m[3]]).map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!campoValido(campo) || !valores.length) return null;
    return { campo, op, valores };
  }
  const n = /^N[ÃA]O\s+(.+)$/i.exec(texto.trim());
  const campo = normalizarCampo(n ? n[1] : texto);
  if (!campoValido(campo)) return null;
  return { campo, op: n ? 'falso' : 'verdadeiro', valores: [] };
}

function avaliarCondicao({ campo, op, valores }, respostas) {
  const valor = String(respostas[campo] ?? '').trim();
  if (op === 'verdadeiro') return verdadeiro(valor);
  if (op === 'falso') return !verdadeiro(valor);
  const igual = (alvo) => {
    if (mesmoTexto(valor, alvo)) return true;
    const a = lerNumero(valor);
    const b = lerNumero(alvo);
    return a !== null && b !== null && a === b;
  };
  if (op === '=') return valores.some(igual);
  if (op === '!=') return !valores.some(igual);
  let a = lerNumero(valor);
  let b = lerNumero(valores[0]);
  if (a === null || b === null) {
    const da = lerData(valor);
    const db = lerData(valores[0]);
    if (!da || !db) return false;
    a = diasDe(da);
    b = diasDe(db);
  }
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  if (op === '>=') return a >= b;
  return a <= b;
}

// ---------------- Cálculos: [=VALOR * QTD], [=INÍCIO + 12 meses:data-extenso] ----------------

const UNIDADES_TEMPO = { DIA: 'd', DIAS: 'd', 'MÊS': 'm', MES: 'm', MESES: 'm', ANO: 'a', ANOS: 'a' };

/** Lê a conta e devolve { ast, refs } (refs = campos usados) ou null se não for uma conta válida. */
function analisarExpressao(texto) {
  const s = String(texto);
  let p = 0;
  const refs = [];
  const erro = () => { throw new Error('expressão inválida'); };
  const espacos = () => { while (p < s.length && /\s/.test(s[p])) p += 1; };
  function unidade(no) {
    espacos();
    const m = /^(dias?|m[êe]s|meses|anos?)(?![\p{L}\p{N}_])/iu.exec(s.slice(p));
    if (!m) return no;
    p += m[0].length;
    return { t: 'dur', a: no, u: UNIDADES_TEMPO[m[1].toLocaleUpperCase('pt-BR')] };
  }
  function primario() {
    espacos();
    const c = s[p];
    if (c === undefined) erro();
    if (c === '(') {
      p += 1;
      const dentro = soma();
      espacos();
      if (s[p] !== ')') erro();
      p += 1;
      return unidade(dentro);
    }
    if (c === '-' || c === '−') { p += 1; return { t: 'neg', a: primario() }; }
    if (c === '+') { p += 1; return primario(); }
    const num = /^\d[\d.]*(?:,\d+)?/.exec(s.slice(p));
    if (num) {
      const bruto = num[0].replace(/\.+$/, '');
      p += bruto.length;
      let v = lerNumero(bruto);
      if (v === null) erro();
      espacos();
      if (s[p] === '%') { p += 1; v /= 100; }
      return unidade({ t: 'num', v });
    }
    const id = /^[\p{L}_][\p{L}\p{N}_ .ºª°]*/u.exec(s.slice(p));
    if (!id) erro();
    p += id[0].length;
    let nome = normalizarCampo(id[0]);
    let u = null;
    const m = /^(.*\S) (DIAS?|M[ÊE]S|MESES|ANOS?)$/.exec(nome);
    if (m) { nome = m[1]; u = UNIDADES_TEMPO[m[2]]; }
    if (!campoValido(nome)) erro();
    if (!refs.includes(nome)) refs.push(nome);
    const no = { t: 'campo', chave: nome };
    return u ? { t: 'dur', a: no, u } : no;
  }
  function produto() {
    let a = primario();
    for (;;) {
      espacos();
      const c = s[p];
      if (c === '*' || c === '×' || c === '/' || c === '÷') {
        p += 1;
        a = { t: 'bin', op: c === '*' || c === '×' ? '*' : '/', a, b: primario() };
      } else return a;
    }
  }
  function soma() {
    let a = produto();
    for (;;) {
      espacos();
      const c = s[p];
      if (c === '+' || c === '-' || c === '−') {
        p += 1;
        a = { t: 'bin', op: c === '+' ? '+' : '-', a, b: produto() };
      } else return a;
    }
  }
  try {
    const ast = soma();
    espacos();
    return p === s.length ? { ast, refs } : null;
  } catch {
    return null;
  }
}

const MS_DIA = 86400000;
const diasDe = ({ d, m, a }) => Math.round(Date.UTC(a, m - 1, d) / MS_DIA);

function somarTempo(dias, { meses = 0, dias: extra = 0 }) {
  const data = new Date(dias * MS_DIA);
  let resultado = dias;
  if (meses) {
    const total = data.getUTCFullYear() * 12 + data.getUTCMonth() + Math.round(meses);
    const ano = Math.floor(total / 12);
    const mes = total - ano * 12;
    const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate(); // 31/01 + 1 mês = 28 ou 29/02
    resultado = Math.round(Date.UTC(ano, mes, Math.min(data.getUTCDate(), ultimoDia)) / MS_DIA);
  }
  return resultado + Math.round(extra);
}

/** Valores da conta: { k: 'n', v } número · { k: 'd', v } data (dias desde 1970) · { k: 't', meses, dias } prazo. */
function avaliarNo(no, respostas, tipos) {
  const falha = () => { throw new Error('conta impossível'); };
  switch (no.t) {
    case 'num': return { k: 'n', v: no.v };
    case 'campo': {
      const valor = String(respostas[no.chave] ?? '').trim();
      if (!valor) falha();
      if ((tipos[no.chave] ?? CAMPOS_AUTOMATICOS[no.chave]) === 'data') {
        const d = lerData(valor);
        return d ? { k: 'd', v: diasDe(d) } : falha();
      }
      const n = lerNumero(valor);
      return n === null ? falha() : { k: 'n', v: n };
    }
    case 'neg': {
      const a = avaliarNo(no.a, respostas, tipos);
      return a.k === 'n' ? { k: 'n', v: -a.v } : falha();
    }
    case 'dur': {
      const a = avaliarNo(no.a, respostas, tipos);
      if (a.k !== 'n') falha();
      if (no.u === 'd') return { k: 't', meses: 0, dias: a.v };
      return { k: 't', meses: no.u === 'a' ? a.v * 12 : a.v, dias: 0 };
    }
    default: {
      const a = avaliarNo(no.a, respostas, tipos);
      const b = avaliarNo(no.b, respostas, tipos);
      if (no.op === '*' || no.op === '/') {
        if (a.k !== 'n' || b.k !== 'n' || (no.op === '/' && b.v === 0)) falha();
        return { k: 'n', v: no.op === '*' ? a.v * b.v : a.v / b.v };
      }
      const sinal = no.op === '+' ? 1 : -1;
      const prazo = (x) => (x.k === 't' ? x : { meses: 0, dias: x.v });
      if (a.k === 'n' && b.k === 'n') return { k: 'n', v: a.v + sinal * b.v };
      if (a.k === 't' && b.k === 't') return { k: 't', meses: a.meses + sinal * b.meses, dias: a.dias + sinal * b.dias };
      if (a.k === 'd' && b.k === 'd') return sinal === -1 ? { k: 'n', v: a.v - b.v } : falha();
      if (a.k === 'd') {
        const t = prazo(b);
        return { k: 'd', v: somarTempo(a.v, { meses: sinal * t.meses, dias: sinal * t.dias }) };
      }
      if (b.k === 'd' && sinal === 1) return { k: 'd', v: somarTempo(b.v, prazo(a)) };
      return falha();
    }
  }
}

/** Resultado da conta já escrito como vai para o documento, ou null se ainda não dá para calcular. */
export function calcular({ ast, refs, formato }, respostas, tipos = {}) {
  let r;
  try {
    r = avaliarNo(ast, respostas, tipos);
  } catch {
    return null;
  }
  if (r.k === 'd') {
    const data = new Date(r.v * MS_DIA);
    const ano = data.getUTCFullYear();
    if (!(ano >= 1000 && ano <= 9999)) return null;
    const iso = `${ano}-${String(data.getUTCMonth() + 1).padStart(2, '0')}-${String(data.getUTCDate()).padStart(2, '0')}`;
    return formatarValor(iso, formato ?? 'data', 'data');
  }
  if (r.k !== 'n' || !Number.isFinite(r.v) || Math.abs(r.v) >= LIMITE_NUMERO) return null;
  const tipo = refs.some((c) => tipos[c] === 'moeda') ? 'moeda' : 'numero';
  const texto = String(Number(r.v.toFixed(6))).replace('.', ',');
  return formatarValor(texto, formato ?? tipo, tipo);
}

// ---------------- Localizar ----------------

/** Tudo o que pode estar entre colchetes: campo comum, conta ou marcador de condição. */
function interpretar(interno) {
  const texto = String(interno ?? '').trim();
  if (texto.startsWith('=')) {
    let expressao = texto.slice(1);
    let formato = null;
    const pos = expressao.lastIndexOf(':');
    if (pos > 0) {
      const f = normalizarFormato(expressao.slice(pos + 1));
      if (f) { formato = f; expressao = expressao.slice(0, pos); }
    }
    const conta = analisarExpressao(expressao);
    if (conta) return { classe: 'calculo', chave: '', formato, opcional: false, opcoes: null, valido: true, calculo: { ...conta, formato } };
  }
  const comum = analisarComum(texto);
  const item = { classe: 'campo', ...comum, valido: campoValido(comum.chave) };
  const nome = normalizarCampo(texto);
  if (/^(SEN[ÃA]O|CASO CONTR[ÁA]RIO)$/.test(nome)) item.marcador = 'senao';
  else if (/^FIM[ -]?(DO )?SE$/.test(nome)) item.marcador = 'fimse';
  else {
    const m = /^SE\s+(.+)$/i.exec(texto);
    const cond = m && analisarCondicao(m[1]);
    if (cond) { item.marcador = 'se'; item.cond = cond; }
  }
  return item;
}

/** Como localizarCampos, mas inclui contas e candidatos a marcador (mesmo com nome inválido como campo). */
function localizar(pedacos) {
  const texto = pedacos.join('');
  const inicios = [];
  let soma = 0;
  for (const p of pedacos) { inicios.push(soma); soma += p.length; }

  const ocorrencias = [];
  for (const m of texto.matchAll(REGEX_CAMPO)) {
    const item = interpretar(m[1]);
    if (!item.valido && !item.marcador) continue;
    const de = m.index;
    const ate = m.index + m[0].length;
    const partes = [];
    pedacos.forEach((p, i) => {
      const a = Math.max(de, inicios[i]);
      const b = Math.min(ate, inicios[i] + p.length);
      if (a < b) partes.push({ i, de: a - inicios[i], ate: b - inicios[i] });
    });
    ocorrencias.push({ ...item, original: m[0], partes });
  }
  return ocorrencias;
}

/**
 * Localiza os campos num bloco de texto que pode estar quebrado em pedaços
 * (no editor, "[NO<b>ME</b>]" vira os pedaços "[NO" e "ME]").
 * Retorna, para cada ocorrência, a chave normalizada, o formato e os trechos de cada pedaço que ela ocupa.
 */
export function localizarCampos(pedacos) {
  return localizar(pedacos)
    .filter((o) => o.classe === 'campo' && o.valido)
    .map(({ chave, formato, original, partes }) => ({ chave, formato, original, partes }));
}

/**
 * Decide quais [SE]/[SENÃO]/[FIM SE] formam pares de verdade. Marcador sem par continua sendo um campo comum
 * (assim um modelo antigo com um campo chamado "[SE …]" não muda de comportamento).
 */
function resolverMarcadores(ocorrencias) {
  const pilha = [];
  ocorrencias.forEach((o, i) => {
    o.papel = o.classe;
    if (o.marcador === 'se') pilha.push({ i, senao: null });
    else if (o.marcador === 'senao') {
      const topo = pilha.at(-1);
      if (topo && topo.senao === null) topo.senao = i;
    } else if (o.marcador === 'fimse' && pilha.length) {
      const topo = pilha.pop();
      Object.assign(ocorrencias[topo.i], { papel: 'se', senao: topo.senao, fim: i });
      if (topo.senao !== null) ocorrencias[topo.senao].papel = 'senao';
      o.papel = 'fimse';
    }
  });
  return ocorrencias;
}

/**
 * Com as respostas, decide o que sai do documento.
 * cortes: pares [i, j] de índices de ocorrências — some tudo do início de i ao fim de j (em ordem, sem sobreposição).
 * ativos: índices das ocorrências (campos e contas) que continuam no documento.  usados: campos consultados nas condições.
 */
function planoCondicional(ocorrencias, respostas) {
  const cortes = [];
  const ativos = [];
  const usados = new Set();
  const percorrer = (de, ate) => {
    for (let i = de; i < ate; i += 1) {
      const o = ocorrencias[i];
      if (o.papel !== 'se') {
        if (o.papel === 'campo' || o.papel === 'calculo') ativos.push(i);
        continue;
      }
      usados.add(o.cond.campo);
      if (avaliarCondicao(o.cond, respostas)) {
        cortes.push([i, i]);
        percorrer(i + 1, o.senao ?? o.fim);
        cortes.push([o.senao ?? o.fim, o.fim]);
      } else if (o.senao !== null) {
        cortes.push([i, o.senao]);
        percorrer(o.senao + 1, o.fim);
        cortes.push([o.fim, o.fim]);
      } else {
        cortes.push([i, o.fim]);
      }
      i = o.fim;
    }
  };
  percorrer(0, ocorrencias.length);
  return { cortes, ativos, usados };
}

/** Campos que valem para estas respostas (os de trechos escondidos por [SE …] ficam de fora). */
function chavesAtivas(ocorrencias, respostas) {
  resolverMarcadores(ocorrencias);
  const { ativos, usados } = planoCondicional(ocorrencias, respostas);
  const chaves = new Set(usados);
  for (const i of ativos) {
    const o = ocorrencias[i];
    if (o.papel === 'calculo') o.calculo.refs.forEach((c) => chaves.add(c));
    else if (o.valido) chaves.add(o.chave);
  }
  return chaves;
}

function agrupar(blocos) {
  const grupos = [[]];
  for (const b of blocos) {
    if (b === null) grupos.push([]);
    else grupos.at(-1).push(b);
  }
  return grupos;
}

/** Versão sem DOM de camposAtivosDoHtml: blocos de texto (null separa partes independentes). */
export function camposAtivos(blocos, respostas) {
  const ativos = new Set();
  for (const grupo of agrupar(blocos)) {
    for (const c of chavesAtivas(grupo.flatMap((b) => localizar(Array.isArray(b) ? b : [b])), respostas)) ativos.add(c);
  }
  return ativos;
}

/**
 * Tipo da pergunta: o do primeiro formato que define tipo (data, cpf, moeda…).
 * Só "extenso" → moeda. Nada → texto. Campos automáticos têm tipo fixo.
 */
function tipoDoCampo(chave, formatos) {
  if (CAMPOS_AUTOMATICOS[chave]) return CAMPOS_AUTOMATICOS[chave];
  for (const f of formatos) {
    if (f === 'opcoes') return 'opcoes';
    const tipo = FORMATOS[f]?.tipo;
    if (tipo && tipo !== 'texto') return tipo;
  }
  return formatos.includes('extenso') ? 'moeda' : 'texto';
}

/**
 * Lista de campos únicos, na ordem da primeira aparição:
 * { chave, ocorrencias, tipo, formatos[], automatico, opcional, opcoes }.
 * Um item null em "blocos" separa partes independentes (cabeçalho / conteúdo / rodapé): [SE] não atravessa partes.
 */
export function extrairCampos(blocos) {
  const mapa = new Map();
  const item = (chave) => {
    let c = mapa.get(chave);
    if (!c) {
      c = { chave, ocorrencias: 0, formatos: [], opcional: false, opcoes: null, emConta: false, comparado: [], marcavel: false };
      mapa.set(chave, c);
    }
    return c;
  };
  for (const grupo of agrupar(blocos)) {
    const ocorrencias = resolverMarcadores(grupo.flatMap((b) => localizar(Array.isArray(b) ? b : [b])));
    for (const o of ocorrencias) {
      if (o.papel === 'se') {
        const c = item(o.cond.campo);
        if (o.cond.op === 'verdadeiro' || o.cond.op === 'falso') c.marcavel = true;
        else if (o.cond.op === '=' || o.cond.op === '!=') {
          for (const v of o.cond.valores) if (!c.comparado.some((x) => mesmoTexto(x, v))) c.comparado.push(v);
        } else c.emConta = true;
      } else if (o.papel === 'calculo') {
        for (const chave of o.calculo.refs) item(chave).emConta = true;
      } else if (o.papel === 'campo' && o.valido) {
        const c = item(o.chave);
        c.ocorrencias += 1;
        const f = o.formato ?? 'texto';
        if (!c.formatos.includes(f)) c.formatos.push(f);
        if (o.opcional) c.opcional = true;
        if (o.opcoes && !c.opcoes) c.opcoes = o.opcoes;
      }
    }
  }
  return [...mapa.values()].map(({ emConta, comparado, marcavel, ...c }) => {
    let tipo = tipoDoCampo(c.chave, c.formatos);
    let { opcoes, opcional } = c;
    const automatico = Boolean(CAMPOS_AUTOMATICOS[c.chave]);
    if (tipo === 'texto' && !automatico) {
      // Sem formato escrito: o uso em contas e condições define o tipo.
      if (emConta) tipo = 'numero';
      else if (c.ocorrencias === 0 && comparado.length) { tipo = 'opcoes'; opcoes = comparado; }
      else if (c.ocorrencias === 0 && marcavel) tipo = 'sim-nao';
    }
    // "[SE COMPLEMENTO], [COMPLEMENTO][FIM SE]": se a condição pergunta "foi preenchido?", o campo pode ficar vazio.
    if (marcavel && tipo !== 'sim-nao') opcional = true;
    if (tipo !== 'opcoes') opcoes = null;
    return { ...c, tipo, automatico, opcional, opcoes };
  });
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

/** Respostas + campos automáticos ([HOJE] = data do dia). Perguntas "sim ou não" sem resposta valem "não". */
export function completarRespostas(respostas, agora = new Date(), campos = []) {
  const completas = { ...respostas, HOJE: dataLocalIso(agora) };
  for (const { chave, tipo } of campos) {
    if (tipo === 'sim-nao') completas[chave] = verdadeiro(completas[chave]) ? 'sim' : 'não';
  }
  return completas;
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

/** "14:30", "14h30", "9h" → "14:30" / "09:00"; inválida → null. */
function lerHora(valor) {
  const texto = String(valor ?? '').trim();
  const m = /^(\d{1,2})(?:\s*[:h]\s*(\d{2}))?\s*h?$/i.exec(texto);
  if (!m || (m[2] === undefined && !/h/i.test(texto))) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
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
export function validarResposta(tipo, valor, opcoes = null) {
  const texto = String(valor ?? '').trim();
  if (!texto) return null;
  switch (tipo) {
    case 'opcoes': return !opcoes || opcoes.some((o) => mesmoTexto(o, texto)) ? null : `escolha uma das opções: ${opcoes.join(', ')}`;
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto) ? null : 'e-mail inválido';
    case 'hora': return lerHora(texto) ? null : 'hora inválida (use 14:30)';
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
export function camposInvalidos(campos, respostas, ativos = null) {
  const invalidos = [];
  for (const { chave, tipo, automatico, opcoes } of campos) {
    if (automatico || tipo === 'sim-nao' || (ativos && !ativos.has(chave))) continue;
    const mensagem = validarResposta(tipo, respostas[chave], opcoes);
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

const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von']);

/** "MARIA DA SILVA" → "Maria da Silva". */
function nomeProprio(texto) {
  return texto.toLocaleLowerCase('pt-BR').replace(/[^\s'’-]+/g, (palavra, pos) => (
    pos > 0 && PARTICULAS.has(palavra) ? palavra : palavra[0].toLocaleUpperCase('pt-BR') + palavra.slice(1)
  ));
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
      case 'minusculas': return texto.toLocaleLowerCase('pt-BR');
      case 'nome': return nomeProprio(texto.replace(/\s+/g, ' ').trim());
      case 'sim-nao': return verdadeiro(limpo) ? 'Sim' : 'Não';
      case 'email': return limpo.toLocaleLowerCase('pt-BR');
      case 'hora': return lerHora(limpo) ?? texto;
      case 'dia': case 'mes': case 'ano': case 'dia-semana': {
        const d = lerData(limpo);
        if (!d) return texto;
        if (f === 'dia') return String(d.d);
        if (f === 'mes') return MESES[d.m - 1];
        if (f === 'ano') return String(d.a);
        return DIAS_SEMANA[new Date(d.a, d.m - 1, d.d).getDay()];
      }
      case 'porcento': {
        const n = lerNumero(limpo.replace(/%$/, ''));
        return n === null ? texto : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}%`;
      }
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

/**
 * Substitui os campos num texto simples (também aplica [SE …] e contas). Campos sem resposta ficam como estão;
 * os opcionais (lista em "opcionais") somem.
 */
export function preencherTexto(texto, respostas, tipos = {}, opcionais = []) {
  const original = String(texto);
  const ocorrencias = resolverMarcadores(localizar([original]));
  const { cortes, ativos } = planoCondicional(ocorrencias, respostas);
  const vazios = new Set(opcionais);
  // Trocas [de, ate, novo]; os cortes das condições entram como trocas por "".
  const trocas = cortes.map(([i, j]) => [ocorrencias[i].partes[0].de, ocorrencias[j].partes[0].ate, '']);
  for (const i of ativos) {
    const o = ocorrencias[i];
    const { de, ate } = o.partes[0];
    if (o.papel === 'calculo') {
      const resultado = calcular(o.calculo, respostas, tipos);
      if (resultado !== null) trocas.push([de, ate, resultado]);
    } else if (o.valido) {
      const valor = respostas[o.chave];
      if (typeof valor === 'string' && valor.trim()) {
        trocas.push([de, ate, formatarValor(valor, o.formato, tipos[o.chave] ?? CAMPOS_AUTOMATICOS[o.chave] ?? 'texto')]);
      } else if (vazios.has(o.chave)) trocas.push([de, ate, '']);
    }
  }
  trocas.sort((a, b) => a[0] - b[0]);
  let saida = '';
  let pos = 0;
  for (const [de, ate, novo] of trocas) {
    saida += original.slice(pos, de) + novo;
    pos = ate;
  }
  return saida + original.slice(pos);
}

/**
 * Campos ainda sem resposta (resposta vazia ou só com espaços não vale — Etapa 1, Q11).
 * Não contam: automáticos, opcionais, "sim ou não" (sem marcar = não) e, se "ativos" for dado,
 * os campos que só aparecem em trechos escondidos por [SE …].
 */
export function camposPendentes(campos, respostas, ativos = null) {
  return campos
    .filter(({ chave, automatico, opcional, tipo }) => !automatico && !opcional && tipo !== 'sim-nao'
      && (!ativos || ativos.has(chave)) && !String(respostas[chave] ?? '').trim())
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

const textos = (nos) => nos.map((n) => n.data);

export function camposDoHtml(...htmls) {
  const blocos = [];
  htmls.forEach((html, i) => {
    if (i) blocos.push(null); // [SE …] não atravessa cabeçalho / conteúdo / rodapé
    blocos.push(...blocosDeTexto(fragmentoDe(html)).map(textos));
  });
  return extrairCampos(blocos);
}

const partesDoModelo = (modelo) => {
  const config = modelo?.config ?? {};
  return [config.cabecalho ?? '', modelo?.conteudo ?? '', config.rodape ?? ''];
};

/** Campos de um modelo inteiro: cabeçalho, conteúdo e rodapé (nessa ordem). */
export function camposDoModelo(modelo) {
  return camposDoHtml(...partesDoModelo(modelo));
}

/** Campos que valem para estas respostas: os de trechos escondidos por [SE …] ficam de fora. */
export function camposAtivosDoHtml(htmls, respostas) {
  const ativos = new Set();
  for (const html of htmls) {
    const ocorrencias = blocosDeTexto(fragmentoDe(html)).flatMap((nos) => localizar(textos(nos)));
    for (const c of chavesAtivas(ocorrencias, respostas)) ativos.add(c);
  }
  return ativos;
}

export function camposAtivosDoModelo(modelo, respostas) {
  return camposAtivosDoHtml(partesDoModelo(modelo), respostas);
}

const blocoDe = (no) => no.parentElement?.closest(SELETOR_BLOCO) ?? null;

/**
 * Tira do documento os trechos que as condições mandam esconder e os próprios marcadores.
 * Parágrafo que ficou vazio por causa disso (ex.: uma linha só com "[SE X]") some junto.
 * @returns {boolean} true se algo foi retirado
 */
function aplicarCondicionais(blocos, respostas) {
  const ocorrencias = blocos.flatMap((nos) => localizar(textos(nos)).map((o) => ({ ...o, nos })));
  resolverMarcadores(ocorrencias);
  const { cortes } = planoCondicional(ocorrencias, respostas);
  // De trás para frente: as posições dos cortes anteriores continuam válidas.
  for (const [i, j] of [...cortes].reverse()) {
    const inicio = ocorrencias[i].partes[0];
    const fim = ocorrencias[j].partes.at(-1);
    const noInicio = ocorrencias[i].nos[inicio.i];
    const noFim = ocorrencias[j].nos[fim.i];
    const afetados = new Set([blocoDe(noInicio), blocoDe(noFim)]);
    const trecho = noInicio.ownerDocument.createRange();
    trecho.setStart(noInicio, inicio.de);
    trecho.setEnd(noFim, fim.ate);
    trecho.deleteContents();
    for (const bloco of afetados) {
      if (!bloco || bloco.textContent.trim() || bloco.querySelector('img,hr')) continue;
      const pai = bloco.parentElement;
      bloco.remove();
      if (pai && /^(OL|UL)$/.test(pai.tagName) && !pai.children.length) pai.remove();
    }
  }
  return cortes.length > 0;
}

/** Texto de uma resposta: quebras de linha (texto longo) viram <br>. */
function noDeTexto(documento, texto) {
  if (!texto.includes('\n')) return documento.createTextNode(texto);
  const fragmento = documento.createDocumentFragment();
  texto.split(/\r?\n/).forEach((linha, i) => {
    if (i) fragmento.append(documento.createElement('br'));
    if (linha) fragmento.append(documento.createTextNode(linha));
  });
  return fragmento;
}

/**
 * Devolve o HTML com os campos substituídos pelas respostas (já formatadas conforme o tipo).
 * A resposta herda a formatação do início do campo (ex.: [NOME] em negrito → resposta em negrito).
 * Opções:
 *  - marcar: envolve cada campo num <mark> para a pré-visualização;
 *  - campos: lista de camposDoModelo (tipos e opcionais do modelo inteiro); se faltar, é calculada só com este HTML;
 *  - tipos: (compatibilidade) mapa chave → tipo, usado se "campos" não for dado;
 *  - condicionais: false mostra o modelo cru, sem aplicar [SE …];
 *  - problemas: lista que recebe as contas ([=…]) que não puderam ser calculadas.
 */
export function preencherHtml(html, respostas, { marcar = false, tipos = null, campos = null, condicionais = true, problemas = null } = {}) {
  const raiz = fragmentoDe(html);
  let blocos = blocosDeTexto(raiz);
  const lista = campos ?? extrairCampos(blocos.map(textos));
  const tiposFinais = campos || !tipos ? mapaDeTipos(lista) : tipos;
  const opcionais = new Set(lista.filter((c) => c.opcional).map((c) => c.chave));
  if (condicionais && aplicarCondicionais(blocos, respostas)) blocos = blocosDeTexto(raiz);

  for (const nos of blocos) {
    // De trás para frente: assim as posições das ocorrências anteriores continuam válidas.
    for (const o of localizar(textos(nos)).reverse()) {
      if (!o.valido) continue;
      const { chave, formato, original, partes } = o;
      let texto = null; // null = sem resposta (o campo fica como está)
      let classe = 'campo--vazio';
      if (o.classe === 'calculo') {
        texto = calcular(o.calculo, respostas, tiposFinais);
        if (texto === null && !marcar) problemas?.push(original);
      } else {
        const valor = String(respostas[chave] ?? '');
        if (valor.trim() !== '') texto = formatarValor(valor, formato, tiposFinais[chave] ?? 'texto');
        else if (opcionais.has(chave)) {
          classe = 'campo--opcional';
          if (!marcar) texto = '';
        }
      }
      if (texto === null && !marcar) continue;

      for (const { i, de, ate } of partes.slice(1).reverse()) {
        nos[i].data = nos[i].data.slice(0, de) + nos[i].data.slice(ate);
      }
      const { i, de, ate } = partes[0];
      const meio = nos[i].splitText(de);
      meio.splitText(ate - de);
      let novo = noDeTexto(meio.ownerDocument, texto ?? original);
      if (marcar) {
        const mark = meio.ownerDocument.createElement('mark');
        mark.className = texto === null ? `campo ${classe}` : 'campo campo--ok';
        mark.dataset.campo = o.classe === 'calculo' ? original : chave;
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
