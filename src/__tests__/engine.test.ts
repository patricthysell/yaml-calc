import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { HandlerRegistry } from "../engine/Registry";
import { Engine } from "../engine/Engine";
import { RefHandler } from "../handlers/RefHandler";
import { CalcHandler } from "../handlers/CalcHandler";
import { normalizeFile } from "../engine/Path";
import { parse } from "yaml";

const writeYaml = (file: string, text: string) => fs.writeFile(file, text, "utf8");

const createEngine = () => {
  const registry = new HandlerRegistry();
  registry.register(new RefHandler());
  registry.register(new CalcHandler());
  return new Engine(registry);
};

test("produces value-only yaml from calc sources", async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "yaml-calc-"));
  const fxCalc = path.join(tempDir, "fx_calc.yaml");
  const orderCalc = path.join(tempDir, "order_calc.yaml");
  const fxOut = path.join(tempDir, "fx.yaml");
  const orderOut = path.join(tempDir, "order.yaml");

  await writeYaml(
    fxCalc,
    `schemaVersion: 1\nrates:\n  EURDKK: 7.46\n  USD_EUR: 0.92\n`
  );

  await writeYaml(
    orderCalc,
    `schemaVersion: 1\norder:\n  qty: 3\n  price_eur: 100\n  total_eur_calc: order.qty * order.price_eur\n  total_dkk_calc: round(ref("./fx.yaml#/rates/EURDKK") * order.total_eur, 2)\n`
  );

  const engine = createEngine();
  await engine.loadFiles([fxCalc, orderCalc]);
  const changed = await engine.recalcAll();

  const expected = new Set([normalizeFile(fxOut), normalizeFile(orderOut)]);
  const actual = new Set(changed);
  assert.deepEqual(actual, expected);

  const orderRaw = await fs.readFile(orderOut, "utf8");
  const orderDoc = parse(orderRaw);
  assert.equal(orderDoc.order.total_eur, 300);
  assert.equal(orderDoc.order.total_dkk, 2238);

  const originalCalc = await fs.readFile(orderCalc, "utf8");
  assert.match(originalCalc, /total_eur_calc:\s*order.qty \* order.price_eur/);
  assert.doesNotMatch(originalCalc, /total_eur:\s*300/);

  await fs.rm(tempDir, { recursive: true, force: true });
});
