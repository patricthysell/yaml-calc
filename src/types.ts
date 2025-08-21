export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface DocContext {
  file: string;
  root: any;
}

export interface EvalContext {
  resolveValue: (canonicalKey: string) => any;
  readRaw: (canonicalKey: string) => any;
  readLocalByPointer: (file: string, pointer: string) => any;
  canonicalKey: (file: string, pointer: string) => string;
  resolveFile: (fromFile: string, relativeOrAbs: string) => string;
}

export interface TagHandler {
  readonly tag: string;
  matches(node: any): boolean;
  collectDeps(args: {
    node: any;
    file: string;
    pointer: string;
    readLocalByPointer: EvalContext["readLocalByPointer"];
    canonicalKey: EvalContext["canonicalKey"];
    resolveFile: EvalContext["resolveFile"];
  }): string[];
  evaluate(args: {
    node: any;
    file: string;
    pointer: string;
    ctx: EvalContext;
  }): any;
  targetValuePointer(fieldPointer: string): string;
}
