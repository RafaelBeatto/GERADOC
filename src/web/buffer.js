// GERADOC (modo web) — o zip.js e o docx.js usam `Buffer` do Node; aqui vem o equivalente para o navegador.
import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;
