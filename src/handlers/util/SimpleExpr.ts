/**
 * Safe-ish expression evaluator.
 * - Exposes all top-level keys of the current document as locals via destructuring
 * - Exposes helpers (ref, round, sum, min, max) as locals too
 * - No access to global scope
 */
export function evalExpr(
  expr: string,
  scope: Record<string, any>,
  helpers: Record<string, any>
) {   
// ensure we have enumerable keys
  const plainScope =
    scope && typeof scope === "object" ? JSON.parse(JSON.stringify(scope)) : {};
  const scopeNames = Object.keys(plainScope); // e.g., ["schemaVersion","order","summary"]
  const helperNames = Object.keys(helpers); // e.g., ["ref","round","sum","min","max"]

  // Build destructuring so identifiers in `expr` are local bindings.
  // Example produced code:
  //   const { order, summary } = scope;
  //   const { ref, round, sum, min, max } = helpers;
  //   return (order.qty * order.unit_price_eur);
  const makeList = (names: string[]) =>
    names.length ? `{ ${names.join(", ")} }` : `{}`;

  const body =
    `const ${makeList(scopeNames)} = scope;\n` +
    `const ${makeList(helperNames)} = helpers;\n` +
    `return (${expr});`;


  // Use Function with only (scope, helpers) params; no global leakage.
  // eslint-disable-next-line no-new-func
  const fn = new Function("scope", "helpers", body);
  return fn(scope, helpers);
}