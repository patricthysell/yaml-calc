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
  console.log("Recalculated files:", changed.map(f => path.relative(process.cwd(), f)));
  return engine;
}

(async () => {
  console.log(`Using pattern: ${options.pattern}`);
  const engine = await runOnce(options.pattern);
  if (!options.watch) return;

  console.log("Watching for changes…");
  const watcher = chokidar.watch(options.pattern, { ignoreInitial: true });
  watcher.on("add", async f => {
    await engine.reloadFile(path.resolve(f));
    await engine.recalcAll();
    console.log("Added:", f);
  });
  watcher.on("change", async f => {
    await engine.reloadFile(path.resolve(f));
    await engine.recalcAll();
    console.log("Changed:", f);
  });
  watcher.on("unlink", async f => {
    // simple: rerun fully (you can optimize later)
    console.log("Removed:", f);
    await runOnce(options.pattern);
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
