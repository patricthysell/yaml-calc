import { TagHandler } from "../types";
import { dotToPointer } from "../engine/Path";

export class RefHandler implements TagHandler {
  readonly tag = "!ref";
  matches(node: any) {
    return typeof node === "string" && node.startsWith("ref:");
  }
  private parseRef(node: any): { file?: string; pointer: string } {
    const s = String(node).replace(/^ref:\s*/, "");
    if (s.includes("#")) {
      const [file, ptr] = s.split("#");
      return { file: file || undefined, pointer: ptr.startsWith("/") ? ptr : "/" + ptr };
    }
    if (s.startsWith("#/") || s.startsWith("/")) return { pointer: s.replace(/^#/, "") };
    return { pointer: dotToPointer(s) };
  }
  collectDeps({ node, file, canonicalKey, resolveFile }: any): string[] {
    const ref = this.parseRef(node);
    const targetFile = ref.file ? resolveFile(file, ref.file) : file;
    return [canonicalKey(targetFile, ref.pointer)];
  }
  evaluate({ node, file, ctx }: any) {
    const ref = this.parseRef(node);
    const targetFile = ref.file ? ctx.resolveFile(file, ref.file) : file;
    return ctx.resolveValue(ctx.canonicalKey(targetFile, ref.pointer));
  }
  targetValuePointer(fieldPointer: string) { return fieldPointer + "_value"; }
}
