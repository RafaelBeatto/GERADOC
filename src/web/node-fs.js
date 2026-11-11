// GERADOC (modo web) — substitui `node:fs`, usado só por trechos do gerador.js que o navegador não executa.
export const existsSync = () => false;
export const readFileSync = () => '';
export default { existsSync, readFileSync };
