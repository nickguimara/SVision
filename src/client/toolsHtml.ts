import type { AccessKind, AccessSource, SignalAccess } from "../server/model.js";
import type { TraceHop } from "../server/trace.js";

/**
 * The tracer tree, kept free of the `vscode` module so it can be exercised by
 * unit tests. The tree view supplies the data.
 */

/**
 * One row of the tracer.
 *
 * A `hop` is a module the signal was followed into; `drivers` and `loads` group
 * the accesses of the hop under it; a `note` explains a limit or a miss. The
 * nesting is what separates drivers from loads visually -- they are different
 * collapsible groups rather than two lists of lines.
 */
export interface TraceNode {
  readonly kind: "hop" | "drivers" | "loads" | "access" | "note" | "elsewhere";
  readonly label: string;
  /** Short text shown greyed out to the right. */
  readonly description?: string;
  readonly icon: string;
  /** Colour id from the VS Code theme; resolved by the tree view. */
  readonly color?: string;
  /** Full text shown on hover, where the row is too narrow to be clear. */
  readonly tooltip?: string;
  /** Where clicking the row should jump, when there is somewhere to jump. */
  readonly target?: { uri: string; line: number; character: number };
  readonly children?: TraceNode[];
}

/** Builds the tracer tree for one trace. */
export function traceTree(hop: TraceHop): TraceNode[] {
  return [hopNode(hop, 0)];
}

function hopNode(hop: TraceHop, depth: number): TraceNode {
  const place = hop.instancePath.length > 0 ? ` in ${hop.instancePath.join(".")}` : "";
  const file = fileName(hop.uri);
  const where = depth === 0 ? `${hop.moduleName} · ${file}` : `${hop.moduleName}${place} · ${file}`;

  const children: TraceNode[] = [];

  if (hop.drivers.length > 0) {
    children.push({
      kind: "drivers",
      label: "Driven by",
      icon: "arrow-down",
      color: "charts.green",
      description: String(hop.drivers.length),
      children: hop.drivers.map((access) => accessNode(access, hop.uri, "drive")),
    });
  }

  if (hop.loads.length > 0) {
    children.push({
      kind: "loads",
      label: "Loaded by",
      icon: "arrow-right",
      color: "charts.blue",
      description: String(hop.loads.length),
      children: hop.loads.map((access) => accessNode(access, hop.uri, "load")),
    });
  }

  if (hop.drivers.length === 0 && hop.loads.length === 0) {
    children.push({
      kind: "note",
      label: "no access in this module",
      icon: "info",
      tooltip: `${hop.moduleName} neither reads nor writes ${hop.signal}.`,
    });
  }

  if (hop.truncated) {
    children.push({
      kind: "note",
      label: "trace stopped at the depth limit",
      icon: "warning",
      color: "charts.yellow",
      tooltip: "The design is deeper than the tracer walks by default.",
    });
  }

  // The root is about the file the user is looking at. Anything that lives in a
  // different file is collected under one heading, so a trace read from top to
  // bottom answers "here" first and "elsewhere" second -- rather than mixing
  // submodule hops in with the local drivers.
  const elsewhere = hop.children.filter((child) => child.uri !== hop.uri);
  const local = hop.children.filter((child) => child.uri === hop.uri);

  if (elsewhere.length > 0) {
    children.push({
      kind: "elsewhere",
      label: "In other files",
      icon: "arrow-down",
      color: "charts.purple",
      description: String(elsewhere.length),
      tooltip: "Everything the trace reached outside the file you are in.",
      children: elsewhere.map((child) => hopNode(child, depth + 1)),
    });
  }

  for (const child of local) children.push(hopNode(child, depth + 1));

  return {
    kind: "hop",
    label: hop.signal,
    description: where,
    icon: depth === 0 ? "symbol-variable" : hop.direction === "down" ? "arrow-down" : "arrow-up",
    color: depth === 0 ? "charts.yellow" : undefined,
    tooltip: `${hop.signal} in ${where}\nClick to open ${file}.`,
    // The hop names a module in another file, so it has somewhere to jump to.
    target: hop.uri
      ? { uri: hop.uri, line: hop.range?.start.line ?? 0, character: hop.range?.start.character ?? 0 }
      : undefined,
    children,
  };
}

/** File name of a uri, for a description that says where a row came from. */
function fileName(uri: string): string {
  const parts = uri.replace(/^[a-z]+:\/\//, "").split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Icon that tells the two apart at a glance.
 *
 * The colour deliberately comes from the group a row sits in, not from the
 * access: colouring a load green because it came from an `assign` would make
 * it look like a driver, which is the one distinction this view exists for.
 * `crossModule` is set only where the source is the interesting part.
 */
function accessStyle(source: AccessSource): { icon: string; crossModule: boolean } {
  switch (source) {
    case "continuous_assign":
      return { icon: "references", crossModule: false };
    case "procedural_assignment":
      return { icon: "symbol-event", crossModule: false };
    case "port_input":
    case "port_output":
      return { icon: "arrow-right", crossModule: false };
    case "instance_input":
    case "instance_output":
      return { icon: "type-hierarchy", crossModule: true };
  }
}

/** Human-readable name for where an access comes from. */
const SOURCE_LABEL: Record<AccessSource, string> = {
  continuous_assign: "assign",
  procedural_assignment: "always block",
  port_input: "input port",
  port_output: "output port",
  instance_input: "instance input",
  instance_output: "instance output",
};

function accessNode(access: SignalAccess, uri: string, kind: AccessKind): TraceNode {
  const { icon, crossModule } = accessStyle(access.source);
  const line = access.range.start.line + 1;

  return {
    kind: "access",
    label: access.detail,
    icon,
    // Green for a driver, blue for a load; a crossing keeps its own colour so
    // the boundary crossing is visible inside either group.
    color: crossModule ? "charts.purple" : kind === "drive" ? "charts.green" : "charts.blue",
    description: SOURCE_LABEL[access.source],
    tooltip: [
      `${kind === "drive" ? "drives" : "loads"} ${access.name}`,
      SOURCE_LABEL[access.source],
      uri ? `${shortPath(uri)}:${line}` : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    // A hop can carry no file, so the jump is only offered when there is one.
    target: uri
      ? { uri, line: access.range.start.line, character: access.range.start.character }
      : undefined,
  };
}

/** `file:///a/b/c.sv` reads better as `b/c.sv` next to the line number. */
function shortPath(uri: string): string {
  const withoutScheme = uri.replace(/^[a-z]+:\/\//, "");
  const parts = withoutScheme.split("/").filter(Boolean);
  return parts.length > 1 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : withoutScheme;
}

/** Placeholder shown when no signal is selected. */
export function emptyTrace(): TraceNode[] {
  return [
    {
      kind: "note",
      label: "No signal selected",
      icon: "info",
      tooltip: "Put the cursor on a signal, or click a net in the RTL viewer.",
    },
  ];
}

/** Placeholder shown when a signal was named but nothing declares it here. */
export function unknownSignal(signal: string): TraceNode[] {
  return [
    {
      kind: "note",
      label: `${signal} not found`,
      icon: "warning",
      color: "charts.yellow",
      tooltip: "No module in the workspace declares this signal.",
    },
  ];
}