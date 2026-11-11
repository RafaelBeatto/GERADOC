# Changelog

## [1.0.0] - 2026-11-10
### Adicionado
- F5: **Lixeira** — tela com os modelos excluídos; **Restaurar** (renomeia para "… (restaurado)" se o nome já estiver em uso) e **Excluir definitivamente** (com confirmação; uma última cópia fica em `dados/backup/`).
- F5: **Duplicar** modelo — cria "Nome (cópia)", "Nome (cópia 2)"…
- F4: **Backup automático** — ao salvar um modelo, a versão anterior vai para `dados/backup/<id>/` (guarda as 20 mais recentes).
- F4: aviso na tela inicial quando um arquivo da pasta de modelos está danificado (ele não é apagado); abrir um modelo danificado mostra mensagem clara.
- Teste de ponta a ponta da interface no Edge (criar, duplicar, excluir, restaurar, excluir definitivamente, gerar e baixar o PDF).

### Alterado
- Gravação dos arquivos mais resistente no Windows: tenta de novo quando o antivírus segura o arquivo por instantes; temporários de gravações interrompidas são limpos ao iniciar.
- Arquivo de modelo copiado à mão (id diferente do nome do arquivo) é ignorado em vez de causar confusão entre modelos.
- Pré-visualização e PDF removem do modelo qualquer coisa que execute código (só possível editando o JSON à mão).
- Listas sem o marcador interno do editor ganham números/marcadores no PDF.

### Corrigido
- Diálogo de confirmação: cancelar e logo em seguida pedir outra exclusão podia ignorar a confirmação.

### Visual (feito antes desta versão)
- Visual refeito com padrão profissional: tema claro e sóbrio, uma única cor de destaque (azul), tipografia, espaçamentos, botões e campos padronizados (tokens em `public/css/estilo.css`).
- Lista de modelos em tabela (nome, última alteração, ações) com busca e contagem; estado vazio próprio.
- Mesmo cabeçalho em todas as telas, com caminho de navegação (Modelos / …).
- Editor de modelo organizado em seções (Identificação, Conteúdo) e rodapé de ações.
- Tela Gerar: painel de respostas com progresso e pré-visualização da folha A4 sobre fundo neutro.
- Ícones SVG locais (funcionam sem internet), indicador de status com ponto colorido, avisos e diálogo de exclusão padronizados, botão Gerar PDF com indicador de carregamento.

## [0.4.0] - 2026-11-10
### Adicionado
- F3: **Gerar PDF** — com todas as perguntas respondidas, o PDF é baixado (pasta Downloads) com o nome `<modelo> - <data>.pdf`.
- PDF A4 retrato, margens de 2,5 cm, com a formatação do modelo (títulos, negrito, cores, alinhamento, listas, tamanhos).
- Usa o Microsoft Edge já instalado (ou o Google Chrome), sem abrir janela; funciona sem internet.
- O servidor monta o documento a partir do modelo salvo + respostas e confere de novo se nada ficou sem resposta.
- Testes da geração do PDF.
- Ao abrir o GERADOC com uma versão antiga ainda aberta em outra janela, avisa para fechá-la (antes abria a versão antiga sem avisar).

## [0.3.0] - 2026-11-10
### Adicionado
- F2: perguntas a partir dos campos `[X]` — botão **Gerar documento** em cada modelo.
- Uma pergunta por campo: `[Nome]`, `[NOME]` e `[ nome ]` são o mesmo campo (exibido em MAIÚSCULAS); acentos diferenciam.
- A resposta substitui todas as ocorrências e herda a formatação do campo (negrito, título…), mesmo com formatação no meio do campo.
- Pré-visualização ao vivo do documento, com campos pendentes destacados e progresso das respostas.
- Não deixa gerar com perguntas sem resposta (respostas só com espaços não contam).
- No editor, lista ao vivo das perguntas que o modelo vai fazer.
- Testes das regras de campos.

## [0.2.0] - 2026-11-10
### Adicionado
- F1: modelos — criar, listar (com busca), editar e excluir.
- Editor com formatação (Quill 2.0.3, servido localmente — funciona sem internet).
- Nome obrigatório (até 120 caracteres) e único, sem diferenciar maiúsculas.
- Excluir move o modelo para `dados/lixeira/` (nunca apaga); gravação atômica dos arquivos.
- Aviso ao sair do editor com alterações não salvas.
- Testes automáticos (`npm test`).

## [0.1.0] - 2026-11-10
### Adicionado
- F0: estrutura do projeto, servidor local (127.0.0.1:3000), `GERADOC.bat` e tela inicial.
