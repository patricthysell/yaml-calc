import { TagHandler } from "../types";
import { evalExpr } from "./util/SimpleExpr";

const trimCalcSuffix = (segment: string) =>
  segment.endsWith("_calc") ? segment.slice(0, -5) : segment;

export class CalcHandler implements TagHandler {
  readonly tag = "calc";

  matches(node: any, pointer: string) {
    const last = pointer.split("/").pop() ?? "";
    return typeof node === "string" && last.endsWith("_calc");
  }

  targetPointer(fieldPointer: string) {
    const parts = fieldPointer.replace(/^#?\/?/, "").split("/");
    if (!parts.length) throw new Error("Cannot derive target pointer for root");
    parts[parts.length - 1] = trimCalcSuffix(parts[parts.length - 1]);
    return "/" + parts.join("/");
  }

  private getExpr(node: any): string {
    return String(node).trim();
  }

  private toCalcPointer(ptr: string) {
    if (!ptr || ptr === "/") return ptr;
    const parts = ptr.split("/");
    const last = parts[parts.length - 1];
    if (!last) return ptr;
    if (last.endsWith("_calc")) return ptr;
    parts[parts.length - 1] = `${last}_calc`;
    return parts.join("/");
  }

  collectDeps({ node, file, canonicalKey, resolveFile }: any): string[] {
    const expr = this.getExpr(node);
    const deps = new Set<string>();
    const refPattern = /ref\(\s*(['"])(.*?)\1\s*\)/g;
    for (const m of expr.matchAll(refPattern)) {
      const s = m[2];
      let tgtFile = file;
      let ptr = s;
      if (s.includes("#")) {
        const [f, p] = s.split("#");
        tgtFile = resolveFile(file, f || ".");
        ptr = p.startsWith("/") ? p : "/" + p;
      }
      if (ptr.startsWith("#")) ptr = ptr.slice(1);
      deps.add(canonicalKey(tgtFile, ptr));
      const calcPtr = this.toCalcPointer(ptr);
      if (calcPtr !== ptr) deps.add(canonicalKey(tgtFile, calcPtr));
    }
    const dotIdents = [...expr.matchAll(/\b([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+)\b/g)];
    for (const d of dotIdents) {
      const ptr = "/" + d[1].split(".").join("/");
      deps.add(canonicalKey(file, ptr));
      const calcPtr = this.toCalcPointer(ptr);
      if (calcPtr !== ptr) deps.add(canonicalKey(file, calcPtr));
    }
    return [...deps];
  }

  evaluate({ node, file, ctx, targetPointer }: any) {
    const expr = this.getExpr(node);
    const helpers = {
      ref: (s: string) => {
        let tgtFile = file;
        let ptr = s;
        if (s.includes("#")) {
          const [f, p] = s.split("#");
          tgtFile = ctx.resolveFile(file, f || ".");
          ptr = p.startsWith("/") ? p : "/" + p;
        }
        if (ptr.startsWith("#")) ptr = ptr.slice(1);
        return ctx.resolveValue(ctx.canonicalKey(tgtFile, ptr));
      },
      round: (x: number, n = 0) => {
        const k = Math.pow(10, n);
        return Math.round((x + Number.EPSILON) * k) / k;
      },
      sum: (arr: number[]) => arr.reduce((a, b) => a + b, 0),
      min: Math.min,
      max: Math.max
    };
    const scope = ctx.readRaw(ctx.canonicalKey(file, "/")) || {};
    const retval = evalExpr(expr.replace(/^\s+|\s+$/g, ""), scope, helpers);
    return retval;
  }
}
