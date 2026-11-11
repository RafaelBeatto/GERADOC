// GERADOC — servidor local.
// Escuta apenas em 127.0.0.1 (não fica visível na rede) e abre o navegador ao iniciar.
import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { criarApp, RAIZ } from './app.js';

const HOST = '127.0.0.1';
const PORTA = Number(process.env.GERADOC_PORTA) || 3000;
const URL = `http://localhost:${PORTA}`;
const { version: VERSAO } = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));

const app = criarApp({ versao: VERSAO });

function abrirNavegador() {
  if (process.env.GERADOC_SEM_NAVEGADOR) return;
  // "start" do Windows abre a URL no navegador padrão.
  exec(`cmd /c start "" "${URL}"`);
}

const servidor = app.listen(PORTA, HOST, () => {
  console.log(`GERADOC v${VERSAO} rodando em ${URL}`);
  console.log('Mantenha esta janela aberta enquanto usa o sistema. Feche-a para encerrar.');
  abrirNavegador();
});

// Fecha o navegador sem janela usado para os PDFs ao encerrar.
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sinal, async () => {
    await app.locals.pdf.fechar();
    process.exit(0);
  });
}

async function versaoAberta() {
  try {
    const resposta = await fetch(`http://${HOST}:${PORTA}/api/saude`, { signal: AbortSignal.timeout(2000) });
    const dados = await resposta.json();
    return dados.app === 'GERADOC' ? dados.versao : null;
  } catch {
    return null;
  }
}

servidor.on('error', async (erro) => {
  if (erro.code === 'EADDRINUSE') {
    const aberta = await versaoAberta();
    if (aberta === VERSAO) {
      // Já existe este mesmo GERADOC aberto: só abre o navegador nele.
      console.log(`O GERADOC já está aberto em ${URL}. Abrindo o navegador...`);
      abrirNavegador();
      setTimeout(() => process.exit(0), 1500);
      return;
    }
    // Outra versão (ou outro programa) está usando a porta: avisar em vez de abrir a versão errada.
    console.error(aberta
      ? `ATENÇÃO: há um GERADOC antigo (v${aberta}) aberto em outra janela. Feche aquela janela e abra o GERADOC de novo para usar a v${VERSAO}.`
      : `ATENÇÃO: a porta ${PORTA} está sendo usada por outro programa. Feche-o e abra o GERADOC de novo.`);
    process.exit(1); // o GERADOC.bat pausa para a mensagem ficar visível
  }
  console.error('Erro ao iniciar o servidor:', erro);
  process.exit(1);
});
