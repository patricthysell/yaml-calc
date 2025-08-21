import fs from "node:fs/promises";
import { parse, stringify } from "yaml";
import { getByPointer, setByPointer, normalizeFile } from "./Path";

export interface LoadedDoc {
  file: string;
  root: any;
  text: string;
}

function toPlain<T>(x: T): T {
  // Normalize YAML AST (e.g., maps) into plain JS objects
  return JSON.parse(JSON.stringify(x));
}

export async function loadYaml(absFile: string): Promise<LoadedDoc> {
  const text = await fs.readFile(absFile, "utf8");
  const ast = parse(text, { customTags: [] });
  const root = toPlain(ast);           // 👈 ensure enumerable keys
  const file = normalizeFile(absFile);          // 👈 ensure normalized key
  return { file, root, text };
}

export async function saveYaml(absFile: string, root: any) {
  const text = stringify(root, { indent: 2, lineWidth: 120 });
  await fs.writeFile(absFile, text, "utf8");
}

export const readByCanonical = (doc: LoadedDoc, pointer: string) =>
  getByPointer(doc.root, pointer);

export const writeByCanonical = (doc: LoadedDoc, pointer: string, value: any) =>
  setByPointer(doc.root, pointer, value);
