import ExcelJS from "exceljs";
import type { ReportPivot } from "../shared/report-pivot.ts";

export type ReportExportData = {
  title: string;
  section: string;
  source: string;
  dimension: string;
  metric: string;
  aggregation: string;
  filters: string[];
  rows: { label: string; value: string | number;x?:string }[];
  xMetric?:string;
  overall: string | number;
  groupCount: number;
  matched?: number;
  columnDimension?: string;
  pivot?: ReportPivot;
  details?:{columns:{id:string;name:string}[];rows:string[][];total:number;limit:number};
};
export type ReportExportInfo = {
  name: string;
  project: string;
  version: number;
  user: string;
  generatedAt: Date;
  timeZone?:string;
  notes: { section: string; text: string }[];
};

const teal = "FF147D73";
function title(sheet: ExcelJS.Worksheet, text: string) {
  sheet.columns = [{ width: 34 }, { width: 68 }];
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = text;
  sheet.getRow(1).height = 32;
  sheet.getCell("A1").font = { name: "微软雅黑", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.pageSetup = { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}
function row(sheet: ExcelJS.Worksheet, label: string, value: string | number) {
  const added = sheet.addRow([label, String(value)]);
  added.getCell(1).font = { name: "微软雅黑", bold: true, size: 11 };
  added.getCell(2).font = { name: "微软雅黑", size: 11 };
  added.alignment = { vertical: "top", wrapText: true };
  added.height = Math.max(22, Math.min(180, 20 * Math.ceil(String(value).length / 44)));
  added.getCell(2).numFmt = "@";
  return added;
}

// This workbook contains aggregated chart/table values, not business record exports.
// Every numeric result remains text so Excel cannot round decimal/int64 values.
export function createReportWorkbook(info: ReportExportInfo, data: ReportExportData[]) {
  const book = new ExcelJS.Workbook();
  book.creator = "Project Studio";
  book.created = info.generatedAt;
  const cover = book.addWorksheet("报表说明");
  title(cover, info.name);
  row(cover, "项目", info.project);
  row(cover, "报表版本", info.version);
  row(cover, `导出时间（${info.timeZone||'Europe/Helsinki'}）`, info.generatedAt.toLocaleString("zh-CN", { timeZone: info.timeZone||"Europe/Helsinki", hour12: false }));
  row(cover, "导出人", info.user);
  row(cover, "统计口径", "按导出账号的当前权限和已保存的筛选条件实时计算；各组件分别读取数据。");
  row(cover, "数据范围", "每个组件最多显示前30组；整体指标覆盖筛选后的全部分组，不是前30组之和。");
  row(cover, "数值格式", "统计数值按文本保存，保留小数和大整数精度；Excel 二次计算前请确认精度要求。");
  row(cover, "组件数量", data.length);
  for (const note of info.notes) row(cover, note.section, note.text);
  for (const [index, block] of data.entries()) {
    // Numbered names are unique, valid, and independent of untrusted report titles.
    const sheetName = `组件${String(index + 1).padStart(2, "0")}`;
    row(cover, sheetName, `${block.section}：${block.title}`);
    const sheet = book.addWorksheet(sheetName);
    title(sheet, block.title);
    row(sheet, "报表分区", block.section);
    row(sheet, "数据来源", block.source);
    row(sheet, "分组维度", block.dimension);
    row(sheet, "统计指标", block.metric);
    row(sheet, "汇总方式", block.aggregation);
    row(sheet, "筛选条件", block.filters.length ? block.filters.join("；") : "全部可见数据");
    if (block.matched !== undefined) row(sheet, "匹配记录数", block.matched);
    row(sheet, "分组数量", block.groupCount);
    row(sheet, "导出分组数量", block.rows.length);
    row(sheet, "整体指标（全部匹配分组）", block.overall);
    if(block.details){const d=block.details;row(sheet,'明细显示范围',`匹配${d.total}条，显示前${d.limit}条；按创建时间倒序`);sheet.addRow([]);const header=sheet.addRow(d.columns.map(c=>c.name));header.font={bold:true,color:{argb:'FFFFFFFF'}};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:teal}};for(let i=1;i<=d.columns.length;i++){sheet.getColumn(i).width=24;sheet.getColumn(i).numFmt='@';}for(const values of d.rows){const r=sheet.addRow(values);r.alignment={wrapText:true,vertical:'top'};}sheet.views=[{state:'frozen',ySplit:header.number}];sheet.pageSetup.printTitlesRow=`${header.number}:${header.number}`;sheet.pageSetup.orientation='landscape';continue;}
    if (block.pivot) {
      const pivot = block.pivot;
      row(sheet, "列维度", block.columnDimension || "列分组");
      row(sheet, "交叉范围", `共${pivot.rowCount}行×${pivot.columnCount}列，显示前${pivot.rows.length}行×${pivot.columns.length}列；行列整体指标包含未显示的数据。`);
      sheet.addRow([]);
      const header = sheet.addRow([`${block.dimension} / ${block.columnDimension || "列分组"}`, ...pivot.columns, "整体指标（全列）"]);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
      sheet.getColumn(1).width = 26;
      for (let column = 2; column <= pivot.columns.length + 2; column++) { sheet.getColumn(column).width = 24; sheet.getColumn(column).numFmt = "@"; }
      for (let i = 0; i < pivot.rows.length; i++) sheet.addRow([pivot.rows[i], ...pivot.values[i].map((value) => value ?? "—"), pivot.rowTotals[i]]);
      sheet.pageSetup.printTitlesRow=`${header.number}:${header.number}`;
      const total = sheet.addRow(["整体指标（全行）", ...pivot.columnTotals, pivot.overall]);
      total.font = { bold: true };
      sheet.views = [{ state: "frozen", ySplit: header.number, xSplit: 1 }];
      if (pivot.columns.length > 4) sheet.pageSetup.orientation = "landscape";
      continue;
    }
    if (block.groupCount > block.rows.length) row(sheet, "显示范围", `共${block.groupCount}组，导出数值排序前${block.rows.length}组。`);
    sheet.addRow([]);
    const hasX=block.rows.some(r=>r.x!==undefined);
    const header = sheet.addRow([block.dimension, block.metric,...(hasX?[block.xMetric||'X指标']:[])]);
    sheet.pageSetup.printTitlesRow=`${header.number}:${header.number}`;
    header.font = { name: "微软雅黑", bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
    header.height = 24;
    const first = header.number + 1;
    for (const entry of block.rows) {
      const added = row(sheet, entry.label, entry.value);
      if(hasX){added.getCell(3).value=entry.x??'—';added.getCell(3).numFmt='@';sheet.getColumn(3).width=24;}
      added.getCell(1).font = { name: "微软雅黑", size: 11 };
      if ((added.number - first) % 2 === 0) added.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF5F3" } };
    }
    sheet.autoFilter = { from: { row: header.number, column: 1 }, to: { row: Math.max(header.number, sheet.rowCount), column: hasX?3:2 } };
    sheet.views = [{ state: "frozen", ySplit: header.number }];
  }
  return book;
}
