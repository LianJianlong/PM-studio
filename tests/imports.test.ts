import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseCsv, parseFile, convertCell } from "../server/imports.ts";

test("CSV preserves escaped quotes, commas, multiline cells and BOM", () => {
  assert.deepEqual(
    parseCsv('\uFEFF名称,备注\r\n甲,"含,逗号"\r\n乙,"双""引号\n换行"\r\n'),
    [
      ["名称", "备注"],
      ["甲", "含,逗号"],
      ["乙", '双"引号\n换行'],
    ],
  );
  assert.throws(() => parseCsv('a,b\n"broken'), /未闭合/);
  assert.throws(() => parseCsv('a\n"done"tail'), /格式无效/);
  assert.throws(() => parseCsv("header\n" + "row\n".repeat(1001)), /1000/);
});
test("import converts declared types without silently changing invalid values", () => {
  assert.equal(convertCell("1.5e2", "number"), 150);
  assert.equal(convertCell("否", "boolean"), false);
  assert.equal(convertCell(20, "text"), "20");
  assert.equal(convertCell("", "date"), null);
  assert.throws(() => convertCell("1,200", "number"));
  assert.throws(() => convertCell("maybe", "boolean"));
});
test("XLSX reads actual sheets and dates, rejects formulas and corrupt files", async () => {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet("日报");
  sheet.addRow(["日期", "数量", "说明"]);
  sheet.addRow([new Date("2026-09-23T00:00:00Z"), 25, "完整值"]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseFile("日报.xlsx", bytes);
  assert.deepEqual(parsed[0].rows[0], ["2026-09-23", 25, "完整值"]);
  sheet.addRow([new Date("2026-09-23T12:34:56.789Z"),26,"含时间"]);
  const timed = await parseFile("时间.xlsx",Buffer.from(await workbook.xlsx.writeBuffer()));
  assert.equal(timed[0].rows[1][0],"2026-09-23T12:34:56.789");
  sheet.getCell("B2").value = { formula: "1+1", result: 2 };
  await assert.rejects(
    parseFile("formula.xlsx", Buffer.from(await workbook.xlsx.writeBuffer())),
    /公式/,
  );
  await assert.rejects(
    parseFile("bad.xlsx", Buffer.from("invalid zip")),
    /损坏/,
  );
  await assert.rejects(
    parseFile("huge.csv", Buffer.alloc(1024 * 1024 + 1)),
    /1MB/,
  );
});
