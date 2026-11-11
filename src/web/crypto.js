// GERADOC (modo web) — `node:crypto` usado pelos módulos (só randomUUID).
export const randomUUID = () => crypto.randomUUID();
export default { randomUUID };
