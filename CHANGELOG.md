# Changelog

Todas as mudanças relevantes deste projeto são anotadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e
o versionamento segue [SemVer](https://semver.org/lang/pt-BR/).

## [0.2.3] — Resolução entre arquivos, interfaces e rotinas

### Interfaces e rotinas entre arquivos

- Correção da resolução de portas de interface com modport, interfaces virtuais
  e chamadas de métodos por caminhos hierárquicos; navegação aponta para o arquivo
  que declara o membro, inclusive em métodos herdados.
- Leitura de protótipos `extern task/function` e ligação dos corpos
  `task automatic Classe::metodo(...)` aos membros da classe em outro arquivo.
- Travessia dos corpos de tasks/functions, declarações locais, variáveis de `for`,
  argumentos não-ANSI e herança de tipo/direção em listas de argumentos ANSI.
- Resolução de chamadas a rotinas de compilação-unidade em outros arquivos.
- Completion com campos editáveis para os argumentos, sugestões de argumentos
  nomeados e suporte LSP a signature help em `(` e `,`, com argumento ativo,
  direções, tipos e valores padrão. Hover também apresenta a assinatura.

### Corrigido

- **O `include` passou a ser seguido de verdade, e o caminho dele resolvido.**
  Um `` `include "pkg/cfg_pkg.svh" `` é uma *string*, não um caminho: nada no
  workspace diz se ela é relativa ao arquivo que a escreve, à raiz do projeto, ou
  um nome que só existe numa biblioteca de fornecedor. Um compilador recebe
  `+incdir+` e uma file list; o editor não recebia nada, e por isso um pacote em
  `../pkgs/` ficava invisível — `cfg_pkg::WIDTH` não tinha contra o que resolver,
  e todo parâmetro do módulo aparecia como desconhecido.
  - O nome é procurado na ordem em que um compilador procuraria: **ao lado do
    arquivo que inclui**, **subindo até quatro pastas**, **na raiz de cada
    workspace** e, por fim, **pelo caminho relativo em qualquer arquivo já
    indexado do projeto** (o mais raso vence) ou pelo nome de arquivo, quando
    existe exatamente um.
  - `` `include <...> `` **nunca** é procurado ao lado do arquivo: um include de
    biblioteca não é relativo a quem o escreve, e procurar lá transforma uma cópia
    local na versão da biblioteca.
  - **O arquivo alcançado pelo include entra no índice**, mesmo estando numa pasta
    que a varredura nunca visitou — que é justamente o caso de um `.sv` aberto
    sem workspace folder, onde a única pasta que o editor conhece é a do próprio
    arquivo. As dependências são lidas antes de qualquer análise, como a varredura
    já faz, para a resposta não depender da ordem.
  - A cadeia é seguida inteira: um cabeçalho que inclui três outros é comum, e é
    bem no mais distante que a declaração costuma estar. Passadas ilimitadas por
    profundidade real, com um limite.
  - **Um include que não resolve é nomeado no log**, junto com quem o pede. É a
    diferença entre "a ferramenta quebrou" e "falta `std_cells.svh`", e o sintoma
    — todo macro daquele arquivo parecendo não declarado — aponta para a extensão
    em vez do file list.
  - Um include **digitado agora** também é seguido: a pasta já foi varrida faz
    tempo, e a linha nova é a única coisa que nomeia o arquivo. Isso é
    debounceado junto com o resto do trabalho de tecla.
- **O que um cabeçalho declara acima do primeiro `module` deixou de ser
  descartado.** `typedef struct packed {...} hdr_t;` e os literais de um `enum`
  escritos no topo de um `.svh` são a compilação-unidade entregada a quem o
  inclui, e não pertencem a nenhum escopo — o arquivo do cabeçalho não tem módulo
  onde guardá-los. Eram jogados fora, então todo uso daquele tipo no arquivo que
  inclui era um identificador desconhecido, sem hover e sem ir para definição.
  - Eles ficam no catálogo por arquivo, e chegam ao arquivo que inclui pelo
    **fecho transitivo** do include: hover, ir para definição, completion e o
    diagnóstico de identificador desconhecido passam a enxergá-los.
- **O pacote não precisa mais estar na mesma pasta que o arquivo.** A descoberta
  automática indexava a pasta do arquivo aberto; o include agora cobre o resto,
  e o caminho do pacote é resolvido em qualquer pasta do projeto.

### Adicionado

- **O módulo topo de cada projeto, com cache.** O módulo que ninguém instancia e
  cuja árvore de instanciação alcança o resto é o ponto de entrada do design — é o
  que o RTL viewer deve abrir, e é a única resposta possível para um arquivo sem
  módulo próprio (um cabeçalho, um pacote).
  - Escolhido entre as raízes pelo que alcança: um testbench que instancia o
    design inteiro é o topo, porque de fato alcança tudo. Todas as raízes são
    listadas, da mais larga para a mais estreita.
  - **A busca acontece uma vez e a resposta fica guardada.** O que a mantém
    correta é a nova versão estrutural do catálogo: uma assinatura de unidade
    (nome, tipo, o que ela instancia) é o desenho; renomear um sinal não é. Uma
    tecla não refaz a busca; instanciar um módulo novo, sim.
  - `svision/designTop` responde pelo topo, e o cliente o usa quando o arquivo
    aberto não declara módulo nenhum.
  - Módulo que instancia a si mesmo não é raiz, e um `package` ou uma `class`
    nunca é topo.

### Desempenho

- As diretivas de `include` são lidas da árvore que o editor já parseou, não de
  um parse novo, e a resolução de um nome é memorizada enquanto o conjunto de
  arquivos conhecidos é o mesmo. Um miss é refeito assim que o índice aprende
  mais um arquivo — o cabeçalho pode simplesmente ainda não ter sido lido.

## [0.2.1] — Macros de texto, na forma como o RTL as escreve

### Adicionado

- **Macros de texto.** `` `NOTMRINST((CHANW-1),0,chan_mask); `` é uma declaração
  escrita por um preprocessador, não pelo autor: sem expansão ela não declara
  nada e todo uso do sinal aparece como identificador desconhecido.
  - As definições são coletadas de **todos os arquivos indexados do workspace**,
    porque uma macro é definida num arquivo e usada em outro — quase sempre
    através de um `include` que o editor não alcança.
  - `define` com parâmetros e sem eles, com substituição por palavra inteira
    (`NAME` não substitui dentro de `NAME_TMR`), token pasting (`NAME``_TMR` →
    `NAME_TMR`) e macros aninhadas, com limite de profundidade.
  - `` `ifdef `` / `` `ifndef `` / `` `else `` / `` `endif ``: os ramos são
    coletados em vez de avaliados, porque o valor da condição não é dedutível do
    fonte. Com colisão de nome, o `define` posterior vence — que é o ramo do
    `else`, o que vale quando a feature não está ligada.
  - `` `undef `` é respeitado. `include` **não** é seguido.
  - Uma macro que o workspace não define é deixada intacta: viraria uma
    declaração inventada em silêncio.
  - **Macros onde o autor espera HDL.** `` `TMR(state,,nstate); `` é uma
    atribuição e `` output `TMRINST(SIZE-1,0, state); `` é uma declaração de
    porta — nenhuma das duas existe como produção na gramática, então o parse
    para antes e a palavra-chave ao lado (`else`, `output`) fica órfã, reportada
    como erro de sintaxe do autor. O erro de sintaxe que a macro provoca é
    suprimido; um erro real, mesmo num arquivo que usa macros, continua
    reportado.
  - **Indexar uma segunda pasta não apaga o que a primeira ensinou.** O indexador
    limpava a tabela de macros e a lista de classes no início de toda passada.
    Abrir `rtl/pattern_generator.v` reindexava `rtl/` e destruía tudo que
    `common/tmr.v` tinha contribuído — os 35 sinais que as macros declaram
    voltavam a ser desconhecidos assim que o arquivo era aberto, que é
    exatamente quando o autor está olhando para eles.
  - As macros de uma pasta são coletadas **antes** de qualquer arquivo da pasta
    ser analisado, então a resposta não depende da ordem em que o diretório foi
    percorrido.
  - **Macros chamadas e nunca definidas são nomeadas no log**, com a pasta que
    as chama. `include` não é seguido, então uma definição numa biblioteca de
    fornecedor deixa todo sinal que ela declara parecendo não declarado — e
    dizer o nome da macro é o que separa "falta um arquivo" de "a ferramenta
    quebrou".
  - **Argumentos formais não são sinais.** `NAME`, `RANGE` e `ASSIGNMENT` em
    `` `define TMR(NAME, RANGE, ASSIGNMENT) `` são os nomes que a macro
    substitui. A gramática aninha cada um sob `formal_argument`, então filtrar
    só a definição deixava todos reportados como não declarados — vinte
    achados num único arquivo de cabeçalho.
- **Funções e tasks** declaradas em módulo são registradas como símbolos: uma
  chamada resolve, completa e leva à definição, e o tipo de retorno aparece no
  hover. Antes elas viravam escopo, mas não eram declaradas em lugar nenhum.
- **Argumentos** de funções e tasks (`input int a, output logic q`) são lidos
  como ports, com direção e largura. Sem isso, todo uso de um argumento dentro
  do corpo era reportado como identificador desconhecido.
- **Descoberta automática de pacotes**: a pasta do arquivo aberto é indexada
  mesmo sem workspace folder, e o cliente manda essa pasta explicitamente. É o
  caso do `.sv` aberto sozinho, em que todo `workspaceFolders` do protocolo vem
  vazio e os pacotes ao lado do arquivo nunca eram indexados.
- Teste de integração que indexa um diretório de verdade e confere que um
  pacote em `.svp` chega ao catálogo e resolve seus parâmetros.
- Testes que dobram larguras escritas com parâmetros de pacote, por `import` e
  por `pkg::PARAM`, incluindo a precedência do valor local.

### Corrigido

- **Em Verilog-1995 nenhum parâmetro era lido.** Com cabeçalho não-ANSI, toda
  declaração do corpo chega embrulhada em um `module_item` — que a travessia não
  atravessava. O sintoma é traiçoeiro: as portas ficam certas, porque são lidas
  por outro caminho, e só os parâmetros somem. Um `parameter integer DATAW = 12;`
  escrito depois de `module m (a);` era invisível. Vale para `module_item`,
  `interface_item` e `program_item`, e vale para qualquer declaração, não só
  parâmetros.
- **Uma porta sem tipo declarado ficou sem largura.** `input clk;` em Verilog-1995
  é um wire escalar implícito; dizer "não sei" separe como "não entendi".
- **Os achados não sumiam sozinhos depois que o índice terminava.** A indexação
  roda depois do handshake, então o que está na tela foi analisado contra um
  catálogo vazio: um módulo que importa um pacote reporta cada um dos seus
  parâmetros como desconhecido — 43 achados num módulo real — e **esses achados
  ficam** até o usuário digitar algo. Republicar o diagnóstico não bastava,
  porque a largura de `[C_PKT_DAT_W-1:0]` também depende do pacote: a análise
  é refeita quando a indexação termina.
- **Blocos `begin : nome` não existiam.** Um bloco nomeado é um escopo
  endereçável por nome hierárquico, e nada o reconhecia: os sinais declarados
  dentro dele eram desconhecidos — na declaração e em todo uso — e as
  referências `bloco.sinal` eram reportadas como não declaradas. Num testbench
  típico eram 14 falsos positivos de uma vez.
  - `seq_block` e `par_block` passaram a abrir escopo quando têm nome, e as
    declarações escritas dentro deles (`logic [7:0] scratch;`) são lidas.
  - O nome do bloco é declarado em todos os escopos até a unidade de design, e
    não só no pai direto: um bloco dentro de um `generate` é neto do módulo, e
    `gblk.lane` se escreve do corpo do módulo.
  - `hover`, ir para definição e completion após `bloco.` funcionam, inclusive
    para blocos aninhados em `generate` e dentro de `fork`.
- **A travessia não descia até os blocos nomeados.** `initial begin : main`
  é `initial_construct > statement_or_null > statement > statement_item >
  seq_block`, e o mesmo para os constructos de generate, que são quatro
  níveis de wrapper. Parar antes deixava o bloco fechado.
- **`begin : nome` dentro de `generate for` continuava sem escopo.** Os nomes
  dos nós de generate não são adivinháveis: a gramática chama o construct de
  `for` de `loop_generate_construct` e o braço de `case` de
  `case_generate_item`. Uma lista escrita com `for_generate_construct` casa
  com nada, e o efeito é silencioso — todo `grant_delay_loop` some, junto com
  os sinais que declara. A travessia passou a descer por qualquer nó cujo tipo
  contenha "generate" e não seja um escopo, com o veredicto memoizado por tipo.
- **`default_nettype`, `ifndef` e `include` não quebravam nada** — confirmado
  com um arquivo real que os empilha antes do módulo.

### Desempenho

- Um `begin ... end` **sem nome** não abre escopo: não é endereçável por nada,
  e cada escopo a mais é um intervalo a filtrar em toda tecla. Um módulo de 243
  linhas saiu de 55 escopos para 7, e os diagnósticos ficaram ~20% mais rápidos
  (15,6 ms → 12,3 ms). A re-análise ficou 10,0 ms → 10,4 ms.

### Corrigido (anterior)

- **`module m import p::*; ( ... );` não era lido.** O import entre o nome do
  módulo e a lista de ports é filho do nó de cabeçalho, não do corpo, então
  nada da travessia o via — e os parâmetros usados nas larguras *da própria
  lista de ports* apareciam como desconhecidos. É a forma como muitos projetos
  de RTL escrevem o cabeçalho, e o erro aparecia exatamente onde a largura é
  declarada. Import em cabeçalho de `interface` e `program` também.
- **Larguras escritas com um parâmetro de pacote não eram resolvidas.**
  `output logic [C_PKT_DAT_W-1:0] pkt_dat_word_o [C_NB_DLINK]` resolvia o nome
  e completava, mas nunca mostrava bits — o nome resolvia e a largura não. O
  dobramento de constantes via apenas os parâmetros do próprio arquivo, então um
  valor que vive em outro arquivo era invisível. Análise agora recebe do
  catálogo os valores dos pacotes importados, e a forma qualificada
  `pkg::PARAM` também vale.
- **`[pkg::W-1:0]` nunca dobrava.** `indexOfTopLevelColon` pegava o primeiro
  `:` do `::` e quebrava a expressão no lugar errado, então toda largura
  qualificada saía desconhecida.
- **`[4]` contava 5 elementos.** Uma dimensão de array é um tamanho, não um
  intervalo: `[7:0]` são 8 elementos e `[8]` também são 8, mas `[4]` estava
  sendo tratado como intervalo e virava 5. O Navigator mostrava `5 x 32 bits`
  onde devia mostrar `4 x 32 bits`.
- **A análise era 10x mais lenta do que precisava.** A causa era o coletor do
  Signal Tracer: para cada referência de identificador ele procurava o nó
  novamente, descendo a árvore desde a raiz, e convertia a posição de volta em
  offset lendo o documento **um caractere por vez** através da fronteira do
  WASM. Num arquivo de 243 linhas isso eram 95 dos 100 ms de uma análise, e
  rodava a cada tecla.
- **`import pkg::*` não trazia o que o próprio `pkg` tinha importado.** Um
  pacote que faz `import base_pkg::*` não expunha os parâmetros, typedefs,
  funções e tasks de `base_pkg` para quem o importasse — todos apareciam como
  identificador desconhecido, enquanto o arquivo que os declara parecia
  perfeito. É o caso mais desconcertante possível: o erro aparece no arquivo
  *consumidor*, nunca no *responsável*. O `CatalogEntry` agora guarda os
  imports da própria unidade e a cadeia é seguida, com limite de saltos e
  proteção contra ciclo.
- **Pacotes em arquivos `.svp` nunca eram indexados.** `.svp` é registrado como
  extensão de SystemVerilog e o watcher do cliente já observava o arquivo, mas
  o indexador o excluía: o pacote era aberto e colorido, e ao mesmo tempo seus
  parâmetros eram invisíveis para qualquer busca que cruzasse arquivos. O
  padrão de `svision.index.include` agora cobre toda extensão declarada.
- **Funções e tasks dentro de um pacote** passaram a ser importáveis como
  qualquer outro membro.

### Desempenho

Medido num workspace de 49 arquivos (255 KB):

| | antes | depois |
| --- | --- | --- |
| Indexar o workspace | 5054 ms | ~700 ms |
| Analisar um arquivo de 243 linhas | 100,6 ms | 10,0 ms |
| Diagnósticos nesse arquivo | 25,9 ms | 15,6 ms |
| Indexar e ficar pronto para uso | 5096 ms | ~730 ms |

- O coletor de referências e o de acessos passaram a ser **uma única
  travessia** da árvore. Antes a mesma árvore era percorrida duas vezes para
  produzir dois resultados que nascem do mesmo nó.
- As seis varreduras que os diagnósticos faziam foram reunidas em uma só.
- O indexador **cede o event loop entre arquivos**. Parsear é CPU-bound e
  síncrono, então algumas centenas de arquivos formavam um bloco único em que o
  servidor não respondia a nada: sem hover, sem completion, e os pedidos do
  editor enfileirados atrás do índice. Medido: 68 tiques durante a indexação,
  latência máxima de 0,2 ms.

## [0.2.0] — OOP, pacotes de outro arquivo e a mudança de nome

### Adicionado

**Orientação a objetos**
- Classes são unidades de primeira classe: propriedades, métodos, construtores,
  tarefas e parâmetros declarados no corpo da classe passam a ser lidos.
- Qualificadores de membro preservados — `rand`, `static`, `local`,
  `protected` — e exibidos no hover e no completion.
- Herança: `extends Base` registra a classe base, e os membros herdados
  resolvem, completam e recebem ir-para-definição mesmo com a base em outro
  arquivo.
- Instâncias de classe (`Packet pkt;`) são reconhecidas como handles, com
  hover, completion de membros após `pkt.` e navegação até a declaração.
- Navigator lista arquivos que só declaram classes ou pacotes, e coloca um
  handle ao lado das instâncias de módulo.

**Pacotes de outro arquivo**
- `cfg_pkg::WIDTH` resolve em hover, ir-para-definição e completion.
- `import cfg_pkg::*` traz os nomes do pacote para o escopo: resolvem,
  aparecem no completion e não são mais reportados como desconhecidos.
- `import cfg_pkg::WIDTH` (não-curinga) importa apenas o que nomeia.

**Barra lateral**
- **Navigator**: passa a varrer `class` e `package`, além de `module` e
  `interface`.

### Corrigido

- `pkg::NOME` nunca resolvia. A gramática não produz nó `scope_resolution`:
  a referência chega como `method_call`, e dentro de um `localparam` ainda vira
  `constant_function_call`. A divisão passa a ser feita pelo texto.
- Parâmetros de um `package` apareciam duplicados. `package p;` não tem nó de
  cabeçalho, e a busca por parâmetros do cabeçalho varria o corpo inteiro,
  contando tudo duas vezes.
- Escrita através de um handle de classe (`pkt.payload = 8'hAB`) era reportada
  como truncamento de 1 bit.
- Um método chamado `constructor` recebia uma largura que era a função
  `Object` herdada do prototype de JavaScript, e aparecia no completion como
  `function Object() { [native code] } bits`.
- Qualificadores `rand` e `static` eram descartados: são tokens anônimos, e a
  busca por `namedChildren` do wrapper não os encontra.
- Métodos de classe apareciam duplicados no outline, como símbolo e como
  escopo.

### Alterado

- **A extensão passou a se chamar `SVision`** (antes `dmpsv` / *SystemVerilog
  IDE*). Como o identificador do Marketplace mudou, isto publica uma extensão
  nova — a `dmpsv` continua instalada por baixo.
- Comandos, configurações e views ganharam o prefixo `svision.`
  (`svision.traceSignal`, `svision.completion.showWidth`,
  `svision.navigator`, …). **Configurações `dmpsv.*` antigas deixam de
  funcionar** e precisam ser renomeadas no `settings.json`.
- O índice do workspace lê todos os arquivos antes de analisar qualquer um.
  Reconhecer `Packet pkt;` depende de saber o que `Packet` é, e o arquivo que
  o declara pode ser lido depois daquele que o usa — sem isso o resultado
  dependia da ordem do diretório.

## [0.1.0] — primeira versão

### Adicionado

**Linguagem**
- Gramáticas TextMate para SystemVerilog e Verilog.
- Completion com tipo e largura resolvidos: `wire [7:0] dout`, `integer rptr`.
- Hover com tipo e largura em bits de qualquer referência.
- Ir para definição e encontrar referências, atravessando arquivos do
  workspace.
- Realce de identificadores, símbolos e ports na barra do editor.

**Diagnósticos**
- Identificador desconhecido.
- Largura incompatível em atribuição (apenas truncamento, não extensão).
- Atribuição bloqueante dentro de `always_ff`.
- Lista de sensibilidade incompleta.
- Latch inferido.

**Barra lateral**
- **Signal Tracer**: drivers e loads do sinal sob o cursor, seguindo a
  hierarquia entre módulos. Drivers em verde, loads em azul, travessia de
  fronteira em roxo, e tudo que vem de outro arquivo agrupado sob
  "In other files".
- **Design Checks**: múltiplos drivers, sinal sem driver, sinal sem load,
  dimensão incompatível e conexão inter-módulo. Escopo no arquivo aberto.

**Editor**
- Painel de hierarquia de módulos em SVG.
- 18 snippets de código.
- Relatório de símbolos no Output.
