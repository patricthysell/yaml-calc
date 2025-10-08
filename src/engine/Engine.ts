import { HandlerRegistry } from "./Registry";
import { DepGraph } from "./Graph";
import { loadYaml, saveYaml } from "./IO";
import { getByPointer, setByPointer, canonicalKey, normalizeFile } from "./Path";
import { TagHandler, EvalContext } from "../types";
import path from "node:path";

type Loaded = { calcFile: string; outputFile: string; root: any };

export class Engine {
  private calcDocs = new Map<string, Loaded>();
  private outputDocs = new Map<string, Loaded>();
  constructor(private registry: HandlerRegistry) {}

  async loadFiles(files: string[]) {
    this.calcDocs.clear();
    this.outputDocs.clear();
    for (const f of files) {
      const doc = await loadYaml(f);
      const outputFile = normalizeFile(deriveOutputFile(doc.file));
      const loaded: Loaded = { calcFile: doc.file, outputFile, root: doc.root };
      this.calcDocs.set(doc.file, loaded);
      this.outputDocs.set(outputFile, loaded);
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
    for (const { outputFile, root } of this.calcDocs.values()) {
      const materialized = materialize(root);
      await saveYaml(outputFile, materialized);
      changed.push(outputFile);
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
  }

  private getDoc(file: string): Loaded | undefined {
    return this.calcDocs.get(file) ?? this.outputDocs.get(file);
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
