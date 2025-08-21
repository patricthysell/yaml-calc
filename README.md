# YAML-Calc 🧮

A tiny, extensible YAML calculator.
Write formulas inline as `expr(...)` and let the engine keep `_value` siblings updated whenever you save files. Cross-file references automatically propagate.

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

By default the engine processes all `data/**/*.yaml`.

---

## Writing expressions

Any field can contain an expression using the `expr(...)` form:

```yaml
order:
  qty: 120
  unit_price_eur: 19.99

  revenue_eur: expr(order.qty * order.unit_price_eur)
  revenue_eur_value: 0

  revenue_dkk: expr(round(ref("./fx.yaml#/rates/EURDKK") * order.revenue_eur_value, 2))
  revenue_dkk_value: 0
```

👉 The calculator evaluates the expression and writes the result to the sibling with `_value` appended.

---

## Referencing other fields

### Same file

```yaml
foo: 10
bar: expr(foo * 2)   # refers to another field in this file
bar_value: 0
```

### By JSON Pointer

```yaml
bar: expr(ref("#/foo") * 2)
```

### By dot path

```yaml
bar: expr(foo * 2)
```

### Other file

```yaml
eur_to_dkk: expr(ref("./fx.yaml#/rates/EURDKK"))
eur_to_dkk_value: 0
```

Paths are resolved relative to the current file.

---

## Built-in helpers

Inside `expr(...)` you can use:

* `ref(path)`
  Get a value by JSON Pointer, dot path, or cross-file path.
  Examples:

  * `ref("#/order/qty")`
  * `ref("order.qty")`
  * `ref("./fx.yaml#/rates/EURDKK")`

* `round(x, n=0)`
  Round `x` to `n` decimal places.

* `sum(array)`
  Sum all numbers in an array.

* `min(a, b, ...)`, `max(a, b, ...)`

You can mix helpers with normal JS operators: `+ - * / % ? :`.

---

## Recalculation & dependencies

* The engine builds a **dependency graph** from your refs and identifiers.
* When a field changes (including in another file), all dependent expressions are re-evaluated automatically.
* Example: If `fx.yaml` changes its EURDKK rate, every dependent `revenue_dkk` in all files is recalculated on save.

---

## Example

**fx.yaml**

```yaml
rates:
  EURDKK: 7.46
```

**order.yaml**

```yaml
order:
  qty: 3
  price_eur: 100

  total_eur: expr(order.qty * order.price_eur)
  total_eur_value: 0

  total_dkk: expr(round(ref("./fx.yaml#/rates/EURDKK") * order.total_eur_value, 2))
  total_dkk_value: 0
```

After running the engine:

```yaml
order:
  qty: 3
  price_eur: 100
  total_eur: expr(order.qty * order.price_eur)
  total_eur_value: 300
  total_dkk: expr(round(ref("./fx.yaml#/rates/EURDKK") * order.total_eur_value, 2))
  total_dkk_value: 2238
```

---

## Notes

* Always put the formula in `expr(...)` and the result in the sibling with `_value`.
* Only the `_value` fields are overwritten; formulas remain untouched.
* Cycles are detected and reported as errors.
* Plain fields (constants, strings, etc.) are left alone.
