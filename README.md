# GERADOC

Gerador local de documentos: cole um modelo com campos `[CAMPO]`, responda às perguntas e receba o **PDF** ou o **Word (.docx)**.

## Como usar
1. Dê dois cliques em `GERADOC.bat`. Na primeira vez (e depois de atualizar) ele instala as dependências e cria o atalho **GERADOC** na Área de Trabalho.
2. Depois, abra pelo atalho **GERADOC** (a janela preta já abre minimizada). O navegador abre em http://localhost:3000.
3. Para desligar: **Configurações → Encerrar o GERADOC**, ou feche a janela preta.

Requisitos: Node.js 20 ou superior e Microsoft Edge (já vem no Windows) ou Google Chrome — usado, sem janela, para gerar os documentos.
Se o navegador estiver em outro lugar, defina a variável `GERADOC_NAVEGADOR` com o caminho do `.exe`.
O atalho também pode ser criado pelo `CriarAtalho.bat` ou em **Configurações**.

## Modelos
- **Novo modelo**: dê um nome e escreva ou cole o texto. O que muda a cada documento vai entre colchetes: `[NOME]`, `[CPF]`, `[DATA]`.
  `[Nome]`, `[NOME]` e `[ nome ]` são o mesmo campo (uma só pergunta); acentos diferenciam.
- **Editar**, **Duplicar** (cria "Nome (cópia)") e **Excluir** ficam em cada linha da lista.
- No editor: imagens (logotipo, assinatura — clique na imagem para mudar a largura), **quebra de página** (botão ao lado da imagem) e **Inserir campo**, que escreve o campo já com o tipo.

### Tipos de campo
Depois do nome, use dois-pontos e o formato. O mesmo campo pode aparecer com formatos diferentes e continua sendo **uma** pergunta:

| No modelo | Pergunta | Sai no documento |
|---|---|---|
| `[VALOR:moeda]` | valor em reais | R$ 1.500,00 |
| `[VALOR:extenso]` | (mesma pergunta) | mil e quinhentos reais |
| `[DATA:data]` | calendário | 01/12/2026 |
| `[DATA:data-extenso]` | calendário | 1º de dezembro de 2026 |
| `[CPF:cpf]` / `[CNPJ:cnpj]` | com máscara e verificação dos dígitos | 529.982.247-25 |
| `[CEP:cep]` / `[FONE:telefone]` | com máscara | 01310-100 / (11) 98765-4321 |
| `[QTD:numero]` / `[QTD:numero-extenso]` | número | 1.500 / mil e quinhentos |
| `[NOME:maiusculas]` | texto | MARIA DA SILVA |
| `[HOJE]` / `[HOJE:extenso]` | **nenhuma** (automático) | data do dia |

Sem formato (`[NOME]`), a resposta sai como foi digitada. Respostas inválidas (CPF com dígito errado, data inexistente) não deixam gerar.

### Página, cabeçalho e rodapé
Em cada modelo: papel (A4, Carta, Ofício, A5), orientação, margens, fonte e tamanho da letra; cabeçalho e rodapé (podem ter imagem e campos) e numeração "Página 1 de 3". Modelos antigos continuam em A4, margens de 2,5 cm, Segoe UI 12.

### Versões anteriores
No editor, **Versões anteriores** mostra as 20 últimas versões salvas do modelo e permite restaurar qualquer uma (a versão atual também fica guardada, então dá para desfazer).

### Exportar e importar
**Exportar** (no editor, um modelo; em Configurações, todos) baixa um arquivo `.json`. **Importar** (na lista ou em Configurações) traz modelos de um arquivo desses — sempre como modelos novos; nome repetido ganha "(importado)".

## Gerar um documento
Na lista de modelos, clique em **Gerar documento**, responda às perguntas e clique em **Gerar PDF** ou **Gerar Word**.
O arquivo vai para a pasta Downloads com o nome `<modelo> - <data>.pdf` (ou `.docx`).
- Respostas já usadas aparecem como sugestão ao digitar.
- **Usar estas respostas** preenche com as respostas da última geração daquele modelo.

## Histórico
Cada documento gerado fica no **Histórico** (até 1000), com as respostas usadas. **Gerar de novo** abre o modelo com as mesmas respostas para mudar o que precisar. Excluir do histórico não apaga arquivos baixados.

## Lixeira
Excluir um modelo o leva para a **Lixeira** (botão no topo da lista), de onde ele pode ser **restaurado**.
Se já existir outro modelo com o mesmo nome, o restaurado ganha "(restaurado)" no nome.
**Excluir definitivamente** tira o modelo da lixeira; mesmo assim, uma última cópia fica em `dados/backup/`.

## Onde ficam os dados
| Pasta | O que tem |
|---|---|
| `dados/modelos/` | um arquivo JSON por modelo |
| `dados/lixeira/` | modelos excluídos |
| `dados/backup/<id>/` | as 20 versões anteriores de cada modelo |
| `dados/historico.json` | documentos gerados e respostas |
| `dados/configuracoes.json` | pasta do backup externo |

### Backup externo
Em **Configurações → Backup externo**, escolha uma pasta do OneDrive, Google Drive ou um pendrive. O GERADOC copia toda a pasta `dados/` para `<pasta>\GERADOC-backup` ao abrir e alguns segundos depois de cada alteração. Nada é apagado de lá.
Para recuperar: com o GERADOC fechado, copie as pastas de `GERADOC-backup` de volta para `dados/`.

Se algum arquivo da pasta de modelos estiver danificado, a tela inicial avisa qual é — nada é apagado automaticamente.

## Segurança
O servidor só escuta em 127.0.0.1 e só aceita pedidos endereçados a `localhost` vindos das páginas do próprio GERADOC (proteção contra sites maliciosos abertos no mesmo navegador).

## Testes
`npm test` — inclui testes que abrem o Edge sem janela (geração de PDF e Word e uso da interface de ponta a ponta).

## Documentação
Fichas do projeto (Etapas 1–3) em `doc/`. Histórico de versões em `CHANGELOG.md`.
