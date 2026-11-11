// GERADOC — monta um arquivo .zip simples (v1.2, geração em lote).
// Os arquivos entram sem compressão ("stored"): PDF e Word já são compactados, então comprimir de novo
// só gastaria tempo. Nomes em UTF-8 (acentos funcionam no Windows Explorer).

const TABELA_CRC = (() => {
  const tabela = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabela[n] = c >>> 0;
  }
  return tabela;
})();

export function crc32(dados) {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i += 1) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data e hora no formato do ZIP (MS-DOS). */
function dataDos(data) {
  const ano = Math.min(2107, Math.max(1980, data.getFullYear()));
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1),
    dia: ((ano - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  };
}

/**
 * @param {{ nome: string, conteudo: Buffer }[]} arquivos  nomes já sem caracteres proibidos e sem repetição
 * @returns {Buffer}
 */
export function montarZip(arquivos, agora = new Date()) {
  if (arquivos.length > 0xfffe) throw new Error('Arquivos demais para um único .zip.');
  const { hora, dia } = dataDos(agora);
  const partes = [];
  const central = [];
  let posicao = 0;

  for (const { nome, conteudo } of arquivos) {
    const nomeBytes = Buffer.from(nome, 'utf8');
    const crc = crc32(conteudo);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(0, 8); // sem compressão
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nomeBytes.length, 26);
    partes.push(local, nomeBytes, conteudo);

    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(0, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(dia, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(conteudo.length, 20);
    entrada.writeUInt32LE(conteudo.length, 24);
    entrada.writeUInt16LE(nomeBytes.length, 28);
    entrada.writeUInt32LE(posicao, 42);
    central.push(entrada, nomeBytes);
    posicao += local.length + nomeBytes.length + conteudo.length;
  }

  const tamanhoCentral = central.reduce((soma, b) => soma + b.length, 0);
  if (posicao + tamanhoCentral > 0xffffffff) throw new Error('O .zip passaria de 4 GB.');
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(posicao, 16);
  return Buffer.concat([...partes, ...central, fim]);
}

/** "Recibo.pdf" repetido vira "Recibo (2).pdf", "Recibo (3).pdf"… (sem diferenciar maiúsculas, como o Windows). */
export function nomeSemRepetir(nome, usados) {
  const ponto = nome.lastIndexOf('.');
  const base = ponto > 0 ? nome.slice(0, ponto) : nome;
  const extensao = ponto > 0 ? nome.slice(ponto) : '';
  let final = nome;
  for (let n = 2; usados.has(final.toLocaleLowerCase('pt-BR')); n += 1) final = `${base} (${n})${extensao}`;
  usados.add(final.toLocaleLowerCase('pt-BR'));
  return final;
}
