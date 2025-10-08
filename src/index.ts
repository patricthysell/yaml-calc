import { HandlerRegistry } from "./engine/Registry";
import { Engine } from "./engine/Engine";
import { RefHandler } from "./handlers/RefHandler";
import { CalcHandler } from "./handlers/CalcHandler";
import { globby } from "globby";
import chokidar from "chokidar";
import path from "node:path";

const DEFAULT_PATTERN = "data/**/*_calc.yaml";

type CliOptions = {
  watch: boolean;
  pattern: string;
};

function parseArgs(argv: string[]): CliOptions {
  let watch = false;
  let pattern: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--watch") {
      watch = true;
      continue;
    }
    if (arg.startsWith("--pattern=")) {
      pattern = arg.slice("--pattern=".length).trim();
      continue;
    }
    if (arg === "--pattern") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--pattern requires a value");
      }
      pattern = next.trim();
      i++;
      continue;
    }
  }

  return {
    watch,
    pattern: pattern && pattern.length > 0 ? pattern : DEFAULT_PATTERN
  };
}

const options = parseArgs(process.argv.slice(2));

function computeWatchPatterns(pattern: string): string[] {
  const patterns = new Set<string>([pattern]);
  const mdVariant = deriveMarkdownPattern(pattern);
  if (mdVariant) patterns.add(mdVariant);
  return Array.from(patterns);
}

function deriveMarkdownPattern(pattern: string): string | null {
  if (/_calc\.ya?ml/i.test(pattern)) {
    return pattern.replace(/_calc\.ya?ml/gi, "_calc.md");
  }
  if (/\.ya?ml/i.test(pattern)) {
    return pattern.replace(/\.ya?ml/gi, ".md");
  }
  return null;
}

function logChangedFiles(prefix: string, files: string[]) {
  if (!files.length) {
    console.log(`${prefix}: (no changes)`);
    return;
  }
  const rel = files.map(f => path.relative(process.cwd(), f));
  console.log(`${prefix}:`, rel);
}

async function runOnce(pattern: string) {
  const registry = new HandlerRegistry();
  registry.register(new RefHandler());
  registry.register(new CalcHandler());

  const files = await globby([pattern]);
  if (files.length === 0) {
    console.warn(`No calc files matched pattern: ${pattern}`);
  }
  const engine = new Engine(registry);
  await engine.loadFiles(files);
  const changed = await engine.recalcAll();
  logChangedFiles("Recalculated files", changed);
  return engine;
}

(async () => {
  console.log(`Using pattern: ${options.pattern}`);
  let engine = await runOnce(options.pattern);
  if (!options.watch) return;

  console.log("Watching for changes…");
  const watchPatterns = computeWatchPatterns(options.pattern);
  const watcher = chokidar.watch(watchPatterns, { ignoreInitial: true });
  watcher.on("add", async f => {
    const abs = path.resolve(f);
    if (abs.match(/_calc\.md$/i)) {
      const output = await engine.applyMarkdownTemplate(abs);
      logChangedFiles("Rendered markdown", output ? [output] : []);
      return;
    }
    await engine.reloadFile(abs);
    const changed = await engine.recalcAll();
    logChangedFiles("Recalculated files", changed);
    console.log("Added:", f);
  });
  watcher.on("change", async f => {
    const abs = path.resolve(f);
    if (abs.match(/_calc\.md$/i)) {
      const output = await engine.applyMarkdownTemplate(abs);
      logChangedFiles("Rendered markdown", output ? [output] : []);
      return;
    }
    await engine.reloadFile(abs);
    const changed = await engine.recalcAll();
    logChangedFiles("Recalculated files", changed);
    console.log("Changed:", f);
  });
  watcher.on("unlink", async f => {
    const abs = path.resolve(f);
    if (abs.match(/_calc\.md$/i)) {
      await engine.removeMarkdownTemplate(abs);
      console.log("Removed markdown template:", f);
      return;
    }
    console.log("Removed:", f);
    engine = await runOnce(options.pattern);
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
