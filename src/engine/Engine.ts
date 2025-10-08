import { HandlerRegistry } from "./Registry";
import { DepGraph } from "./Graph";
import { loadYaml, saveYaml } from "./IO";
import { getByPointer, setByPointer, canonicalKey, normalizeFile, dotToPointer } from "./Path";
import { TagHandler, EvalContext } from "../types";
import path from "node:path";
import fs from "node:fs/promises";

type Loaded = {
  calcFile: string;
  outputFile: string;
  root: any;
  mdTemplate?: string;
  mdOutput?: string;
};

export class Engine {
  private calcDocs = new Map<string, Loaded>();
  private outputDocs = new Map<string, Loaded>();
  private mdTemplates = new Map<string, Loaded>();
  constructor(private registry: HandlerRegistry) {}

  async loadFiles(files: string[]) {
    this.calcDocs.clear();
    this.outputDocs.clear();
    this.mdTemplates.clear();
    for (const f of files) {
      const doc = await loadYaml(f);
      const outputFile = normalizeFile(deriveOutputFile(doc.file));
      const loaded: Loaded = { calcFile: doc.file, outputFile, root: doc.root };
      this.calcDocs.set(doc.file, loaded);
      this.outputDocs.set(outputFile, loaded);
      await this.attachMarkdown(loaded);
    }
  }

  private ctx: EvalContext = {
    resolveValue: (key: string) => {
      const { file, pointer } = this.splitKey(key);
      const doc = this.getDoc(file);
      if (!doc) return undefined;
      return getByPointer(doc.root, pointer);
    },
    readRaw: (key: string) => {
      const { file, pointer } = this.splitKey(key);
      const doc = this.getDoc(file);
      return doc ? getByPointer(doc.root, pointer) : undefined;
    },
    readLocalByPointer: (file: string, pointer: string) => {
      const doc = this.getDoc(file);
      return doc ? getByPointer(doc.root, pointer) : undefined;
    },
    canonicalKey: (file: string, pointer: string) => canonicalKey(file, pointer),
    resolveFile: (fromFile: string, rel: string) => {
      if (!rel || rel === "." || rel === "./") return fromFile;
      const base = path.dirname(fromFile);
      return normalizeFile(path.resolve(base, rel));
    },
  };

  private splitKey(key: string) {
    const idx = key.indexOf("#");
    const file = key.slice(0, idx);
    const pointer = key.slice(idx + 1) || "/";
    return { file, pointer };
  }

  private buildGraph() {
    const graph = new DepGraph();
  const nodes: Record<string, { file: string; pointer: string; handler: TagHandler }> = {};
  for (const { calcFile: file, root } of this.calcDocs.values()) {
      const stack: { obj: any; pointer: string }[] = [{ obj: root, pointer: "/" }];
      while (stack.length) {
        const { obj, pointer } = stack.pop()!;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            const childPtr = pointer === "/" ? `/${k}` : `${pointer}/${k}`;
            const handler = this.registry.all().find(h => h.matches(v, childPtr));
            if (handler) {
              const nodeKey = canonicalKey(file, childPtr);
              nodes[nodeKey] = { file, pointer: childPtr, handler };
              graph.addNode(nodeKey);
              const deps = handler.collectDeps({
                node: v,
                file,
                pointer: childPtr,
                targetPointer: handler.targetPointer(childPtr),
                readLocalByPointer: this.ctx.readLocalByPointer,
                canonicalKey,
                resolveFile: this.ctx.resolveFile
              });
              for (const d of deps) graph.addDep(nodeKey, d);
            } else if (v && typeof v === "object") {
              stack.push({ obj: v, pointer: childPtr });
            }
          }
        }
      }
    }
    return { graph, nodes };
  }

  private async evaluateAndWrite(
    order: string[],
    nodes: Record<string, { file: string; pointer: string; handler: TagHandler }>
  ) {
    for (const key of order) {
      const entry = nodes[key];
      if (!entry) continue; // <-- skip deps that are not handler-backed nodes

      const { file, pointer, handler } = entry;
  const doc = this.calcDocs.get(file)!;
      const node = getByPointer(doc.root, pointer);
      const targetPointer = handler.targetPointer(pointer);
      const result = handler.evaluate({ node, file, pointer, targetPointer, ctx: this.ctx });
      const prev = getByPointer(doc.root, targetPointer);
      if (JSON.stringify(prev) !== JSON.stringify(result)) {
        setByPointer(doc.root, targetPointer, result);
      }
    }
  }
  
  async recalcAll(): Promise<string[]> {
    const { graph, nodes } = this.buildGraph();
    const order = graph.topoSort().reverse();
    await this.evaluateAndWrite(order, nodes);
    const changed: string[] = [];
    for (const doc of this.calcDocs.values()) {
      const materialized = materialize(doc.root);
      await saveYaml(doc.outputFile, materialized);
      changed.push(doc.outputFile);
      const mdOutput = await this.renderMarkdownForDoc(doc, materialized);
      if (mdOutput) changed.push(mdOutput);
    }
    return changed;
  }

  /** Reload a single file (e.g., on change) */
  async reloadFile(absPath: string) {
    const doc = await loadYaml(absPath);
    const outputFile = normalizeFile(deriveOutputFile(doc.file));
    const loaded: Loaded = { calcFile: doc.file, outputFile, root: doc.root };
    this.calcDocs.set(doc.file, loaded);
    this.outputDocs.set(outputFile, loaded);
    await this.attachMarkdown(loaded);
  }

  private getDoc(file: string): Loaded | undefined {
    return this.calcDocs.get(file) ?? this.outputDocs.get(file);
  }

  private async attachMarkdown(doc: Loaded) {
    const candidate = deriveMarkdownTemplate(doc.calcFile);
    if (doc.mdTemplate) {
      this.mdTemplates.delete(doc.mdTemplate);
    }
    if (await fileExists(candidate)) {
      const normalizedTemplate = normalizeFile(candidate);
      const output = normalizeFile(deriveOutputMarkdown(candidate));
      doc.mdTemplate = normalizedTemplate;
      doc.mdOutput = output;
      this.mdTemplates.set(normalizedTemplate, doc);
    } else if (doc.mdTemplate) {
      this.mdTemplates.delete(doc.mdTemplate);
      doc.mdTemplate = undefined;
      doc.mdOutput = undefined;
    }
  }

  async applyMarkdownTemplate(templatePath: string): Promise<string | undefined> {
    const normalized = normalizeFile(templatePath);
    const doc = this.findDocForTemplate(normalized);
    if (!doc) {
      console.warn(`No calc YAML loaded for markdown template: ${normalized}`);
      return undefined;
    }
    doc.mdTemplate = normalized;
    doc.mdOutput = normalizeFile(deriveOutputMarkdown(normalized));
    this.mdTemplates.set(normalized, doc);
    return this.renderMarkdownForDoc(doc);
  }

  async removeMarkdownTemplate(templatePath: string) {
    const normalized = normalizeFile(templatePath);
    const doc = this.findDocForTemplate(normalized);
    if (!doc) return;
    this.mdTemplates.delete(normalized);
    const output = doc.mdOutput;
    doc.mdTemplate = undefined;
    doc.mdOutput = undefined;
    if (output) {
      try {
        await fs.unlink(output);
      } catch (err: any) {
        if (err && err.code !== "ENOENT") throw err;
      }
    }
  }

  private findDocForTemplate(templatePath: string): Loaded | undefined {
    const normalized = normalizeFile(templatePath);
    const existing = this.mdTemplates.get(normalized);
    if (existing) return existing;
    for (const candidate of possibleCalcFilesFromTemplate(normalized)) {
      const doc = this.calcDocs.get(candidate);
      if (doc) return doc;
    }
    return undefined;
  }

  private async renderMarkdownForDoc(doc: Loaded, materialized?: any): Promise<string | undefined> {
    if (!doc.mdTemplate || !doc.mdOutput) return undefined;
    let template: string;
    try {
      template = await fs.readFile(doc.mdTemplate, "utf8");
    } catch (err) {
      throw new Error(`Failed to read markdown template ${doc.mdTemplate}: ${(err as Error).message}`);
    }
    const data = materialized ?? materialize(doc.root);
    const rendered = renderMarkdownTemplate(template, data, doc.mdTemplate);
    let existing: string | undefined;
    try {
      existing = await fs.readFile(doc.mdOutput, "utf8");
    } catch (err: any) {
      if (!err || err.code !== "ENOENT") throw err;
      existing = undefined;
    }
    if (existing !== undefined && existing === rendered) return undefined;
    await fs.writeFile(doc.mdOutput, rendered, "utf8");
    return doc.mdOutput;
  }
}

const deriveOutputFile = (calcFile: string) => {
  if (!calcFile.endsWith("_calc.yaml")) {
    throw new Error(`Expected calc file to end with _calc.yaml: ${calcFile}`);
  }
  return calcFile.replace(/_calc\.ya?ml$/i, ".yaml");
};

const materialize = (node: any): any => {
  if (Array.isArray(node)) return node.map(materialize);
  if (node && typeof node === "object") {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key.endsWith("_calc")) {
        const baseKey = key.slice(0, -5);
        if (Object.prototype.hasOwnProperty.call(node, baseKey)) {
          out[baseKey] = materialize(node[baseKey]);
        }
        continue;
      }
      out[key] = materialize(value);
    }
    return out;
  }
  return node;
};

const TABLE_DIRECTIVE_RE = /\{\{\s*table\s+([^}]+)\s*\}\}/gi;

function renderMarkdownTemplate(template: string, data: any, source: string): string {
  return template.replace(TABLE_DIRECTIVE_RE, (_match, attrString) => {
    try {
      return renderTableDirective(String(attrString), data, source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Error rendering table in ${source}: ${message}`);
    }
  });
}

function renderTableDirective(attrString: string, data: any, source: string): string {
  const attrs = parseAttributes(attrString);
  const pathAttr = attrs.path || attrs.Path;
  if (!pathAttr) {
    throw new Error("missing 'path' attribute");
  }
  const resolved = resolveDataPath(data, pathAttr);
  const mode = (attrs.mode || attrs.Mode || "auto").toLowerCase();

  if (mode === "kv") {
    return renderKeyValueTable(resolved, attrs);
  }

  if (Array.isArray(resolved)) {
    return renderArrayTable(resolved, attrs, source, pathAttr);
  }

  if (resolved && typeof resolved === "object") {
    return renderKeyValueTable(resolved, attrs);
  }

  if (mode === "rows") {
    return renderArrayTable(Array.isArray(resolved) ? resolved : [], attrs, source, pathAttr);
  }

  return renderKeyValueTable(resolved, attrs);
}

type AttributeMap = { [key: string]: string | undefined };
type ColumnSpec = { key: string; label: string };

function parseAttributes(input: string): AttributeMap {
  const attrs: AttributeMap = {};
  const regex = /(\w+)=("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input))) {
    const key = match[1];
    const raw = match[2];
    const value = raw.startsWith("\"")
      ? raw.slice(1, -1).replace(/\\"/g, '"')
      : raw.slice(1, -1).replace(/\\'/g, "'");
    attrs[key] = value;
  }
  return attrs;
}

function resolveDataPath(root: any, pathSpec: string) {
  if (!pathSpec || pathSpec === "/" || pathSpec === "#/") return root;
  if (pathSpec.startsWith("#/")) {
    return getByPointer(root, pathSpec.slice(1));
  }
  if (pathSpec.startsWith("/")) {
    return getByPointer(root, pathSpec);
  }
  return getByPointer(root, dotToPointer(pathSpec));
}

function renderArrayTable(rows: any[], attrs: AttributeMap, source: string, path: string): string {
  const safeRows = Array.isArray(rows) ? rows : [];
  const columns = determineColumns(safeRows, attrs.columns);
  if (!columns.length) {
    throw new Error(`no columns could be determined for path '${path}' in ${source}`);
  }

  const header = `| ${columns.map(c => escapeCell(c.label)).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = safeRows.map(row => {
    const cells = columns.map(col => escapeCell(formatValue(getColumnValue(row, col.key))));
    return `| ${cells.join(" | ")} |`;
  });

  return [header, separator, ...body].join("\n");
}

function determineColumns(rows: any[], columnsAttr?: string): ColumnSpec[] {
  if (columnsAttr && columnsAttr.trim().length) {
    return columnsAttr
      .split(",")
      .map(part => part.trim())
      .filter(Boolean)
      .map(spec => {
        const [keyPart, labelPart] = spec.split(":");
        const key = keyPart.trim();
        const label = (labelPart ?? keyPart).trim();
        return { key, label };
      });
  }

  const firstObject = rows.find(row => row && typeof row === "object" && !Array.isArray(row));
  let keys = firstObject ? Object.keys(firstObject) : [];
  for (const row of rows) {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      for (const key of Object.keys(row)) {
        if (!keys.includes(key)) keys.push(key);
      }
    }
  }
  if (!keys.length) {
    return [{ key: ".", label: "Value" }];
  }
  return keys.map(key => ({ key, label: key }));
}

function getColumnValue(row: any, key: string) {
  if (key === "." || key === "") return row;
  const segments = key.split(".").filter(Boolean);
  let current: any = row;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

function renderKeyValueTable(resolved: any, attrs: AttributeMap): string {
  const keyLabel = attrs.keyLabel || "Key";
  const valueLabel = attrs.valueLabel || "Value";
  let entries: [string, any][];
  if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
    entries = Object.entries(resolved);
  } else if (resolved === undefined) {
    entries = [];
  } else {
    entries = [["value", resolved]];
  }

  const header = `| ${escapeCell(keyLabel)} | ${escapeCell(valueLabel)} |`;
  const separator = "| --- | --- |";
  const body = entries.map(([key, value]) =>
    `| ${escapeCell(key)} | ${escapeCell(formatValue(value))} |`
  );
  return [header, separator, ...body].join("\n");
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br />");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const deriveMarkdownTemplate = (calcFile: string) =>
  calcFile.replace(/_calc\.ya?ml$/i, "_calc.md");

const deriveOutputMarkdown = (templateFile: string) =>
  templateFile.replace(/_calc\.md$/i, ".md");

const possibleCalcFilesFromTemplate = (templateFile: string): string[] => {
  const normalized = normalizeFile(templateFile);
  const candidates = [
    normalized.replace(/_calc\.md$/i, "_calc.yaml"),
    normalized.replace(/_calc\.md$/i, "_calc.yml")
  ];
  return Array.from(new Set(candidates));
};
