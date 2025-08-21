import { HandlerRegistry } from "./Registry";
import { DepGraph } from "./Graph";
import { loadYaml, saveYaml } from "./IO";
import { getByPointer, setByPointer, canonicalKey, normalizeFile } from "./Path";
import { TagHandler, EvalContext } from "../types";
import path, { normalize } from "node:path";

type Loaded = { file: string; root: any };

export class Engine {
  private docs = new Map<string, Loaded>();
  constructor(private registry: HandlerRegistry) {}

  async loadFiles(files: string[]) {
    for (const f of files) {
      const doc = await loadYaml(f);
      this.docs.set(doc.file, { file: doc.file, root: doc.root });
    }
  }

  private ctx: EvalContext = {
    resolveValue: (key: string) => {
      const { file, pointer } = this.splitKey(key);
      const doc = this.docs.get(file);
      if (!doc) return undefined;
      const val = getByPointer(doc.root, pointer + "_value");
      if (val !== undefined) return val;
      return getByPointer(doc.root, pointer);
    },
    readRaw: (key: string) => {
      const { file, pointer } = this.splitKey(key);
      const doc = this.docs.get(file);
      return doc ? getByPointer(doc.root, pointer) : undefined;
    },
    readLocalByPointer: (file: string, pointer: string) => {
      const doc = this.docs.get(file);
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
    for (const { file, root } of this.docs.values()) {
      const stack: { obj: any; pointer: string }[] = [{ obj: root, pointer: "/" }];
      while (stack.length) {
        const { obj, pointer } = stack.pop()!;
        if (obj && typeof obj === "object") {
          for (const [k, v] of Object.entries(obj)) {
            const childPtr = pointer === "/" ? `/${k}` : `${pointer}/${k}`;
            const handler = this.registry.all().find(h => h.matches(v));
            if (handler) {
              const nodeKey = canonicalKey(file, childPtr);
              nodes[nodeKey] = { file, pointer: childPtr, handler };
              graph.addNode(nodeKey);
              const deps = handler.collectDeps({
                node: v,
                file,
                pointer: childPtr,
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
      const doc = this.docs.get(file)!;
      const node = getByPointer(doc.root, pointer);
      const result = handler.evaluate({ node, file, pointer, ctx: this.ctx });
      const outPtr = handler.targetValuePointer(pointer);
      const prev = getByPointer(doc.root, outPtr);
      if (JSON.stringify(prev) !== JSON.stringify(result)) {
        setByPointer(doc.root, outPtr, result);
      }
    }
  }
  
  async recalcAll(): Promise<string[]> {
    const { graph, nodes } = this.buildGraph();
    const order = graph.topoSort();
    await this.evaluateAndWrite(order, nodes);
    const changed: string[] = [];
    for (const { file, root } of this.docs.values()) {
      await saveYaml(file, root);
      changed.push(file);
    }
    return changed;
  }

  /** Reload a single file (e.g., on change) */
  async reloadFile(absPath: string) {
    const doc = await loadYaml(absPath);
    this.docs.set(doc.file, { file: doc.file, root: doc.root });
  }
}
