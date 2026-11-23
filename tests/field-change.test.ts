import test from "node:test";
import assert from "node:assert/strict";
import { changeFieldValue } from "../shared/field-change.ts";
import type { DataField } from "../shared/fields.ts";
const field = (
  type: DataField["type"],
  extra: Partial<DataField> = {},
): DataField => ({ id: "v", name: "值", type, ...extra });
test("column conversion validates compatible values without silently losing precision", () => {
  assert.equal(changeFieldValue(field("text"), field("number"), "12.5"), 12.5);
  assert.equal(
    changeFieldValue(field("number"), field("decimal", { scale: 2 }), 12.5),
    "12.50",
  );
  assert.equal(
    changeFieldValue(field("int64"), field("text"), "9007199254740993"),
    "9007199254740993",
  );
  assert.throws(
    () => changeFieldValue(field("int64"), field("number"), "9007199254740993"),
    /精度/,
  );
  assert.throws(
    () =>
      changeFieldValue(
        field("decimal", { scale: 4 }),
        field("decimal", { scale: 2 }),
        "1.1234",
      ),
    /小数位/,
  );
  assert.throws(() => changeFieldValue(field("text"), field("number"), "abc"));
  assert.throws(
    () => changeFieldValue(field("number"), field("int8"), 200),
    /范围/,
  );
});
test("required choices and derived columns prevent data loss", () => {
  assert.throws(
    () =>
      changeFieldValue(field("text"), field("text", { required: true }), null),
    /不能为空/,
  );
  assert.throws(
    () =>
      changeFieldValue(
        field("text"),
        field("formula", { formula: "1" }),
        "original",
      ),
    /迁移/,
  );
  assert.equal(
    changeFieldValue(field("formula"), field("number"), undefined),
    null,
  );
  assert.throws(() =>
    changeFieldValue(
      field("enum", { options: ["a", "b"] }),
      field("enum", { options: ["a"] }),
      "b",
    ),
  );
  assert.throws(
    () => changeFieldValue(field("reference"), field("text"), ["id"]),
    /引用/,
  );
});
