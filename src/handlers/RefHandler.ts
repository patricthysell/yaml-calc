import { TagHandler } from "../types";
import { dotToPointer } from "../engine/Path";

export class RefHandler implements TagHandler {
  readonly tag = "!ref";

  matches(node: any, _pointer: string) {
    return typeof node === "string" && node.startsWith("ref:");
  }

  private parseRef(node: any): { file?: string; pointer: string } {
    const s = String(node).replace(/^ref:\s*/, "");
    if (s.includes("#")) {
      const [file, ptr] = s.split("#");
      return { file: file || undefined, pointer: ptr.startsWith("/") ? ptr : "/" + ptr };
    }
    if (s.startsWith("#/")) return { pointer: s.replace(/^#/, "") };
    if (s.startsWith("/")) return { pointer: s };
    return { pointer: dotToPointer(s) };
  }

  targetPointer(fieldPointer: string) {
    const parts = fieldPointer.replace(/^#?\/?/, "").split("/");
    if (!parts.length) throw new Error("Cannot derive target pointer for root");
    const last = parts[parts.length - 1];
    if (last.endsWith("_calc")) {
      parts[parts.length - 1] = last.slice(0, -5);
    }
    return "/" + parts.join("/");
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
    const ref = this.parseRef(node);
    const targetFile = ref.file ? resolveFile(file, ref.file) : file;
    const deps = new Set<string>();
    deps.add(canonicalKey(targetFile, ref.pointer));
    const calcPtr = this.toCalcPointer(ref.pointer);
    if (calcPtr !== ref.pointer) deps.add(canonicalKey(targetFile, calcPtr));
    return [...deps];
  }

  evaluate({ node, file, ctx, pointer, targetPointer }: any) {
    if (node == null) return node;
    const ref = this.parseRef(node);
    const targetFile = ref.file ? ctx.resolveFile(file, ref.file) : file;
    const resolved = ctx.resolveValue(ctx.canonicalKey(targetFile, ref.pointer));
    return resolved;
  }
}
