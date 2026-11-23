import { decimalParts, fixedDecimal,validateValue } from "./fields.ts";
import {calendarPeriods,defaultProjectCalendar,type ProjectCalendar} from "./project-calendar.ts";

export type FormulaValue = string | boolean | null;
export type FormulaInput = FormulaValue | number | bigint | undefined;

export type FormulaErrorCode =
  | "EMPTY_EXPRESSION"
  | "EXPRESSION_TOO_LONG"
  | "INVALID_TOKEN"
  | "INVALID_NUMBER"
  | "INVALID_STRING"
  | "INVALID_FIELD"
  | "UNKNOWN_FIELD"
  | "UNKNOWN_FUNCTION"
  | "UNEXPECTED_TOKEN"
  | "DEPTH_LIMIT"
  | "NODE_LIMIT"
  | "OPERAND_LIMIT"
  | "TYPE_MISMATCH"
  | "DIVIDE_BY_ZERO"
  | "NON_FINITE_VALUE"
  | "NUMERIC_RANGE"
  | "RESULT_TOO_LONG"
  | "OPERATION_LIMIT"
  | "CIRCULAR_DEPENDENCY";

export class FormulaError extends Error {
  readonly name = "FormulaError";
  constructor(
    public readonly code: FormulaErrorCode,
    message: string,
    public readonly position?: number,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.position === undefined ? {} : { position: this.position }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export type FormulaAst =
  | { type: "literal"; value: FormulaValue; valueType: "number" | "string" | "boolean" | "null"; position: number }
  | { type: "field"; id: string; position: number }
  | { type: "unary"; operator: "+" | "-" | "NOT"; argument: FormulaAst; position: number }
  | { type: "binary"; operator: string; left: FormulaAst; right: FormulaAst; position: number }
  | { type: "call"; name: FormulaFunction; arguments: FormulaAst[]; position: number };

export type FormulaFunction =
  | "SUM"
  | "AVG"
  | "MIN"
  | "MAX"
  | "ROUND"
  | "IF"
  | "COALESCE"
  | "CONCAT"
  | "LEN"
  | "DATEADD"
  | "FINISHDATE"
  | "ABS";

export interface FormulaLimits {
  maxExpressionLength: number;
  maxDepth: number;
  maxNodes: number;
  maxOperands: number;
  maxOperations: number;
  maxResultLength: number;
  maxNumericDigits: number;
  divisionScale: number;
}

const defaultLimits: FormulaLimits = {
  maxExpressionLength: 4096,
  maxDepth: 64,
  maxNodes: 1000,
  maxOperands: 100,
  maxOperations: 2000,
  maxResultLength: 10000,
  maxNumericDigits: 1000,
  divisionScale: 18,
};

export interface CompileFormulaOptions {
  fields?: Iterable<string>;
  limits?: Partial<FormulaLimits>;
}

export interface EvaluateFormulaOptions extends CompileFormulaOptions {calendar?:ProjectCalendar}

export interface CompiledFormula {
  readonly source: string;
  readonly ast: FormulaAst;
  readonly dependencies: readonly string[];
  readonly limits: Readonly<FormulaLimits>;
}

export type FormulaEvaluationResult =
  | { ok: true; value: FormulaValue }
  | { ok: false; error: ReturnType<FormulaError["toJSON"]> };

type TokenKind = "number" | "string" | "field" | "identifier" | "operator" | "punctuation" | "eof";
type Token = { kind: TokenKind; text: string; position: number };

const functions = new Set<FormulaFunction>([
  "SUM", "AVG", "MIN", "MAX", "ROUND", "IF", "COALESCE", "CONCAT", "LEN", "ABS", "DATEADD", "FINISHDATE",
]);

function limitsOf(overrides?: Partial<FormulaLimits>): FormulaLimits {
  const result = { ...defaultLimits, ...overrides };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new FormulaError("NUMERIC_RANGE", `限制 ${name} 必须为正整数`);
  }
  if (result.maxDepth > 256 || result.divisionScale > 1000)
    throw new FormulaError("NUMERIC_RANGE", "深度或除法精度限制过大");
  return result;
}

function tokenize(source: string, limits: FormulaLimits): Token[] {
  if (!source.trim()) throw new FormulaError("EMPTY_EXPRESSION", "公式不能为空", 0);
  if (source.length > limits.maxExpressionLength)
    throw new FormulaError("EXPRESSION_TOO_LONG", `公式不得超过 ${limits.maxExpressionLength} 个字符`, limits.maxExpressionLength);
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, text: string, position: number) => {
    tokens.push({ kind, text, position });
    if (tokens.length > limits.maxNodes * 3)
      throw new FormulaError("NODE_LIMIT", "公式包含过多记号", position);
  };
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "[") {
      const start = i++, end = source.indexOf("]", i);
      if (end < 0) throw new FormulaError("INVALID_FIELD", "字段引用缺少 ]", start);
      const id = source.slice(i, end).trim();
      if (!id || id.length > 200 || /[\[\]\u0000-\u001f]/.test(id))
        throw new FormulaError("INVALID_FIELD", "字段标识无效", start);
      push("field", id, start); i = end + 1; continue;
    }
    if (c === "\"" || c === "'") {
      const start = i++, quote = c;
      let value = "", closed = false;
      while (i < source.length) {
        const ch = source[i++];
        if (ch === quote) { closed = true; break; }
        if (ch === "\\") {
          if (i >= source.length) break;
          const escaped = source[i++], map: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "\"": "\"", "'": "'" };
          if (!(escaped in map)) throw new FormulaError("INVALID_STRING", `不支持的转义 \\${escaped}`, i - 2);
          value += map[escaped];
        } else value += ch;
        if (value.length > limits.maxResultLength)
          throw new FormulaError("RESULT_TOO_LONG", "字符串字面量过长", start);
      }
      if (!closed) throw new FormulaError("INVALID_STRING", "字符串缺少结束引号", start);
      push("string", value, start); continue;
    }
    if (/\d/.test(c) || (c === "." && /\d/.test(source[i + 1] ?? ""))) {
      const start = i;
      const match = source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) throw new FormulaError("INVALID_NUMBER", "数值格式无效", start);
      const text = match[0]; i += text.length;
      if (/\.$/.test(text) || !/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text))
        throw new FormulaError("INVALID_NUMBER", "数值格式无效", start);
      push("number", text, start); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i++;
      push("identifier", source.slice(start, i), start); continue;
    }
    const two = source.slice(i, i + 2);
    if (["<=", ">=", "!=", "==", "<>"].includes(two)) { push("operator", two, i); i += 2; continue; }
    if ("+-*/%=<>".includes(c)) { push("operator", c, i++); continue; }
    if ("(),".includes(c)) { push("punctuation", c, i++); continue; }
    throw new FormulaError("INVALID_TOKEN", `不允许的字符 ${JSON.stringify(c)}`, i);
  }
  tokens.push({ kind: "eof", text: "", position: source.length });
  return tokens;
}

class Parser {
  private index = 0;
  private nodes = 0;
  private depth = 0;
  constructor(private tokens: Token[], private limits: FormulaLimits) {}
  parse(): FormulaAst {
    const result = this.expression();
    const token = this.peek();
    if (token.kind !== "eof") throw new FormulaError("UNEXPECTED_TOKEN", `意外的记号 ${token.text}`, token.position);
    const pending: Array<{ node: FormulaAst; depth: number }> = [{ node: result, depth: 1 }];
    while (pending.length) {
      const current = pending.pop()!;
      if (current.depth > this.limits.maxDepth)
        throw new FormulaError("DEPTH_LIMIT", "公式语法树过深", current.node.position);
      if (current.node.type === "unary") pending.push({ node: current.node.argument, depth: current.depth + 1 });
      if (current.node.type === "binary") {
        pending.push({ node: current.node.left, depth: current.depth + 1 });
        pending.push({ node: current.node.right, depth: current.depth + 1 });
      }
      if (current.node.type === "call")
        for (const argument of current.node.arguments) pending.push({ node: argument, depth: current.depth + 1 });
    }
    return result;
  }
  private peek() { return this.tokens[this.index]; }
  private take() { return this.tokens[this.index++]; }
  private node<T extends FormulaAst>(node: T): T {
    if (++this.nodes > this.limits.maxNodes) throw new FormulaError("NODE_LIMIT", "公式语法树过大", node.position);
    return node;
  }
  private nested<T>(position: number, fn: () => T): T {
    if (++this.depth > this.limits.maxDepth) throw new FormulaError("DEPTH_LIMIT", "公式嵌套过深", position);
    try { return fn(); } finally { this.depth--; }
  }
  private matchOperator(...ops: string[]): Token | undefined {
    const token = this.peek(), upper = token.text.toUpperCase();
    if ((token.kind === "operator" || token.kind === "identifier") && ops.includes(upper)) { this.take(); return token; }
  }
  private expression() { return this.or(); }
  private or(): FormulaAst {
    let left = this.and();
    for (let op; (op = this.matchOperator("OR"));) left = this.node({ type: "binary", operator: "OR", left, right: this.and(), position: op.position });
    return left;
  }
  private and(): FormulaAst {
    let left = this.compare();
    for (let op; (op = this.matchOperator("AND"));) left = this.node({ type: "binary", operator: "AND", left, right: this.compare(), position: op.position });
    return left;
  }
  private compare(): FormulaAst {
    let left = this.add();
    const op = this.matchOperator("=", "==", "!=", "<>", "<", "<=", ">", ">=");
    if (op) left = this.node({ type: "binary", operator: op.text, left, right: this.add(), position: op.position });
    return left;
  }
  private add(): FormulaAst {
    let left = this.multiply();
    for (let op; (op = this.matchOperator("+", "-"));) left = this.node({ type: "binary", operator: op.text, left, right: this.multiply(), position: op.position });
    return left;
  }
  private multiply(): FormulaAst {
    let left = this.unary();
    for (let op; (op = this.matchOperator("*", "/", "%"));) left = this.node({ type: "binary", operator: op.text, left, right: this.unary(), position: op.position });
    return left;
  }
  private unary(): FormulaAst {
    const op = this.matchOperator("+", "-", "NOT");
    return op ? this.node({ type: "unary", operator: op.text.toUpperCase() as "+" | "-" | "NOT", argument: this.nested(op.position, () => this.unary()), position: op.position }) : this.primary();
  }
  private primary(): FormulaAst {
    const token = this.take();
    if (token.kind === "number") {
      const value = token.text.startsWith(".") ? `0${token.text}` : token.text;
      try { decimalParts(value); } catch { throw new FormulaError("INVALID_NUMBER", "数值超出支持范围", token.position); }
      return this.node({ type: "literal", value, valueType: "number", position: token.position });
    }
    if (token.kind === "string") return this.node({ type: "literal", value: token.text, valueType: "string", position: token.position });
    if (token.kind === "field") return this.node({ type: "field", id: token.text, position: token.position });
    if (token.kind === "identifier") {
      const name = token.text.toUpperCase();
      if (["TRUE", "FALSE", "NULL"].includes(name)) return this.node({ type: "literal", value: name === "NULL" ? null : name === "TRUE", valueType: name === "NULL" ? "null" : "boolean", position: token.position });
      if (this.peek().text !== "(") throw new FormulaError("UNEXPECTED_TOKEN", `未知标识 ${token.text}`, token.position);
      if (!functions.has(name as FormulaFunction)) throw new FormulaError("UNKNOWN_FUNCTION", `未知函数 ${token.text}`, token.position, { function: token.text });
      this.take();
      return this.nested(token.position, () => {
        const args: FormulaAst[] = [];
        if (this.peek().text !== ")") {
          do {
            if (args.length >= this.limits.maxOperands) throw new FormulaError("OPERAND_LIMIT", `函数参数不得超过 ${this.limits.maxOperands} 个`, this.peek().position);
            args.push(this.expression());
            if (this.peek().text !== ",") break;
            this.take();
          } while (true);
        }
        const close = this.take();
        if (close.text !== ")") throw new FormulaError("UNEXPECTED_TOKEN", "函数调用缺少 )", close.position);
        return this.node({ type: "call", name: name as FormulaFunction, arguments: args, position: token.position });
      });
    }
    if (token.text === "(") return this.nested(token.position, () => {
      const result = this.expression(), close = this.take();
      if (close.text !== ")") throw new FormulaError("UNEXPECTED_TOKEN", "括号缺少 )", close.position);
      return result;
    });
    throw new FormulaError("UNEXPECTED_TOKEN", token.kind === "eof" ? "公式意外结束" : `意外的记号 ${token.text}`, token.position);
  }
}

function collectDependencies(ast: FormulaAst): string[] {
  const result: string[] = [], seen = new Set<string>();
  const visit = (node: FormulaAst) => {
    if (node.type === "field") { if (!seen.has(node.id)) { seen.add(node.id); result.push(node.id); } return; }
    if (node.type === "unary") visit(node.argument);
    if (node.type === "binary") { visit(node.left); visit(node.right); }
    if (node.type === "call") node.arguments.forEach(visit);
  };
  visit(ast); return result;
}

export function compileFormula(source: string, options: CompileFormulaOptions = {}): CompiledFormula {
  if (typeof source !== "string") throw new FormulaError("INVALID_TOKEN", "公式必须是字符串", 0);
  const limits = limitsOf(options.limits), ast = new Parser(tokenize(source, limits), limits).parse();
  const dependencies = collectDependencies(ast);
  if (options.fields) {
    const known = new Set(options.fields);
    const unknown = dependencies.filter((field) => !known.has(field));
    if (unknown.length) throw new FormulaError("UNKNOWN_FIELD", `未知字段 ${unknown.map((x) => `[${x}]`).join("、")}`, undefined, { fields: unknown });
  }
  return Object.freeze({ source, ast, dependencies: Object.freeze(dependencies), limits: Object.freeze(limits) });
}

export function formulaDependencies(formula: string | CompiledFormula, options: CompileFormulaOptions = {}): readonly string[] {
  return typeof formula === "string" ? compileFormula(formula, options).dependencies : formula.dependencies;
}

type Decimal = { coefficient: bigint; scale: number };
type RuntimeValue = { kind: "number"; value: Decimal } | { kind: "string"; value: string } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null };

function normalize(value: Decimal): Decimal {
  let { coefficient, scale } = value;
  while (scale > 0 && coefficient % 10n === 0n) { coefficient /= 10n; scale--; }
  return { coefficient, scale };
}
function decimalText(value: Decimal) { const n = normalize(value); return fixedDecimal(n.coefficient, n.scale); }
function aligned(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.coefficient * 10n ** BigInt(scale - a.scale), b.coefficient * 10n ** BigInt(scale - b.scale), scale];
}
function compareDecimal(a: Decimal, b: Decimal) { const [x, y] = aligned(a, b); return x < y ? -1 : x > y ? 1 : 0; }

class Evaluator {
  private operations = 0;
  constructor(private fields: Readonly<Record<string, FormulaInput>>, private limits: FormulaLimits,private calendar?:ProjectCalendar) {}
  evaluate(node: FormulaAst): RuntimeValue {
    if (++this.operations > this.limits.maxOperations) throw new FormulaError("OPERATION_LIMIT", "公式执行操作过多", node.position);
    switch (node.type) {
      case "literal":
        return node.valueType === "number" ? { kind: "number", value: this.parseNumber(node.value as string, node.position) } :
          node.valueType === "string" ? { kind: "string", value: node.value as string } :
          node.valueType === "boolean" ? { kind: "boolean", value: node.value as boolean } : { kind: "null", value: null };
      case "field": return this.field(node);
      case "unary": return this.unary(node);
      case "binary": return this.binary(node);
      case "call": return this.call(node);
    }
  }
  private fail(code: FormulaErrorCode, message: string, position: number, details?: Record<string, unknown>): never { throw new FormulaError(code, message, position, details); }
  private parseNumber(text: string, position: number): Decimal {
    try {
      const result = normalize(decimalParts(text));
      this.checkNumber(result, position); return result;
    } catch (error) {
      if (error instanceof FormulaError) throw error;
      return this.fail("NON_FINITE_VALUE", "数值必须是有限的十进制数", position);
    }
  }
  private checkNumber(value: Decimal, position: number): Decimal {
    const digits = (value.coefficient < 0n ? -value.coefficient : value.coefficient).toString().length;
    if (digits > this.limits.maxNumericDigits || value.scale > this.limits.maxNumericDigits)
      this.fail("NUMERIC_RANGE", "数值超出公式计算范围", position);
    return value;
  }
  private field(node: Extract<FormulaAst, { type: "field" }>): RuntimeValue {
    if (!Object.prototype.hasOwnProperty.call(this.fields, node.id)) this.fail("UNKNOWN_FIELD", `未知字段 [${node.id}]`, node.position, { fields: [node.id] });
    const value = this.fields[node.id];
    if (value === null || value === undefined) return { kind: "null", value: null };
    if (typeof value === "boolean") return { kind: "boolean", value };
    if (typeof value === "bigint") return { kind: "number", value: this.parseNumber(value.toString(), node.position) };
    if (typeof value === "number") {
      if (!Number.isFinite(value)) this.fail("NON_FINITE_VALUE", `字段 [${node.id}] 不是有限数值`, node.position, { field: node.id });
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) this.fail("NON_FINITE_VALUE", `字段 [${node.id}] 必须用十进制字符串传入以保证精度`, node.position, { field: node.id });
      return { kind: "number", value: this.parseNumber(String(value), node.position) };
    }
    return { kind: "string", value };
  }
  private number(value: RuntimeValue, position: number): Decimal {
    if (value.kind === "number") return value.value;
    if (value.kind === "string" && /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value.value)) return this.parseNumber(value.value, position);
    return this.fail("TYPE_MISMATCH", "此操作需要数值", position, { actual: value.kind });
  }
  private bool(value: RuntimeValue, position: number): boolean {
    if (value.kind !== "boolean") return this.fail("TYPE_MISMATCH", "逻辑操作需要布尔值", position, { actual: value.kind });
    return value.value;
  }
  private unary(node: Extract<FormulaAst, { type: "unary" }>): RuntimeValue {
    const value = this.evaluate(node.argument);
    if (node.operator === "NOT") return { kind: "boolean", value: !this.bool(value, node.position) };
    const n = this.number(value, node.position);
    return { kind: "number", value: node.operator === "-" ? { coefficient: -n.coefficient, scale: n.scale } : n };
  }
  private binary(node: Extract<FormulaAst, { type: "binary" }>): RuntimeValue {
    if (node.operator.toUpperCase() === "AND") { const left = this.bool(this.evaluate(node.left), node.position); return { kind: "boolean", value: left && this.bool(this.evaluate(node.right), node.position) }; }
    if (node.operator.toUpperCase() === "OR") { const left = this.bool(this.evaluate(node.left), node.position); return { kind: "boolean", value: left || this.bool(this.evaluate(node.right), node.position) }; }
    const left = this.evaluate(node.left), right = this.evaluate(node.right);
    if (["=", "==", "!=", "<>", "<", "<=", ">", ">="].includes(node.operator)) return { kind: "boolean", value: this.comparison(node.operator, left, right, node.position) };
    const isDate=(v:RuntimeValue)=>v.kind==='string'&&/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(v.value);
    if((node.operator==='+'||node.operator==='-')&&isDate(left)&&!isDate(right))
      return this.dateAdd(left,right,node.position,node.operator==='-'?-1:1,this.calendar?'offset':'natural');
    if(node.operator==='+'&&isDate(right)&&!isDate(left))return this.dateAdd(right,left,node.position,1,this.calendar?'offset':'natural');
    const a = this.number(left, node.position), b = this.number(right, node.position);
    let result: Decimal;
    if (node.operator === "+" || node.operator === "-") { const [x, y, scale] = aligned(a, b); result = { coefficient: node.operator === "+" ? x + y : x - y, scale }; }
    else if (node.operator === "*") result = { coefficient: a.coefficient * b.coefficient, scale: a.scale + b.scale };
    else if (node.operator === "/") result = this.divide(a, b, node.position);
    else {
      if (b.coefficient === 0n) this.fail("DIVIDE_BY_ZERO", "不能除以零", node.position);
      const [x, y, scale] = aligned(a, b); result = { coefficient: x % y, scale };
    }
    return { kind: "number", value: this.checkNumber(normalize(result), node.position) };
  }
  private dateAdd(date:RuntimeValue,days:RuntimeValue,position:number,sign=1,mode:'natural'|'offset'|'finish'='natural'):RuntimeValue{
    if(date.kind==='null'||days.kind==='null')return {kind:'null',value:null};
    if(date.kind!=='string')return this.fail('TYPE_MISMATCH','DATEADD 需要日期或日期时间',position);
    const text=date.value;
    const type=text.length===10?'date':/(Z|[+-]\d{2}:\d{2})$/.test(text)?'timestamptz':'timestamp';
    let validated:string;
    try{validated=validateValue({id:'date',name:'Date',type},text) as string;}
    catch{return this.fail('TYPE_MISMATCH','DATEADD 需要有效的日期或日期时间',position);}
    if(!validated)return this.fail('TYPE_MISMATCH','DATEADD 需要有效的日期或日期时间',position);
    const n=this.integer(this.number(days,position),position)*sign;
    const day=new Date(validated.slice(0,10)+'T00:00:00Z');
    if(mode==='natural')day.setUTCDate(day.getUTCDate()+n);
    else{
      if(mode==='finish'&&n<0)return this.fail('NUMERIC_RANGE','工期不能为负数',position);
      const calendar=this.calendar||defaultProjectCalendar;
      let remaining=mode==='finish'?Math.max(1,n):Math.abs(n);
      let offset=mode==='finish'?0:n<0?-1:1;
      for(let examined=0;remaining>0;examined++){
        if(examined>=40000||(examined%16===0&&++this.operations>this.limits.maxOperations))
          return this.fail('OPERATION_LIMIT','工作日计算超出允许范围',position);
        day.setUTCDate(day.getUTCDate()+offset);
        if(!Number.isFinite(day.getTime())||day.getUTCFullYear()<1||day.getUTCFullYear()>9999)
          return this.fail('NUMERIC_RANGE','日期计算结果超出范围',position);
        if(calendarPeriods(calendar,day.toISOString().slice(0,10)).length)remaining--;
        offset=n<0?-1:1;
      }
    }
    if(!Number.isFinite(day.getTime())||day.getUTCFullYear()<1||day.getUTCFullYear()>9999)
      return this.fail('NUMERIC_RANGE','日期计算结果超出范围',position);
    return {kind:'string',value:day.toISOString().slice(0,10)+validated.slice(10)};
  }
  private divide(a: Decimal, b: Decimal, position: number): Decimal {
    if (b.coefficient === 0n) this.fail("DIVIDE_BY_ZERO", "不能除以零", position);
    const scale = this.limits.divisionScale;
    const numerator = a.coefficient * 10n ** BigInt(scale + b.scale), denominator = b.coefficient * 10n ** BigInt(a.scale);
    let quotient = numerator / denominator, remainder = numerator % denominator;
    if (remainder < 0n) remainder = -remainder;
    const absoluteDenominator = denominator < 0n ? -denominator : denominator;
    if (remainder * 2n >= absoluteDenominator) quotient += numerator * denominator < 0n ? -1n : 1n;
    return normalize({ coefficient: quotient, scale });
  }
  private comparison(op: string, a: RuntimeValue, b: RuntimeValue, position: number): boolean {
    let comparison: number;
    if (a.kind === "null" || b.kind === "null") comparison = a.kind === b.kind ? 0 : a.kind === "null" ? -1 : 1;
    else {
      let an: Decimal | undefined, bn: Decimal | undefined;
      try { an = this.number(a, position); bn = this.number(b, position); } catch (error) { if (!(error instanceof FormulaError) || error.code !== "TYPE_MISMATCH") throw error; }
      if (an && bn) comparison = compareDecimal(an, bn);
      else if (a.kind === b.kind) comparison = a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
      else this.fail("TYPE_MISMATCH", "不能比较不同类型的值", position, { left: a.kind, right: b.kind });
    }
    return op === "=" || op === "==" ? comparison === 0 : op === "!=" || op === "<>" ? comparison !== 0 : op === "<" ? comparison < 0 : op === "<=" ? comparison <= 0 : op === ">" ? comparison > 0 : comparison >= 0;
  }
  private arity(node: Extract<FormulaAst, { type: "call" }>, min: number, max = min) {
    if (node.arguments.length < min || node.arguments.length > max) this.fail("OPERAND_LIMIT", `${node.name} 需要 ${min === max ? min : `${min} 至 ${max}`} 个参数`, node.position, { actual: node.arguments.length });
  }
  private call(node: Extract<FormulaAst, { type: "call" }>): RuntimeValue {
    if(node.name==='DATEADD'||node.name==='FINISHDATE'){this.arity(node,2);return this.dateAdd(this.evaluate(node.arguments[0]),this.evaluate(node.arguments[1]),node.position,1,node.name==='FINISHDATE'?'finish':'natural');}
    if (node.name === "IF") { this.arity(node, 3); return this.evaluate(this.bool(this.evaluate(node.arguments[0]), node.position) ? node.arguments[1] : node.arguments[2]); }
    if (node.name === "COALESCE") { this.arity(node, 1, this.limits.maxOperands); for (const arg of node.arguments) { const value = this.evaluate(arg); if (value.kind !== "null") return value; } return { kind: "null", value: null }; }
    if (node.name === "CONCAT") { this.arity(node, 1, this.limits.maxOperands); let text = ""; for (const arg of node.arguments) { const value = this.evaluate(arg); text += value.kind === "null" ? "" : value.kind === "number" ? decimalText(value.value) : String(value.value); if (text.length > this.limits.maxResultLength) this.fail("RESULT_TOO_LONG", "公式结果字符串过长", node.position); } return { kind: "string", value: text }; }
    if (node.name === "LEN") { this.arity(node, 1); const value = this.evaluate(node.arguments[0]); if (value.kind !== "string") this.fail("TYPE_MISMATCH", "LEN 需要字符串", node.position); return { kind: "number", value: { coefficient: BigInt(Array.from(value.value).length), scale: 0 } }; }
    if (node.name === "ABS") { this.arity(node, 1); const n = this.number(this.evaluate(node.arguments[0]), node.position); return { kind: "number", value: { coefficient: n.coefficient < 0n ? -n.coefficient : n.coefficient, scale: n.scale } }; }
    if (node.name === "ROUND") {
      this.arity(node, 1, 2); const n = this.number(this.evaluate(node.arguments[0]), node.position);
      const digits = node.arguments.length === 1 ? 0 : this.integer(this.number(this.evaluate(node.arguments[1]), node.position), node.position);
      if (digits < -100 || digits > 100) this.fail("NUMERIC_RANGE", "ROUND 位数必须在 -100 至 100 之间", node.position);
      return { kind: "number", value: this.round(n, digits) };
    }
    this.arity(node, 1, this.limits.maxOperands);
    const values = node.arguments.map((arg) => this.evaluate(arg)).filter((v) => v.kind !== "null").map((v) => this.number(v, node.position));
    if (!values.length) { if (node.name === "SUM") return { kind: "number", value: { coefficient: 0n, scale: 0 } }; this.fail("OPERAND_LIMIT", `${node.name} 至少需要一个非空数值`, node.position); }
    if (node.name === "SUM" || node.name === "AVG") {
      const sum = values.reduce((acc, value) => { const [a, b, scale] = aligned(acc, value); return normalize({ coefficient: a + b, scale }); }, { coefficient: 0n, scale: 0 });
      return { kind: "number", value: this.checkNumber(node.name === "AVG" ? this.divide(sum, { coefficient: BigInt(values.length), scale: 0 }, node.position) : sum, node.position) };
    }
    let result = values[0];
    for (const value of values.slice(1)) if ((node.name === "MIN" && compareDecimal(value, result) < 0) || (node.name === "MAX" && compareDecimal(value, result) > 0)) result = value;
    return { kind: "number", value: result };
  }
  private integer(value: Decimal, position: number): number {
    const n = normalize(value);
    if (n.scale !== 0) return this.fail("TYPE_MISMATCH", "此参数必须是整数", position);
    const number = Number(n.coefficient);
    if (!Number.isSafeInteger(number)) return this.fail("NUMERIC_RANGE", "整数参数超出范围", position);
    return number;
  }
  private round(value: Decimal, digits: number): Decimal {
    const targetScale = Math.max(0, digits);
    if (digits >= value.scale) return value;
    const shift = value.scale - digits, divisor = 10n ** BigInt(shift);
    let coefficient = value.coefficient / divisor, remainder = value.coefficient % divisor;
    if (remainder < 0n) remainder = -remainder;
    if (remainder * 2n >= divisor) coefficient += value.coefficient < 0n ? -1n : 1n;
    if (digits < 0) coefficient *= 10n ** BigInt(-digits);
    return normalize({ coefficient, scale: targetScale });
  }
}

function publicValue(value: RuntimeValue): FormulaValue {
  return value.kind === "number" ? decimalText(value.value) : value.value;
}

export function evaluateFormula(formula: string | CompiledFormula, fields: Readonly<Record<string, FormulaInput>> = {}, options: EvaluateFormulaOptions = {}): FormulaValue {
  const compiled = typeof formula === "string" ? compileFormula(formula, options) : formula;
  if (options.fields) {
    const known = new Set(options.fields), unknown = compiled.dependencies.filter((field) => !known.has(field));
    if (unknown.length) throw new FormulaError("UNKNOWN_FIELD", `未知字段 ${unknown.map((x) => `[${x}]`).join("、")}`, undefined, { fields: unknown });
  }
  return publicValue(new Evaluator(fields, compiled.limits,options.calendar).evaluate(compiled.ast));
}

export function tryEvaluateFormula(formula: string | CompiledFormula, fields: Readonly<Record<string, FormulaInput>> = {}, options: EvaluateFormulaOptions = {}): FormulaEvaluationResult {
  try { return { ok: true, value: evaluateFormula(formula, fields, options) }; }
  catch (error) {
    if (error instanceof FormulaError) return { ok: false, error: error.toJSON() };
    throw error;
  }
}

export type FormulaGraph = Readonly<Record<string, string | CompiledFormula>>;

export function detectFormulaCycles(formulas: FormulaGraph, options: CompileFormulaOptions = {}): string[][] {
  const ids = new Set(Object.keys(formulas)), graph = new Map<string, readonly string[]>();
  for (const [id, formula] of Object.entries(formulas)) graph.set(id, formulaDependencies(formula, options).filter((dependency) => ids.has(dependency)));
  const state = new Map<string, 0 | 1 | 2>(), stack: string[] = [], cycles: string[][] = [], seen = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1); stack.push(id);
    for (const dependency of graph.get(id) ?? []) {
      if (!state.get(dependency)) visit(dependency);
      else if (state.get(dependency) === 1) {
        const cycle = [...stack.slice(stack.indexOf(dependency)), dependency];
        const core = cycle.slice(0, -1), rotations = core.map((_, i) => [...core.slice(i), ...core.slice(0, i)]);
        const canonical = rotations.map((x) => x.join("\u0000")).sort()[0];
        if (!seen.has(canonical)) { seen.add(canonical); cycles.push(cycle); }
      }
    }
    stack.pop(); state.set(id, 2);
  };
  for (const id of ids) if (!state.get(id)) visit(id);
  return cycles;
}

export function assertNoFormulaCycles(formulas: FormulaGraph, options: CompileFormulaOptions = {}): void {
  const cycles = detectFormulaCycles(formulas, options);
  if (cycles.length) throw new FormulaError("CIRCULAR_DEPENDENCY", `检测到循环依赖：${cycles.map((cycle) => cycle.join(" -> ")).join("；")}`, undefined, { cycles });
}
