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
  const orderCalcMd = path.join(tempDir, "order_calc.md");
  const fxOut = path.join(tempDir, "fx.yaml");
  const orderOut = path.join(tempDir, "order.yaml");
  const orderMd = path.join(tempDir, "order.md");

  await writeYaml(
    fxCalc,
    `schemaVersion: 1\nrates:\n  EURDKK: 7.46\n  USD_EUR: 0.92\n`
  );

  await writeYaml(
    orderCalc,
    `schemaVersion: 1\norder:\n  items:\n    - sku: A-1\n      qty: 1\n      unit_price_eur: 80\n    - sku: B-2\n      qty: 2\n      unit_price_eur: 110\n  total_eur_calc: sum(order.items.map(item => round(item.qty * item.unit_price_eur, 2)))\n  total_dkk_calc: round(ref("./fx.yaml#/rates/EURDKK") * order.total_eur, 2)\nsummary:\n  label: Order total (DKK)\n  shown_value_calc: ref("#/order/total_dkk")\n`
  );

  await fs.writeFile(
    orderCalcMd,
    `# Order Summary\n\n## Line Items\n\n{{table path="order.items" columns="sku:SKU,qty:Quantity,unit_price_eur:Unit Price (€)"}}\n\n## Totals\n\n{{table path="summary" mode="kv" keyLabel="Field" valueLabel="Value"}}\n`,
    "utf8"
  );

  const engine = createEngine();
  await engine.loadFiles([fxCalc, orderCalc]);
  const changed = await engine.recalcAll();

  const expected = new Set([normalizeFile(fxOut), normalizeFile(orderOut), normalizeFile(orderMd)]);
  const actual = new Set(changed);
  assert.deepEqual(actual, expected);

  const orderRaw = await fs.readFile(orderOut, "utf8");
  const orderDoc = parse(orderRaw);
  assert.equal(orderDoc.order.total_eur, 300);
  assert.equal(orderDoc.order.total_dkk, 2238);
  assert.deepEqual(orderDoc.order.items, [
    { sku: "A-1", qty: 1, unit_price_eur: 80 },
    { sku: "B-2", qty: 2, unit_price_eur: 110 }
  ]);

  const originalCalc = await fs.readFile(orderCalc, "utf8");
  assert.match(originalCalc, /total_eur_calc:/);
  assert.doesNotMatch(originalCalc, /total_eur:\s*300/);

  const orderMarkdown = (await fs.readFile(orderMd, "utf8")).replace(/\r\n/g, "\n");
  const expectedMarkdown = [
    "# Order Summary",
    "",
    "## Line Items",
    "",
    "| SKU | Quantity | Unit Price (€) |",
    "| --- | --- | --- |",
    "| A-1 | 1 | 80 |",
    "| B-2 | 2 | 110 |",
    "",
    "## Totals",
    "",
    "| Field | Value |",
    "| --- | --- |",
    "| label | Order total (DKK) |",
    "| shown_value | 2238 |"
  ].join("\n");
  assert.equal(orderMarkdown.trim(), expectedMarkdown.trim());

  await fs.rm(tempDir, { recursive: true, force: true });
});
