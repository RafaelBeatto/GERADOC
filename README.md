# GERADOC

Gerador local de documentos: cole um modelo com campos `[CAMPO]`, responda às perguntas e receba o PDF.

## Como usar
1. Dê dois cliques em `GERADOC.bat`. Na primeira vez ele instala as dependências.
2. O navegador abre em http://localhost:3000.
3. Mantenha a janela preta aberta enquanto usa; feche-a para encerrar.

Requisitos: Node.js 20 ou superior e Microsoft Edge (já vem no Windows) ou Google Chrome — usado, sem janela, para gerar o PDF.
Se o navegador estiver em outro lugar, defina a variável `GERADOC_NAVEGADOR` com o caminho do `.exe`.

## Modelos
- **Novo modelo**: dê um nome e escreva ou cole o texto. O que muda a cada documento vai entre colchetes: `[NOME]`, `[CPF]`, `[DATA]`.
  `[Nome]`, `[NOME]` e `[ nome ]` são o mesmo campo (uma só pergunta); acentos diferenciam.
- **Editar**, **Duplicar** (cria "Nome (cópia)") e **Excluir** ficam em cada linha da lista.

## Gerar um documento
Na lista de modelos, clique em **Gerar documento**, responda às perguntas e clique em **Gerar PDF**.
O arquivo vai para a pasta Downloads do navegador com o nome `<modelo> - <data>.pdf`. Formato: A4 retrato, margens de 2,5 cm.

## Lixeira
Excluir um modelo o leva para a **Lixeira** (botão no topo da lista), de onde ele pode ser **restaurado**.
Se já existir outro modelo com o mesmo nome, o restaurado ganha "(restaurado)" no nome.
**Excluir definitivamente** tira o modelo da lixeira; mesmo assim, uma última cópia fica em `dados/backup/`.

## Onde ficam os dados
| Pasta | O que tem |
|---|---|
| `dados/modelos/` | um arquivo JSON por modelo |
| `dados/lixeira/` | modelos excluídos |
| `dados/backup/<id>/` | as 20 versões anteriores de cada modelo (uma a cada vez que é salvo) |

**Faça cópia da pasta `dados/` para backup** (pendrive, nuvem etc.).
Para recuperar uma versão antiga manualmente: copie o arquivo de `dados/backup/<id>/` para `dados/modelos/<id>.json` com o GERADOC fechado.
Se algum arquivo da pasta de modelos estiver danificado, a tela inicial avisa qual é — nada é apagado automaticamente.

## Testes
`npm test` — inclui testes que abrem o Edge sem janela (geração de PDF e uso da interface de ponta a ponta).

## Documentação
Fichas do projeto (Etapas 1–3) em `doc/`. Histórico de versões em `CHANGELOG.md`.
