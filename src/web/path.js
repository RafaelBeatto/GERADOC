// GERADOC (modo web) — o mínimo de `node:path` que os módulos usam.
const partir = (p) => String(p).split('/').filter(Boolean);
export const join = (...partes) => partir(partes.join('/')).join('/');
export const basename = (p, ext = '') => {
  const nome = partir(p).pop() ?? '';
  return ext && nome.endsWith(ext) ? nome.slice(0, -ext.length) : nome;
};
export const dirname = (p) => partir(p).slice(0, -1).join('/');
export const resolve = (...partes) => join(...partes);
export default { join, basename, dirname, resolve };
