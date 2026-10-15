# SVision (`svision`)

Uma extensão do VS Code que transforma a edição de **SystemVerilog / Verilog** em
uma experiência de IDE de verdade — hover com tipo e largura em bits, completion
que conhece a interface do módulo instanciado, navegação entre arquivos e
diagnósticos no estilo JetBrains.

---

## O que ela faz

### Completion com tipo e largura

A lista de sugestões mostra, para cada sinal, o tipo declarado e a **largura
resolvida em bits** — inclusive quando ela depende de parâmetros:

```systemverilog
module counter #(parameter int W = 8) (
  input  wire [W-1:0] din,   // completion mostra:  input · wire · 8 bits
  output wire [W-1:0] dout
);
  logic [W-1:0] shadow;      // completion mostra:  logic · 8 bits
```

Parâmetros são dobrados até um valor exato, incluindo `$clog2` e aritmética:

```systemverilog
localparam int AW = $clog2(DEPTH);  // AW = 8 quando DEPTH = 256
logic [AW-1:0] addr;                // → 8 bits
```

Quando o cursor está dentro de uma instanciação, a lista muda para a interface
daquele módulo — só as portas (ou só os parâmetros):

```systemverilog
fifo #(.WIDTH(32)) u_fifo (
  .p|          ← completion: apenas  push, pop, full, empty, data_in ...
);
```

### Hover

`Ctrl+K Ctrl+I` (ou o mouse) mostra a declaração, o tipo, a direção, a largura
em bits, o número de elementos de arrays não empacotados, a contagem de usos no
arquivo e o comentário de documentação acima da declaração. Hover sobre um nome
de módulo mostra a tabela de portas do módulo.

### Navegação

| Recurso | Atalho |
| --- | --- |
| Ir para definição | `F12` / `Ctrl+Click` |
| Encontrar todas as referências | `Shift+F12` |
| Outline de módulos / portas / sinais | aba **Outline** |
| Realçar todas as ocorrências | seleção de um símbolo |

Funciona dentro do arquivo e entre arquivos: um nome de módulo, interface ou
package é resolvido pelo índice do workspace. Clicar em `.port(...)` de uma
instanciação leva à declaração daquela porta no módulo instanciado.

### Diagnósticos

Todos configuráveis individualmente:

| Código | O que detecta |
| --- | --- |
| `syntax-error` / `syntax-missing` | erro de sintaxe vindo do parser |
| `unknown-identifier` | identificador não declarado em nenhum escopo visível |
| `width-mismatch` | atribuição que **trunca** dados (perde bits) |
| `sequential-blocking` | `=` dentro de `always_ff` (deveria ser `<=`) |
| `implicit-sensitivity` | `always @(a)` que lê um sinal que não lista |
| `latch-inference` | latch inferida por atribuição incompleta |

A detecção de latch faz interseção de caminho: um sinal só é considerado seguro
quando **todas** as cláusulas do `if/else` e **todos** os braços do `case` com
`default` o atribuem.

### Sugestões de código (snippets)

`always_ff`, `always_comb`, `always_latch`, `module`, `interface`, `package`,
`typedef struct packed`, `typedef enum`, `function`, `task`, `generate for`,
`if_generate`, `assert property`, `cover property`, `covergroup`, `clocking
block`, `class`.

Também completion para palavras-chave SystemVerilog, diretivas de compilador e
funções de sistema (`$clog2`, `$bits`, `$onehot`, `$past`, `$urandom_range`, …).

---

## Instalação

Pela Marketplace:

1. Abra a paleta de comandos (`Cmd+Shift+P` no macOS, `Ctrl+Shift+P` no Linux e Windows)
2. **Extensions: Install Extensions from VSIX...**
3. Selecione o arquivo `svision-0.1.0.vsix`

A extensão é um servidor LSP local: não transmite nada para fora e não
precisa de configuração.

## Desenvolvimento

Requisitos: Node 18+ e VS Code 1.95+.

```bash
npm install
```

### Executar

```bash
npm start
```

Um comando só: compila, sobe o watcher do esbuild e abre o VS Code com a
extensão carregada em modo de desenvolvimento. Quando você fecha a janela, o
watcher é encerrado junto.

Para abrir uma pasta específica na nova janela:

```bash
npm start -- ./rtl
```

Se o `code` não estiver no PATH, o script detecta automaticamente o VS Code
instalado em `/Applications`. Para forçar um binário:

```bash
CODE_BIN="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" npm start
```

### Loop de edição

`npm start` roda **uma vez**. Depois disso, o fluxo é só salvar:

| O que você editou | O que acontece |
| --- | --- |
| `src/server/**` | watch recompila → o cliente detecta `dist/server.js` e **reinicia o language server sozinho** |
| `src/client/**` | watch recompila → precisa de `Cmd+R` (Developer: Reload Window) |

Só o segundo caso exige recarregar a janela, porque a extensão do host não pode
se recarregar em tempo de execução. Rodar `npm start` de novo **não** atualiza a
janela aberta — ele abre outra.

Para reiniciar o servidor à mão (útil quando algo ficou inconsistente), use o
comando **SystemVerilog: Restart Language Server**, ou veja a aba
*SVision* no Output para confirmar que o reinício aconteceu.

### Testando com os arquivos de exemplo

A pasta `sample/` tem três arquivos prontos para exercitar cada recurso:

```bash
npm start -- ./sample
```

| Arquivo | Serve para |
| --- | --- |
| `fifo.sv` | RTL limpo — deve ficar **sem nenhum diagnóstico** |
| `counter_pkg.sv` | package com `typedef enum` e `typedef struct` |
| `has_issues.sv` | um de cada problema, para ver os diagnósticos aparecerem |

Passos para conferir, um a um:

1. **Hover** — abra `fifo.sv`, passe o mouse em `mem` ou `wptr`. Deve mostrar
   `logic [AW-1:0] wptr`, `4 bits` e o número de usos. `AW` vale 4 porque
   `$clog2(DEPTH)` com `DEPTH = 16`.

2. **Completion com largura** — em `fifo.sv`, digite `assign ` numa linha nova.
   A lista mostra `din` como `input · wire · 8 bits` e `AW` como `int · default 4`.

3. **Completion contextual** — abra `has_issues.sv` e digite `.d` dentro de
   `u_fifo (...)`. A lista deve mostrar **só** as portas do `fifo`, com
   `input · wire` e as larguras.

4. **Go to definition** — clique em `fifo` na instanciação (ou `F12`).
   Deve pular para `sample/fifo.sv` linha 3.

5. **Outline** — abra a aba **Outline**: mostra `fifo`, `top`, `counter_pkg`
   com portas, parâmetros e sinais aninhados.

6. **Diagnósticos** — abra `has_issues.sv`. Devem aparecer exatamente 5 avisos,
   um por problema, e nenhum em `fifo.sv`. As linhas estão comentadas no
   próprio arquivo.

7. **Snippets** — num arquivo novo, digite `always_ff` e aceite. Confirme que
   o esqueleto inserido faz sentido e que o cursor cai dentro do bloco.

### Alternativa com debugging

O `npm start` não deixa porta de debug. Para depurar o servidor:

```bash
npm run watch     # build em watch
```

E no VS Code, **Run and Debug → Run Extension** (`F5`). Isso abre a Extension
Development Host e sobe o servidor com `--inspect=6009`; o segundo launch config
da `.vscode/launch.json` ("Attach to Language Server") conecta nele.

### Verificação

```bash
npm run check     # typecheck estrito
npm run build     # bundle de produção em dist/
npm test          # 35 testes de unidade (análise, hover, completion, snippets, diagnósticos)
npm run test:all  # check + build + unitários + smoke test LSP
```

O smoke test sobe o bundle de `dist/` como processo filho e fala LSP de verdade
sobre stdio, o que valida que os payloads WebAssembly do tree-sitter resolvem a
partir do pacote empacotado.

Entre os testes de snippet há um que **expande cada snippet e o manda para o
parser**. Foi ele que pegou, entre outros: o placeholder `${2:(` sem
fecha‑chave do esqueleto de módulo (faz o VS Code engolir o resto do snippet),
`module x()` inválido, `function`/`task` sem nome por default, `;` faltando no
covergroup e itens de clocking block sem direção. Vale rodar esse teste ao mexer
nos snippets — é bem mais confiável do que revisar a string à mão.

### Estrutura

```
src/
  client/extension.ts        ponto de entrada no host do VS Code
  server/
    server.ts                bootstrap e registro dos providers LSP
    verilogParser.ts         runtime do tree-sitter + gramática SV 1800-2023
    analyzer.ts              extração de escopos, símbolos e referências
    eval.ts                  avaliação de expressões constantes e larguras
    model.ts                 modelo de dados e resolução de escopo
    catalog.ts               índice de módulos do workspace
    workspaceIndex.ts        varredura de disco e globbing
    locate.ts                nó/identificador sob o cursor
    symbolFormatting.ts      hover e completion a partir dos símbolos
    completionData.ts        keywords, snippets e funções de sistema
    providers/               completion, hover, definition, documentSymbols, diagnostics
syntaxes/                    gramáticas TextMate de SystemVerilog e Verilog
test/                        testes de unidade + smoke test LSP
```

O servidor roda em processo separado e é empacotado como um único bundle CJS em
`dist/server.js`; `web-tree-sitter` e a gramática continuam externos, resolvidos
via `require.resolve` a partir do `node_modules` da extensão.

---

## Configuração

| Chave | Padrão | Efeito |
| --- | --- | --- |
| `svision.completion.showWidth` | `true` | Mostra bits no completion e no hover |
| `svision.completion.showType` | `true` | Mostra o tipo declarado |
| `svision.completion.snippets` | `true` | Oferece os snippets de RTL |
| `svision.completion.includeSystemFunctions` | `true` | Inclui `$clog2`, `$bits`, … |
| `svision.completion.includeParameters` | `true` | Inclui parâmetros no completion |
| `svision.diagnostics.enable` | `true` | Liga/desliga todos os diagnósticos |
| `svision.diagnostics.unknownIdentifiers` | `true` | Identificadores não declarados |
| `svision.diagnostics.widthMismatch` | `true` | Truncamento em atribuições |
| `svision.diagnostics.blockingInSequential` | `true` | `=` dentro de `always_ff` |
| `svision.diagnostics.implicitSensitivity` | `true` | Lista de sensibilidade incompleta |
| `svision.diagnostics.latchDetection` | `true` | Inferência de latch |
| `svision.index.include` | `**/*.{sv,svh,v,vh}` | Arquivos entram no índice |
| `svision.index.exclude` | `node_modules`, `.git`, … | Arquivos ignorados pelo índice |
| `svision.trace.server` | `off` | Log de comunicação LSP |

### Ícones do IntelliSense

O ícone de cada sugestão vem do `CompletionItemKind` que o servidor envia. O
VS Code resolve assim: `CompletionItemKind` → id `symbol-*` → registro do
Product Icon Theme ativo.

O mapeamento atual:

| Categoria HDL | `CompletionItemKind` | id do tema |
| --- | --- | --- |
| wire / net | `Value` | `symbol-value` |
| reg / logic | `Variable` | `symbol-variable` |
| porta `input` | `Field` | `symbol-field` |
| porta `output` | `Field` | `symbol-field` |
| parameter | `Constant` | `symbol-constant` |
| typedef | `Class` | `symbol-class` |
| literal de enum | `EnumMember` | `symbol-enum-member` |
| function / task | `Function` | `symbol-function` |
| módulo | `Module` | `symbol-module` |
| interface | `Interface` | `symbol-interface` |
| package | `Module` | `symbol-module` |
| instanciação | `Reference` | `symbol-reference` |
| keyword | `Keyword` | `symbol-keyword` |

Para trocar os desenhos, use qualquer **Product Icon Theme** que mapeie esses
ids (`Preferences: Product Icon Theme`). `input` e `output` compartilham
`symbol-field`; se quiser separá-las, o mapeamento em
`src/server/symbolFormatting.ts` precisa mudar — e aí os ids da tabela acima
também.

### Barra lateral: Navigator e Signal Tracer

O ícone do SystemVerilog na barra de atividades abre duas ferramentas, ambas
limitadas ao arquivo que está aberto.

**Navigator** lista tudo que o arquivo declara, agrupado por natureza, com a
largura resolvida de cada sinal:

```
Inputs (3)          clk       1 bit     wire
                    rst_n     1 bit     wire
    din         8 bits    wire
Outputs (3)         pop       1 bit     wire
                    dout      8 bits    wire
    status      16 bits   wire
Registers (4)       push_data 8 bits    logic
    push       1 bit     logic
    ...
Parameters (2)      DATA_WIDTH         int
Instances (1)       u_fifo             fifo
```

- Grupos: `Inputs`, `Outputs`, `Wires`, `Registers`, `Parameters`, `Types`,
  `Instances`. Grupos vazios somem.
- A ordem do header de ports é preservada, porque ele se lê da esquerda para a
  direita.
- Arrays não empacotados mostram as duas dimensões: `logic [7:0] mem [0:15]`
  aparece como `16 x 8 bits`, não `8 bits`.
- Clique num item salta para a declaração.
- A view se reconstroi enquanto você digita.

**Signal Tracer** mostra quem dirige e quem lê o sinal sob o cursor, seguindo a
hierarquia entre módulos:

```
▼ push_data                              top · top.sv
   ▼ Driven by                       2
       push_data <= '0
       push_data <= push_data + 1'b1
   ▼ Loaded by                       3
       assign push = !full && (push_data[0] ^ 1'b1)
       u_fifo.din
   ▸ In other files                1        ← começa fechado
       ▼ din             fifo in u_fifo · fifo.sv
```

- **Verde** dirige, **azul** carrega, **roxo** atravessa a fronteira de um
  módulo. A cor segue o grupo, não a sintaxe: um load dentro de um `assign`
  continua azul.
- O sinal é renomeado ao cruzar a fronteira — `push_data` vira `din` dentro de
  `fifo` — e a linha indica o arquivo e a instância de origem.
- Tudo que vem de outro arquivo fica sob "In other files", para que a raiz seja
  sempre sobre o arquivo aberto.
- A travessia para de propósito: o padrão são 4 níveis e 120 hops. Se o limite
  for atingido, isso aparece na lista em vez de sumir.

Para conferir: `npm start -- ./sample`, abra `sample/top.sv` e clique num sinal.

### Comandos

- **SystemVerilog: Trace Signal at Cursor** — traça drivers e loads do sinal sob o cursor. Também no botão da barra de status.
- **SystemVerilog: Explain Width at Cursor** (`Cmd+Alt+W`) — largura e tipo resolvidos do símbolo sob o cursor.
- **SystemVerilog: Refresh Navigator** — reconstrói a lista de declarações.
- **SystemVerilog: Show Symbol Report** — lista de todos os símbolos do arquivo no Output.
- **SystemVerilog: Restart Language Server** — reinicia o servidor.

---

## Como funciona

O parsing usa a gramática **SystemVerilog 1800-2023** do
`tree-sitter-systemverilog`, carregada como WebAssembly. O servidor:

1. Faz o parse incremental do documento aberto (a árvore antiga alimenta o
   `parse`, então a digitação é barata).
2. Percorre a árvore uma vez montando escopos (module, interface, package,
   program, class, function, task) e coleta portas, parâmetros, nets, variáveis,
   typedefs, enums, genvars e instanciações.
3. Dobra os parâmetros até um ponto fixo, para que `AW = $clog2(DEPTH)` resolva
   mesmo se `AW` vier antes de `DEPTH`.
4. Resolve a largura empacotada de cada sinal a partir da árvore, caindo para o
   texto quando necessário.
5. Indexa módulos e interfaces de todo o workspace para navegação cross-file.

A avaliação de constantes é deliberadamente conservadora: quando um valor não
pode ser-determinado com certeza, a largura é omitida em vez de estimada. Uma
largura errada no completion é pior do que nenhuma.

Pelo mesmo motivo, `width-mismatch` reporta **apenas truncamento**. Zerar-extender
uma expressão estreita num alvo largo é exatamente como `ptr <= ptr + 1'b1` e
constantes comuns funcionam em RTL; avisar sobre isso transformaria o painel de
problemas em ruído.

## Limitações conhecidas

- Não há modelo de tipos completo: não resolve `typedef` composed, `interface`
  com `modport` acessado por `ifc.sig`, pacotes importados (`pkg::NAME`) nem
  parâmetros sobrescritos na instanciação. Nesses casos a largura aparece vazia.
- Portas não-ANSI (`module m(a, b); input a;`) ainda não são resolvidas.
- A inferência de latch não considera laços nem `case` com `unique`/`priority`.
- Nenhuma formatação automática ainda (apenas indentação nativa do VS Code).

## Licença

MIT