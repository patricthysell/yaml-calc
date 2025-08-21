import path from "node:path";

export const normalizeFile = (p: string) => {
  const abs = path.resolve(p);
  let norm = path.normalize(abs);
  // Windows: force drive letter to lowercase so C:\ == c:\
  if (process.platform === "win32") {
    norm = norm.replace(/^[A-Z]:/, m => m.toLowerCase());
  }
  return norm;
};

export const canonicalKey = (absFile: string, pointer: string) =>
  `${normalizeFile(absFile)}#${pointer || "/"}`;

export const getByPointer = (root: any, pointer: string): any => {
  const normalized = pointer && pointer !== "#" ? pointer : "/";
  const parts = normalized.replace(/^#?\/?/, "").split("/").filter(Boolean).map(unescapePart);
  let cur = root;
  if (parts.length === 0) return cur;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
};

export const setByPointer = (root: any, pointer: string, value: any) => {
  const parts = pointer.replace(/^#?\/?/, "").split("/").filter(Boolean).map(unescapePart);
  if (!parts.length) throw new Error("Cannot set root via empty pointer");
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
};

const unescapePart = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");
const escapePart = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");

export const dotToPointer = (dot: string) =>
  "/" + dot.split(".").map(escapePart).join("/");
