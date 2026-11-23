import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createReportWorkbook, type ReportExportData } from "../server/report-workbook.ts";

const info = { name: "报表/精确费用", project: "工程项目", version: 3, user: "测试用户", generatedAt: new Date("2026-10-04T00:30:00Z"), notes: [{ section: "页眉", text: "=1+1" }] };
function values(sheet: ExcelJS.Worksheet) {
  const result: ExcelJS.CellValue[] = [];
  sheet.eachRow((row) => row.eachCell((cell) => result.push(cell.value)));
  return result;
}
test("report workbook roundtrip preserves decimal/int64 text, filter provenance, and literal formula-shaped content", async () => {
  const block: ReportExportData = {
    title: "=SUM(A1:A2)", section: "明细", source: "财税 · 费用表", dimension: "事项", metric: "金额（元）", aggregation: "求和",
    filters: ["记录状态：已审核", "日期：2026-10-01 至 2026-10-04"],
    rows: [{ label: "=HYPERLINK(\"https://example.invalid\")", value: "9007199254740993.1234" }, { label: "大整数", value: "18446744073709551615" }],
    overall: "9007199254740994.1234", groupCount: 35, matched: 40,
  };
  const workbook = createReportWorkbook(info, [block, { ...block, title: "同名/超长:报表" }]);
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  assert.deepEqual(loaded.worksheets.map((sheet) => sheet.name), ["报表说明", "组件01", "组件02"]);
  const cells = values(loaded.getWorksheet("组件01")!);
  for (const expected of ["9007199254740993.1234", "18446744073709551615", "9007199254740994.1234", "日期：2026-10-01 至 2026-10-04", "共35组，导出数值排序前2组。", block.rows[0].label])
    assert.ok(cells.some((value) => typeof value === "string" && value.includes(expected)), expected);
  assert.equal(loaded.getWorksheet("组件01")!.getCell("A1").value, block.title);
  assert.ok(loaded.worksheets.flatMap(values).every((value) => typeof value !== "object" || value === null || !("formula" in value)));
  const cover = values(loaded.getWorksheet("报表说明")!);
  assert.ok(cover.includes("导出时间（Europe/Helsinki）"));
  assert.ok(cover.includes("2026/10/4 03:30:00"));
  const other=createReportWorkbook({...info,timeZone:'Asia/Shanghai'},[]);assert.ok(values(other.worksheets[0]).includes('2026/10/4 08:30:00'));
  assert.ok(cover.includes("=1+1"));
});
test("empty report export retains context and creates no misleading numeric sheets", async () => {
  const workbook = createReportWorkbook(info, []);
  assert.equal(workbook.worksheets.length, 1);
  const cells = values(workbook.worksheets[0]);
  assert.ok(cells.includes("0"));
  assert.ok(cells.includes("工程项目"));
  assert.ok(cells.includes("3"));
});
test('record detail export preserves columns, long decimals and literal text without hidden totals',async()=>{
 const book=createReportWorkbook(info,[{title:'施工明细',section:'明细',source:'施工日报',dimension:'日期',metric:'记录数',aggregation:'计数',filters:[],rows:[],overall:1,groupCount:1,details:{columns:[{id:'subsystem',name:'子系统'},{id:'actual',name:'实际完成量'},{id:'issues',name:'协调事项'}],rows:[['医用气体与真空吸引','9007199254740993.1234','=HYPERLINK("test")']],total:1,limit:100}}]);
 const loaded=new ExcelJS.Workbook();await loaded.xlsx.load(await book.xlsx.writeBuffer());const content=values(loaded.getWorksheet('组件01')!);assert(content.includes('子系统'));assert(content.includes('9007199254740993.1234'));assert(content.includes('=HYPERLINK("test")'));
});
