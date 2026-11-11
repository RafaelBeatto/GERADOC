// Gera recursos/geradoc.ico (ícone do atalho) a partir do mesmo desenho do favicon do GERADOC.
// Uso: node scripts/gerar-icone.js   (só é preciso rodar de novo se o desenho mudar)
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const AZUL = [0x1d, 0x4e, 0xd8];
const BRANCO = [255, 255, 255];
// Desenho em coordenadas 0–32 (igual ao SVG do favicon).
const TRACOS = [
  [[11, 8], [18, 8]], [[18, 8], [23, 13]], [[23, 13], [23, 24]], [[23, 24], [11, 24]], [[11, 24], [11, 8]],
  [[18, 8], [18, 13]], [[18, 13], [23, 13]], // dobra do papel
  [[14, 17], [20, 17]], [[14, 21], [18, 21]],
];
const MEIA_ESPESSURA = 1.1;

function distanciaSegmento(px, py, [[ax, ay], [bx, by]]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function dentroRetanguloArredondado(x, y) {
  const r = 7;
  const cx = Math.max(r, Math.min(32 - r, x));
  const cy = Math.max(r, Math.min(32 - r, y));
  return x >= 0 && x <= 32 && y >= 0 && y <= 32 && Math.hypot(x - cx, y - cy) <= r;
}

function desenhar(tamanho) {
  const amostras = 4;
  const rgba = Buffer.alloc(tamanho * tamanho * 4);
  for (let py = 0; py < tamanho; py += 1) {
    for (let px = 0; px < tamanho; px += 1) {
      let fundo = 0;
      let traco = 0;
      for (let sy = 0; sy < amostras; sy += 1) {
        for (let sx = 0; sx < amostras; sx += 1) {
          const x = ((px + (sx + 0.5) / amostras) / tamanho) * 32;
          const y = ((py + (sy + 0.5) / amostras) / tamanho) * 32;
          if (!dentroRetanguloArredondado(x, y)) continue;
          fundo += 1;
          if (TRACOS.some((s) => distanciaSegmento(x, y, s) <= MEIA_ESPESSURA)) traco += 1;
        }
      }
      const total = amostras * amostras;
      const i = (py * tamanho + px) * 4;
      const t = fundo ? traco / fundo : 0;
      for (let c = 0; c < 3; c += 1) rgba[i + c] = Math.round(AZUL[c] * (1 - t) + BRANCO[c] * t);
      rgba[i + 3] = Math.round((fundo / total) * 255);
    }
  }
  return rgba;
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pedaco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

function png(tamanho) {
  const rgba = desenhar(tamanho);
  const linhas = Buffer.alloc((tamanho * 4 + 1) * tamanho);
  for (let y = 0; y < tamanho; y += 1) {
    linhas[y * (tamanho * 4 + 1)] = 0;
    rgba.copy(linhas, y * (tamanho * 4 + 1) + 1, y * tamanho * 4, (y + 1) * tamanho * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamanho, 0);
  ihdr.writeUInt32BE(tamanho, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

const tamanhos = [16, 24, 32, 48, 64, 256];
const imagens = tamanhos.map(png);
const cabecalho = Buffer.alloc(6 + 16 * tamanhos.length);
cabecalho.writeUInt16LE(0, 0);
cabecalho.writeUInt16LE(1, 2); // ícone
cabecalho.writeUInt16LE(tamanhos.length, 4);
let deslocamento = cabecalho.length;
tamanhos.forEach((t, i) => {
  const e = 6 + i * 16;
  cabecalho[e] = t === 256 ? 0 : t;
  cabecalho[e + 1] = t === 256 ? 0 : t;
  cabecalho.writeUInt16LE(1, e + 4); // planos
  cabecalho.writeUInt16LE(32, e + 6); // bits
  cabecalho.writeUInt32LE(imagens[i].length, e + 8);
  cabecalho.writeUInt32LE(deslocamento, e + 12);
  deslocamento += imagens[i].length;
});

const destino = path.join(import.meta.dirname, '..', 'recursos', 'geradoc.ico');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, Buffer.concat([cabecalho, ...imagens]));
fs.writeFileSync(path.join(path.dirname(destino), 'geradoc-256.png'), imagens.at(-1));
console.log(`Ícone gravado em ${destino}`);
