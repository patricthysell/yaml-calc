# YAML-Calc 🧮

A tiny, extensible YAML calculator.
Write calculations once in companion `_calc.yaml` files and let the engine emit clean value-only `.yaml` siblings. Cross-file references automatically propagate and stay in sync.

---

## Usage

Run once over all files:

```bash
npm start
```

Watch for changes:

```bash
npm run watch
```

By default the engine processes all `data/**/*_calc.yaml` files. For each calc file it overwrites the matching `.yaml` file (e.g. `order_calc.yaml` → `order.yaml`).

---

## Writing calculations

Place your formulas in keys that end with `_calc`. The expression is the raw JavaScript you want to evaluate – no wrapper function required.

```yaml
order:
  qty: 120
  unit_price_eur: 19.99

  revenue_eur_calc: order.qty * order.unit_price_eur
  revenue_dkk_calc: round(ref("./fx.yaml#/rates/EURDKK") * order.revenue_eur, 2)

summary:
  label: Order total (DKK)
  shown_value_calc: ref("#/order/revenue_dkk")
```

👉 When the engine runs it evaluates each `_calc` key (top-to-bottom, respecting dependencies) and writes the resulting value to the sibling key with the suffix removed (`revenue_eur`, `revenue_dkk`, `shown_value`, …) **in the generated output file only**.

---

## Referencing other fields

Inside a `_calc` expression you can mix normal identifiers with helper calls:

* **Same file** – reference previously declared values: `order.revenue_dkk_calc: round(order.revenue_eur * 7.46, 2)`
* **Dot paths** – `order.revenue_eur`
* **JSON Pointers** – `ref("#/order/qty")`
* **Cross-file** – `ref("./fx.yaml#/rates/EURDKK")`

Paths are resolved relative to the current calc file. When you reference a calculated value (either in the same file or another calc file) the engine automatically waits for the producing `_calc` field to finish before evaluating the dependent expression.

---

## Built-in helpers

Inside a `_calc` value you can use the following helpers in addition to normal JavaScript operators (`+ - * / % ? :`, etc.):

* `ref(path)` – Load a value by JSON Pointer, dot path, or cross-file path.
  * `ref("#/order/qty")`
  * `ref("order.qty")`
  * `ref("./fx.yaml#/rates/EURDKK")`
* `round(x, n = 0)` – Round `x` to `n` decimal places.
* `sum(array)` – Sum all numbers in an array.
* `min(a, b, …)`, `max(a, b, …)`

---

## Recalculation & dependencies

* The engine builds a **dependency graph** from your refs and identifiers.
* When a field changes (including in another file), all dependent expressions are re-evaluated automatically.
* Example: If `fx.yaml` changes its EURDKK rate, every dependent `revenue_dkk` in all files is recalculated on save.

---

## Example

**`fx_calc.yaml` ➡ `fx.yaml`**

```yaml
schemaVersion: 1
rates:
  EURDKK: 7.46
  USD_EUR: 0.92
```

**`order_calc.yaml` ➡ `order.yaml`**

```yaml
schemaVersion: 1
order:
  qty: 3
  price_eur: 100

  total_eur_calc: order.qty * order.price_eur
  total_dkk_calc: round(ref("./fx.yaml#/rates/EURDKK") * order.total_eur, 2)

summary:
  label: Order total (DKK)
  shown_value_calc: ref("#/order/total_dkk")
```

Running the engine produces:

```yaml
schemaVersion: 1
order:
  qty: 3
  price_eur: 100
  total_eur: 300
  total_dkk: 2238
summary:
  label: Order total (DKK)
  shown_value: 2238
```

---

## Notes

* All calculations live in `_calc` files; the generated `.yaml` output never contains formulas.
* Calc files are treated as the source of truth and are never modified by the engine.
* Cycles are detected and reported as errors.
* Plain fields (constants, strings, etc.) pass through untouched.
