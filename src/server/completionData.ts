import { CompletionItemKind, InsertTextFormat, type CompletionItem } from "vscode-languageserver-types";

/** Language keywords grouped so completion can sort them into buckets. */
const KEYWORD_GROUPS: { kind: CompletionItemKind; words: string[] }[] = [
  {
    kind: CompletionItemKind.Keyword,
    words: [
      "module", "endmodule", "macromodule", "primitive", "endprimitive",
      "package", "endpackage", "program", "endprogram", "interface", "endinterface",
      "class", "endclass", "virtual", "extends", "implements", "pure",
    ],
  },
  {
    kind: CompletionItemKind.Keyword,
    words: [
      "always", "always_ff", "always_comb", "always_latch", "initial", "final",
      "begin", "end", "fork", "join", "join_any", "join_none",
      "if", "else", "case", "casex", "casez", "endcase", "default",
      "for", "foreach", "while", "do", "repeat", "break", "continue", "return",
      "forever", "wait", "disable", "assign", "deassign", "force", "release",
    ],
  },
  {
    kind: CompletionItemKind.TypeParameter,
    words: [
      "logic", "bit", "byte", "shortint", "int", "longint", "integer", "time",
      "real", "shortreal", "realtime", "reg", "wire", "tri", "wand", "wor",
      "supply0", "supply1", "tri0", "tri1", "triand", "trior", "trireg",
      "uwire", "interconnect", "void", "string", "chandle", "event", "genvar",
    ],
  },
  {
    kind: CompletionItemKind.Struct,
    words: ["struct", "union", "enum", "packed", "tagged"],
  },
  {
    kind: CompletionItemKind.Keyword,
    words: [
      "input", "output", "inout", "ref", "const", "var", "static", "automatic",
      "localparam", "parameter", "local", "protected", "rand", "randc",
    ],
  },
  {
    kind: CompletionItemKind.Keyword,
    words: [
      "signed", "unsigned", "unique", "unique0", "priority", "with",
      "inside", "dist", "matches", "tagged", "binsof",
    ],
  },
  {
    kind: CompletionItemKind.TypeParameter,
    words: ["typedef", "enum", "bit", "logic", "class", "interface"],
  },
  {
    kind: CompletionItemKind.Module,
    words: ["import", "export", "timeunit", "timeprecision", "celldefine", "endcelldefine", "`include", "`define"],
  },
];

/** Macros that behave like keywords, surfaced with a distinct icon. */
const DIRECTIVES = [
  "`define", "`undef", "`ifdef", "`ifndef", "`else", "`elsif", "`endif",
  "`include", "`timescale", "`default_nettype", "`resetall", "`celldefine",
  "`unconnected_drive", "`line", "`begin_keywords", "`end_keywords", "`pragma",
];

/** System tasks and functions worth surfacing in RTL contexts. */
const SYSTEM_FUNCTIONS = [
  { name: "$clog2", detail: "Returns the integer log2 of the argument." },
  { name: "$bits", detail: "Returns the size of a type or signal in bits." },
  { name: "$size", detail: "Returns the number of elements in an unpacked dimension." },
  { name: "$left", detail: "Shifts a value left, filling with zeros." },
  { name: "$right", detail: "Shifts a value right, filling with zeros." },
  { name: "$signed", detail: "Reinterprets the value as signed." },
  { name: "$unsigned", detail: "Reinterprets the value as unsigned." },
  { name: "$ceil", detail: "Rounds up to the nearest integer." },
  { name: "$floor", detail: "Rounds down to the nearest integer." },
  { name: "$sqrt", detail: "Square root." },
  { name: "$ln", detail: "Natural logarithm." },
  { name: "$log10", detail: "Base-10 logarithm." },
  { name: "$pow", detail: "Raises the first argument to the second." },
  { name: "$urandom", detail: "Pseudo-random number." },
  { name: "$urandom_range", detail: "Pseudo-random number in a range." },
  { name: "$time", detail: "Current simulation time." },
  { name: "$stime", detail: "Simulation time scaled to the module time unit." },
  { name: "$realtime", detail: "Current simulation time as a real." },
  { name: "$countones", detail: "Number of bits set to one." },
  { name: "$onehot", detail: "True when exactly one bit is set." },
  { name: "$onehot0", detail: "True when at most one bit is set." },
  { name: "$isunknown", detail: "True when any bit is x or z." },
  { name: "$past", detail: "Value of an expression in a previous time step." },
  { name: "$rose", detail: "True on a 0 -> 1 transition." },
  { name: "$fell", detail: "True on a 1 -> 0 transition." },
  { name: "$stable", detail: "True when the value did not change." },
  { name: "$display", detail: "Writes values to the simulator output." },
  { name: "$write", detail: "Writes values without a trailing newline." },
  { name: "$monitor", detail: "Prints whenever any monitored argument changes." },
  { name: "$finish", detail: "Ends the simulation." },
  { name: "$stop", detail: "Pauses the simulation." },
  { name: "$fatal", detail: "Assertion failure that ends the simulation." },
  { name: "$error", detail: "Assertion failure." },
  { name: "$warning", detail: "Assertion warning." },
  { name: "$info", detail: "Informational assertion message." },
  { name: "$assertkill", detail: "Ends the simulation on failure." },
  { name: "$sformatf", detail: "Formats arguments into a string." },
  { name: "$typename", detail: "Returns the type name of an expression." },
];

/** Snippet templates for common RTL scaffolding. */
interface Snippet {
  readonly label: string;
  readonly detail: string;
  readonly body: string | string[];
  readonly kind: CompletionItemKind;
}

const SNIPPETS: Snippet[] = [
  {
    label: "always_ff",
    detail: "Sequential block driven by a clock (non-blocking assignments)",
    body: [
      "always_ff @(posedge ${1:clk} ${2:or negedge rst_n}) begin",
      "\tif (!${3:rst_n}) begin",
      "\t\t$4",
      "\tend else begin",
      "\t\t$0",
      "\tend",
      "end",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "always_ff_simple",
    detail: "Sequential block, clock only, no reset",
    body: ["always_ff @(posedge ${1:clk}) begin", "\t$0", "end"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "always_comb",
    detail: "Combinational block",
    body: ["always_comb begin", "\t$0", "end"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "always_latch",
    detail: "Latch block (infers a latch unless every path assigns)",
    body: ["always_latch begin", "\t$0", "end"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "always_block",
    detail: "Verilog-2001 style always @(*)",
    body: ["always @(*) begin", "\t$0", "end"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "module",
    detail: "Module skeleton with parameter and port lists",
    body: [
      "module ${1:name} #(${2:parameter int W = 8}) (",
      "\tinput  wire            ${3:clk},",
      "\tinput  wire            ${4:rst_n}",
      ");",
      "",
      "\t$0",
      "",
      "endmodule",
    ],
    kind: CompletionItemKind.Module,
  },
  {
    label: "interface",
    detail: "Interface skeleton",
    body: [
      "interface $1_if #(parameter ${2:int} ${3:WIDTH} = ${4:32}) (",
      "\tinput wire ${5:clk}",
      ");",
      "",
      "\t$0",
      "",
      "endinterface",
    ],
    kind: CompletionItemKind.Interface,
  },
  {
    label: "package",
    detail: "Package skeleton",
    body: ["package $1_pkg;", "", "\t$0", "", "endpackage"],
    kind: CompletionItemKind.Module,
  },
  {
    label: "typedef_struct",
    detail: "Packed typedef struct",
    body: [
      "typedef struct packed {",
      "\tlogic [${1:7}:0] ${2:field};",
      "} ${3:my_struct};",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "typedef_enum",
    detail: "Typedef enum with explicit values",
    body: [
      "typedef enum logic [${1:1}:0] {",
      "\t${2:IDLE} = 2'b00,",
      "\t${3:RUN}  = 2'b01,",
      "\t${4:DONE} = 2'b10",
      "} ${5:my_enum};",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "function",
    detail: "Automatic function",
    body: [
      "function automatic ${1:logic} [${2:31}:0] ${3:my_func}(input logic [${2:31}:0] ${4:arg});",
      "\t$0",
      "endfunction",
    ],
    kind: CompletionItemKind.Function,
  },
  {
    label: "task",
    detail: "Automatic task",
    body: ["task automatic ${1:my_task}(input logic ${2:arg});", "\t$0", "endtask"],
    kind: CompletionItemKind.Function,
  },
  {
    label: "generate_for",
    detail: "Generate for loop",
    body: [
      "genvar ${1:i};",
      "generate",
      "\tfor (${1:i} = 0; ${1:i} < ${2:N}; ${1:i}++) begin : gen_$1",
      "\t\t$0",
      "\tend",
      "endgenerate",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "if_generate",
    detail: "Conditional generate",
    body: [
      "generate",
      "\tif (${1:COND}) begin : gen_$1",
      "\t\t$0",
      "\tend else begin : gen_else",
      "\tend",
      "endgenerate",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "assert_property",
    detail: "Immediate-style concurrent assertion property",
    body: [
      "property ${1:p_name};",
      "\t@(posedge ${2:clk}) ${3:expr} |-> ${4:expr2};",
      "endproperty",
      "assert property (${1:p_name}) else $error(\"${5:assertion failed}\");",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "sva_assert",
    detail: "Simple concurrent assertion",
    body: ["assert property (@(posedge ${1:clk}) ${2:expr} |=> ${3:expr2});"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "cover_property",
    detail: "Concurrent cover point",
    body: ["cover property (@(posedge ${1:clk}) ${2:expr});"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "immediate_assert",
    detail: "Immediate assertion",
    body: ["assert (${1:expr}) else $error(\"${2:message}\");"],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "covergroup",
    detail: "Functional coverage covergroup",
    body: [
      "covergroup ${1:cg}_cov @(posedge ${2:clk});",
      "\t${3:cp}: coverpoint ${4:expr} {",
      "\t\tbins low  = {0};",
      "\t\tbins high = {[1:$]};",
      "\t}",
      "endgroup",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "clocking_block",
    detail: "Clocking block for testbench synchronisation",
    body: [
      "clocking ${1:cb}_clk @(posedge ${2:clk});",
      "\tdefault input #1step output #1ns;",
      "\tinput ${3:signal};",
      "endclocking",
    ],
    kind: CompletionItemKind.Snippet,
  },
  {
    label: "class",
    detail: "Class skeleton",
    body: ["class ${1:my_class}${2: extends base};", "\t$0", "endclass"],
    kind: CompletionItemKind.Class,
  },
];

/**
 * Builds the static (non-contextual) portion of the completion list.
 *
 * Words appear in more than one group so the file stays readable, so the result
 * is deduplicated. Entries are added in priority order, highest first, because
 * some snippet labels coincide with keywords (`module`, `interface`, ...) and
 * the snippet is the more useful of the two.
 */
export function staticCompletionItems(options: {
  snippets: boolean;
  systemFunctions: boolean;
}): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  const push = (item: CompletionItem): void => {
    if (seen.has(item.label)) return;
    seen.add(item.label);
    items.push(item);
  };

  if (options.snippets) {
    for (const snippet of SNIPPETS) {
      push({
        label: snippet.label,
        kind: snippet.kind,
        detail: snippet.detail,
        insertText: Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body,
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: `5|${snippet.label}`,
      });
    }
  }

  if (options.systemFunctions) {
    for (const fn of SYSTEM_FUNCTIONS) {
      push({
        label: fn.name,
        kind: CompletionItemKind.Function,
        detail: fn.detail,
        sortText: `6|${fn.name}`,
      });
    }
  }

  for (const macro of DIRECTIVES) {
    push({
      label: macro,
      kind: CompletionItemKind.Constant,
      detail: "Compiler directive",
      sortText: `7|${macro}`,
    });
  }

  for (const group of KEYWORD_GROUPS) {
    for (const word of group.words) {
      push({ label: word, kind: group.kind, detail: "SystemVerilog keyword", sortText: `8|${word}` });
    }
  }

  return items;
}