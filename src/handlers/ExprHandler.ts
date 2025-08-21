import { TagHandler } from "../types";
import { evalExpr } from "./util/SimpleExpr";

export class ExprHandler implements TagHandler {
  readonly tag = "!expr";
  matches(node: any) {
    return (
      typeof node === "string" &&
      (
        node.startsWith("expr:") ||             // old style: "expr: a + b"
        /^expr?\s*\(/.test(node) ||             // new: expr(...) or exp(...)
        /^expr?\s*\[/.test(node)                // new: expr[...] or exp[...]
      )
    );
  }

  private getExpr(node: any): string {
    const s = String(node).trim();

    if (s.startsWith("expr:")) {
      return s.replace(/^expr:\s*/, "");
    }

    // Support exp(...) / expr(...) and exp[...] / expr[...]
    const paren = s.match(/^expr?\s*\((.*)\)\s*$/s);
    if (paren) return paren[1];

    const bracket = s.match(/^expr?\s*\[(.*)\]\s*$/s);
    if (bracket) return bracket[1];

    // Fallback (shouldn't happen if matches() is correct)
    return s;
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
    }
    const dotIdents = [...expr.matchAll(/\b([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)+)\b/g)];
    for (const d of dotIdents) {
      const ptr = "/" + d[1].split(".").join("/");
      deps.add(canonicalKey(file, ptr));
    }
    return [...deps];
  }
  evaluate({ node, file, ctx }: any) {
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
  targetValuePointer(fieldPointer: string) { return fieldPointer + "_value"; }
}
