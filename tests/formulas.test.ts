import { test } from "node:test";
import assert from "node:assert/strict";
import {calendarTemplate} from "../shared/project-calendar.ts";
import {
  FormulaError,
  assertNoFormulaCycles,
  compileFormula,
  detectFormulaCycles,
  evaluateFormula,
  formulaDependencies,
  tryEvaluateFormula,
} from "../shared/formulas.ts";

function errorCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof FormulaError);
    assert.equal(error.code, code);
    assert.equal(typeof error.toJSON().message, "string");
    return true;
  });
}

test('date arithmetic adds civil days, keeps clock precision, and treats missing inputs as blank',()=>{
  assert.equal(evaluateFormula('DATEADD([start], [days])',{start:'2024-02-28',days:2}),'2024-03-01');
  assert.equal(evaluateFormula('[start]+[days]',{start:'2026-11-09T08:30:15.123456',days:'3'}),'2026-11-12T08:30:15.123456');
  assert.equal(evaluateFormula('[start]-[days]',{start:'2026-11-09',days:2}),'2026-11-07');
  assert.equal(evaluateFormula('DATEADD([start], [days])',{start:null,days:2}),null);
  errorCode(()=>evaluateFormula('DATEADD("2026-02-30", 1)'),'TYPE_MISMATCH');
  errorCode(()=>evaluateFormula('DATEADD("2026-11-09", 0.5)'),'TYPE_MISMATCH');
});

test('finish date counts the start and follows project holidays and replacement workdays',()=>{
  const calendar=calendarTemplate('five');
  const friday='2026-11-13';
  assert.equal(evaluateFormula('FINISHDATE([start],2)',{start:friday},{calendar}),'2026-11-16');
  calendar.exceptions['2026-11-16']=[];
  assert.equal(evaluateFormula('FINISHDATE([start],2)',{start:friday},{calendar}),'2026-11-17');
  calendar.exceptions['2026-11-14']=[['08:00','16:00']];
  assert.equal(evaluateFormula('FINISHDATE([start],2)',{start:friday},{calendar}),'2026-11-14');
  assert.equal(evaluateFormula('FINISHDATE([start],1)',{start:'2026-11-15'},{calendar}),'2026-11-17');
  assert.equal(evaluateFormula('[start]+2',{start:friday},{calendar}),'2026-11-17');
});

test("compiles an AST and reports stable, unique field dependencies", () => {
  const compiled = compileFormula("IF([active], [amount] * 2, [amount])", {
    fields: ["active", "amount"],
  });
  assert.equal(compiled.ast.type, "call");
  assert.deepEqual(compiled.dependencies, ["active", "amount"]);
  assert.deepEqual(formulaDependencies(compiled), ["active", "amount"]);
  errorCode(() => compileFormula("[missing] + 1", { fields: ["amount"] }), "UNKNOWN_FIELD");
});

test("performs decimal arithmetic without binary floating-point contamination", () => {
  assert.equal(evaluateFormula("0.1 + 0.2"), "0.3");
  assert.equal(evaluateFormula(".1 + .2"), "0.3");
  assert.equal(evaluateFormula("[large] + 0.02", { large: "99999999999999999.99" }), "100000000000000000.01");
  assert.equal(evaluateFormula("12.50 * 0.08"), "1");
  assert.equal(evaluateFormula("10 % 3"), "1");
  assert.equal(evaluateFormula("1 / 3", {}, { limits: { divisionScale: 6 } }), "0.333333");
  assert.equal(evaluateFormula("2 / 3", {}, { limits: { divisionScale: 6 } }), "0.666667");
  assert.equal(evaluateFormula("-5 / 2"), "-2.5");
});

test("numeric field strings stay exact and unsafe JavaScript numbers are rejected", () => {
  assert.equal(evaluateFormula("[value] * 2", {value:12.5}), "25");
  assert.equal(evaluateFormula("[a] + [b]", {a:0.1,b:0.2}), "0.3");
  assert.equal(evaluateFormula("[a] + [b]", { a: "0.10", b: "0.20" }), "0.3");
  assert.equal(evaluateFormula("[id] + 1", { id: 9007199254740993n }), "9007199254740994");
  errorCode(() => evaluateFormula("[id] + 1", { id: 9007199254740992 }), "NON_FINITE_VALUE");
  errorCode(() => evaluateFormula("[x] + 1", { x: Number.POSITIVE_INFINITY }), "NON_FINITE_VALUE");
});

test("supports comparisons, strict logic and lazy branches", () => {
  assert.equal(evaluateFormula("1.00 = 1 AND NOT false"), true);
  assert.equal(evaluateFormula("[name] = '项目甲'", { name: "项目甲" }), true);
  assert.equal(evaluateFormula("false AND (1 / 0 = 1)"), false);
  assert.equal(evaluateFormula("true OR (1 / 0 = 1)"), true);
  assert.equal(evaluateFormula("IF(true, 'safe', 1 / 0)"), "safe");
  assert.equal(evaluateFormula("COALESCE([empty], [value], 1 / 0)", { empty: null, value: "ok" }), "ok");
  errorCode(() => evaluateFormula("1 AND true"), "TYPE_MISMATCH");
});

test("implements aggregate, text and rounding functions with defined edge cases", () => {
  assert.equal(evaluateFormula("SUM(1, null, 2.5, 3.5)"), "7");
  assert.equal(evaluateFormula("AVG(1, 2, 2)"), "1.666666666666666667");
  assert.equal(evaluateFormula("MIN(4, -2, 9)"), "-2");
  assert.equal(evaluateFormula("MAX(4, -2, 9)"), "9");
  assert.equal(evaluateFormula("ROUND(12.345, 2)"), "12.35");
  assert.equal(evaluateFormula("ROUND(-15, -1)"), "-20");
  assert.equal(evaluateFormula("ABS(-12.30)"), "12.3");
  assert.equal(evaluateFormula("CONCAT('工', '程', 12, true, null)"), "工程12true");
  assert.equal(evaluateFormula("LEN('项目😀')"), "3");
  assert.equal(evaluateFormula("SUM(null)"), "0");
  errorCode(() => evaluateFormula("AVG(null)"), "OPERAND_LIMIT");
});

test("returns structured errors for parse and evaluation failures", () => {
  const result = tryEvaluateFormula("[amount] / 0", { amount: "10.00" });
  assert.deepEqual(result, {
    ok: false,
    error: {
      name: "FormulaError",
      code: "DIVIDE_BY_ZERO",
      message: "不能除以零",
      position: 9,
    },
  });
  errorCode(() => evaluateFormula("[unknown]", {}), "UNKNOWN_FIELD");
  errorCode(() => compileFormula("EXEC('bad')"), "UNKNOWN_FUNCTION");
  errorCode(() => compileFormula("'unterminated"), "INVALID_STRING");
  errorCode(() => compileFormula("1 +"), "UNEXPECTED_TOKEN");
  errorCode(() => evaluateFormula("1 / 0"), "DIVIDE_BY_ZERO");
});

test("rejects code-shaped and prototype-shaped malicious expressions", () => {
  for (const expression of [
    "globalThis.process.exit()",
    "(()=>1)()",
    "this.constructor.constructor('return process')()",
    "[x]; process.exit()",
    "SUM(...[1,2])",
    "`template`",
  ]) assert.throws(() => compileFormula(expression), FormulaError);
  errorCode(
    () => evaluateFormula("[__proto__]", { __proto__: "inherited" }),
    "UNKNOWN_FIELD",
  );
});

test("enforces expression, depth, node, operand, operation and result limits", () => {
  errorCode(() => compileFormula("1 + 2", { limits: { maxExpressionLength: 3 } }), "EXPRESSION_TOO_LONG");
  errorCode(() => compileFormula("((((1))))", { limits: { maxDepth: 3 } }), "DEPTH_LIMIT");
  errorCode(() => compileFormula("1 + 2 + 3 + 4", { limits: { maxDepth: 3 } }), "DEPTH_LIMIT");
  errorCode(() => compileFormula("1 + 2 + 3", { limits: { maxNodes: 4 } }), "NODE_LIMIT");
  errorCode(() => compileFormula("SUM(1,2,3)", { limits: { maxOperands: 2 } }), "OPERAND_LIMIT");
  errorCode(() => evaluateFormula("1 + 2 + 3", {}, { limits: { maxOperations: 3 } }), "OPERATION_LIMIT");
  errorCode(() => evaluateFormula("CONCAT('123', '456')", {}, { limits: { maxResultLength: 5 } }), "RESULT_TOO_LONG");
  errorCode(() => evaluateFormula("99999 * 99999", {}, { limits: { maxNumericDigits: 5 } }), "NUMERIC_RANGE");
});

test("detects self cycles and multi-field cycles while ignoring external leaves", () => {
  const formulas = {
    subtotal: "[price] * [quantity]",
    tax: "[subtotal] * 0.1",
    total: "[subtotal] + [tax] + [external_discount]",
  };
  assert.deepEqual(detectFormulaCycles(formulas), []);
  const cyclic = {
    a: "[b] + 1",
    b: "[c] + 1",
    c: "[a] + 1",
    self: "[self]",
  };
  assert.deepEqual(detectFormulaCycles(cyclic), [
    ["a", "b", "c", "a"],
    ["self", "self"],
  ]);
  errorCode(() => assertNoFormulaCycles(cyclic), "CIRCULAR_DEPENDENCY");
});
