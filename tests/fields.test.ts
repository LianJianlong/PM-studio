import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateValue,
  exactSum,
  formatExact,
  inputValue,
  fieldTypes,
  type DataField,
} from "../shared/fields.ts";
import { fields, validateRecord } from "../server/validation.ts";
import { convertCell } from "../server/imports.ts";
const field = (
  type: DataField["type"],
  extra: Partial<DataField> = {},
): DataField => ({ id: "value", name: "字段", type, ...extra });
test("integer families enforce both boundaries and preserve every int64 digit", () => {
  for (const bits of [8, 16, 24, 32, 64]) {
    const f = field(`int${bits}` as DataField["type"]),
      min = -(1n << BigInt(bits - 1)),
      max = (1n << BigInt(bits - 1)) - 1n;
    assert.equal(String(validateValue(f, min.toString())), min.toString());
    assert.equal(String(validateValue(f, max.toString())), max.toString());
    assert.throws(() => validateValue(f, (min - 1n).toString()));
    assert.throws(() => validateValue(f, (max + 1n).toString()));
  }
  assert.equal(
    validateValue(field("uint64"), "18446744073709551615"),
    "18446744073709551615",
  );
  assert.throws(() => validateValue(field("uint64"), "-1"));
  assert.throws(() => validateValue(field("int64"), 9007199254740992));
  assert.throws(() => validateValue(field("int32"), "2.5"));
});
test("decimal fixed scale is exact and never silently rounds", () => {
  const f = field("decimal", { precision: 6, scale: 2 });
  assert.equal(validateValue(f, "-12.3"), "-12.30");
  assert.equal(validateValue(f, "9999.99"), "9999.99");
  assert.throws(() => validateValue(f, "10000.00"));
  assert.throws(() => validateValue(f, "0.001"));
  assert.throws(() => validateValue(f, 0.1));
  assert.throws(() => validateValue(f, "1e2"));
  assert.equal(
    validateValue(
      field("decimal", { precision: 1000, scale: 0 }),
      "9".repeat(1000),
    ),
    "9".repeat(1000),
  );
  assert.equal(exactSum(["0.10", "0.20"], 2), "0.30");
  assert.equal(
    exactSum(["9223372036854775807", "9223372036854775807"]),
    "18446744073709551614",
  );
  assert.equal(
    exactSum(["-99999999999999999.99", "100000000000000000.01"], 2),
    "0.02",
  );
  assert.equal(exactSum([1e-7, 2e-7]), "0.0000003");
  assert.equal(exactSum([], 2), "0.00");
  assert.equal(
    formatExact("12345678901234567890.123456"),
    "12,345,678,901,234,567,890.123456",
  );
});
test("exact decimal addition agrees with independently scaled integer arithmetic", () => {
  const values = Array.from({ length: 1000 }, (_, i) =>
    BigInt(((i * 7919) % 100003) - 50001),
  );
  const decimal = (n: bigint) =>
    `${n < 0n ? "-" : ""}${(n < 0n ? -n : n) / 100n}.${((n < 0n ? -n : n) % 100n).toString().padStart(2, "0")}`;
  assert.equal(
    exactSum(values.map(decimal), 2),
    decimal(values.reduce((a, b) => a + b, 0n)),
  );
});
test("temporal values reject impossible dates and preserve timezone microseconds", () => {
  assert.equal(validateValue(field("date"), "2024-02-29"), "2024-02-29");
  assert.throws(() => validateValue(field("date"), "2025-02-29"));
  assert.equal(validateValue(field("time"), "12:34"), "12:34:00");
  assert.throws(() => validateValue(field("time"), "24:00:00"));
  assert.equal(
    validateValue(field("timestamp"), "2026-09-23 12:34:56.123456"),
    "2026-09-23T12:34:56.123456",
  );
  assert.throws(() =>
    validateValue(field("timestamp"), "2026-09-23T12:34:56Z"),
  );
  assert.equal(
    validateValue(field("timestamptz"), "2026-09-23T01:02:03.123456+08:00"),
    "2026-09-22T17:02:03.123456Z",
  );
  assert.throws(() =>
    validateValue(field("timestamptz"), "2026-09-23T12:34:56"),
  );
  assert.throws(() =>
    validateValue(field("timestamptz"), "2026-09-23T12:34:56+15:00"),
  );
});
test("complex data types and import reject invalid or precision-losing values", () => {
  assert.deepEqual(validateValue(field("json"), { a: [1, true, "甲"] }), {
    a: [1, true, "甲"],
  });
  assert.throws(() => validateValue(field("array"), {}));
  assert.throws(() => validateValue(field("json"), { id: 9007199254740992 }));
  assert.throws(() =>
    validateValue(
      field("json"),
      JSON.parse("[".repeat(34) + "0" + "]".repeat(34)),
    ),
  );
  assert.equal(
    validateValue(field("uuid"), "550E8400-E29B-41D4-A716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000",
  );
  assert.throws(() => validateValue(field("uuid"), "not-a-uuid"));
  assert.equal(validateValue(field("binary"), "AAEC/w=="), "AAEC/w==");
  assert.throws(() => validateValue(field("binary"), "%%%"));
  assert.equal(
    validateValue(field("enum", { options: ["甲", "乙"] }), "甲"),
    "甲",
  );
  assert.throws(() =>
    validateValue(field("enum", { options: ["甲", "乙"] }), "丙"),
  );
  assert.throws(() => convertCell(123, "int64"));
  assert.throws(() => convertCell(0.1, "decimal"));
  assert.equal(convertCell("9007199254740993", "int64"), "9007199254740993");
  assert.deepEqual(convertCell('{"a":1}', "json"), { a: 1 });
  assert.equal(inputValue(field("boolean"), ""), null);
  assert.equal(inputValue(field("decimal"), "0.10"), "0.10");
});
test("field definitions validate type options and record normalization", () => {
  assert.equal(fieldTypes.length, 30);
  assert.throws(() =>
    fields.parse([field("decimal", { precision: 3, scale: 4 })]),
  );
  assert.throws(() => fields.parse([field("enum", { options: ["a", "a"] })]));
  assert.throws(() => fields.parse([field("text", { scale: 2 })]));
  assert.deepEqual(
    validateRecord([field("decimal", { precision: 10, scale: 2 })], {
      value: "3.1",
    }),
    { value: "3.10" },
  );
  assert.throws(
    () => validateRecord([field("int16")], { value: "32768" }),
    /字段/,
  );
});

test("single and multiple choices enforce allowed values, uniqueness and required selection", () => {
  const multi = field("multi_select", {
    options: ["设计", "工程", "商务"],
    required: true,
  });
  assert.deepEqual(validateValue(multi, ["商务", "设计"]), ["设计", "商务"]);
  for (const value of [[], ["设计", "设计"], ["未知"], "设计"])
    assert.throws(() => validateValue(multi, value));
  assert.equal(
    validateValue(
      field("single_select", { options: ["待办", "完成"] }),
      "完成",
    ),
    "完成",
  );
  assert.throws(() => fields.parse([field("multi_select", { options: [] })]));
  assert.deepEqual(convertCell('["设计","工程"]', "multi_select"), [
    "设计",
    "工程",
  ]);
});

test("generated fields are omitted during validation and cannot be forged", () => {
  for (const type of [
    "created_time",
    "modified_time",
    "created_user",
    "modified_user",
  ] as const) {
    assert.deepEqual(validateRecord([field(type)], {}), {});
    for (const value of [null, "", "forged"])
      assert.throws(() => validateRecord([field(type)], { value }));
    assert.throws(() => fields.parse([field(type, { required: true })]));
  }
});

test("reference IDs are canonical unique arrays and inverse schemas cannot be forged", () => {
  const a = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  assert.deepEqual(validateValue(field("reference"), [b, a]), [
    a.toLowerCase(),
    b,
  ]);
  for (const v of ["id", ["bad-id"], [a, a.toLowerCase()], Array(101).fill(a)])
    assert.throws(() => validateValue(field("reference"), v));
  assert.throws(() => fields.parse([field("reference")]));
  assert.throws(() => fields.parse([field("backlink", { target_table: a })]));
  assert.throws(() => fields.parse([field("text", { target_table: a })]));
  assert.deepEqual(validateRecord([field("backlink")], { value: [a] }), {});
});
test('integer auto-increment validates exact start and positive step without requiring manual values',()=>{
 const f=fields.parse([{id:'serial',name:'序号',type:'int64',required:true,auto_increment:true,auto_increment_start:'9007199254740993',auto_increment_step:'5'}])[0];
 assert.equal(f.auto_increment_start,'9007199254740993');assert.equal(validateRecord([f],{}).serial,null);
 for(const patch of [{auto_increment_step:'0'},{auto_increment_step:'-1'},{auto_increment_step:'1.5'},{auto_increment_start:'9223372036854775808'}])assert.throws(()=>fields.parse([{...f,...patch}]));
 assert.throws(()=>fields.parse([{...f,type:'text'}]));assert.throws(()=>fields.parse([{...f,type:'uint64',auto_increment_start:'-1'}]));
 assert.equal(fields.parse([{...f,type:'int8',auto_increment_start:'-128',auto_increment_step:'1'}])[0].auto_increment_start,'-128');
});
