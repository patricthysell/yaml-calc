import { HandlerRegistry } from "./engine/Registry";
import { Engine } from "./engine/Engine";
import { RefHandler } from "./handlers/RefHandler";
import { ExprHandler } from "./handlers/ExprHandler";
import { globby } from "globby";
import chokidar from "chokidar";
import path from "node:path";

const argv = new Set(process.argv.slice(2));
const WATCH = argv.has("--watch");

async function runOnce() {
  const registry = new HandlerRegistry();
  registry.register(new RefHandler());
  registry.register(new ExprHandler());

  const files = await globby(["data/**/*.yaml", "!**/node_modules/**"]);
  const engine = new Engine(registry);
  await engine.loadFiles(files);
  const changed = await engine.recalcAll();
  console.log("Recalculated files:", changed.map(f => path.relative(process.cwd(), f)));
  return engine;
}

(async () => {
  const engine = await runOnce();
  if (!WATCH) return;

  console.log("Watching for changes…");
  const watcher = chokidar.watch("data/**/*.yaml", { ignoreInitial: true });
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
    await runOnce();
  });
})().catch(err => {
  console.error(err);
  process.exit(1);
});
