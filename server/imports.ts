import { Router } from "express";
import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { z } from "zod";
import {
  canWrite, canRecordAction,
  HttpError,
  requireThat,
  tableAccess,
  visibleColumns,
} from "./auth.ts";
import { id, validateRecord } from "./validation.ts";
import { isSystemField, validateValue } from "../shared/fields.ts";
import { pool } from "./db.ts";
import {
  validateForwardReferences,
  validateNewBacklinks,
} from "./references.ts";

const MAX_ROWS = 1001,
  MAX_COLS = 100;
export function parseCsv(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(value);
    value = "";
    closed = false;
    if (row.length > MAX_COLS) throw new HttpError(400, "文件超过100列");
  };
  const line = () => {
    cell();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS) throw new HttpError(400, "每批最多1000条记录");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
        closed = true;
      } else value += ch;
    } else if (ch === ",") cell();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (ch === '"' && !value && !closed) quoted = true;
    else {
      if (closed || ch === '"') throw new HttpError(400, "CSV引号格式无效");
      value += ch;
    }
    if (value.length > 100000)
      throw new HttpError(400, "CSV单元格超过100000字符");
  }
  if (quoted) throw new HttpError(400, "CSV引号未闭合");
  if (value || row.length || closed) line();
  return rows;
}

// Inspect ZIP metadata before decompressing an untrusted workbook.
async function checkZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip)
        return reject(new HttpError(400, "Excel文件损坏或格式不受支持"));
      let total = 0,
        count = 0;
      zip.on("error", () => reject(new HttpError(400, "Excel压缩内容无效")));
      zip.on("entry", (entry: yauzl.Entry) => {
        total += entry.uncompressedSize;
        count++;
        if (
          total > 8 * 1024 * 1024 ||
          count > 300 ||
          entry.generalPurposeBitFlag & 1
        ) {
          zip.close();
          reject(new HttpError(400, "Excel解压内容过大或已加密，请拆分文件"));
          return;
        }
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            zip.close();
            reject(new HttpError(400, "Excel压缩内容无效"));
            return;
          }
          let read = 0;
          stream.on("data", (chunk: Buffer) => {
            read += chunk.length;
            if (read > entry.uncompressedSize || read > 8 * 1024 * 1024) {
              stream.destroy();
              zip.close();
              reject(new HttpError(400, "Excel压缩大小校验失败"));
            }
          });
          stream.on("error", () => {
            zip.close();
            reject(new HttpError(400, "Excel压缩内容无效"));
          });
          stream.on("end", () => zip.readEntry());
        });
      });
      zip.on("end", resolve);
      zip.readEntry();
    });
  });
}

export async function parseFile(filename: string, buffer: Buffer) {
  requireThat(
    buffer.length <= 1024 * 1024 && buffer.length > 0,
    400,
    "请选择不超过1MB的文件",
  );
  let sheets: { name: string; cells: unknown[][] }[];
  if (/\.csv$/i.test(filename)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      throw new HttpError(400, "CSV请另存为UTF-8编码后重试");
    }
    sheets = [{ name: "CSV", cells: parseCsv(text) }];
  } else {
    requireThat(/\.xlsx$/i.test(filename), 400, "支持.xlsx与UTF-8 .csv文件");
    await checkZip(buffer);
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new HttpError(400, "Excel文件无法读取，请确认文件未加密且未损坏");
    }
    requireThat(workbook.worksheets.length <= 20, 400, "最多支持20个工作表");
    sheets = workbook.worksheets.map((sheet) => {
      requireThat(
        sheet.rowCount <= MAX_ROWS && sheet.columnCount <= MAX_COLS,
        400,
        "每个工作表最多1000条记录、100列",
      );
      const cells: unknown[][] = [];
      sheet.eachRow((row) => {
        const values: unknown[] = [];
        for (let col = 1; col <= sheet.columnCount; col++) {
          const cell = row.getCell(col);
          requireThat(
            cell.type !== ExcelJS.ValueType.Formula &&
              cell.type !== ExcelJS.ValueType.Error,
            400,
            `工作表「${sheet.name}」${cell.address}含公式或错误，请先粘贴为值`,
          );
          const v =
            cell.value instanceof Date
              ? cell.value.toISOString().slice(11) === "00:00:00.000Z"
                ? cell.value.toISOString().slice(0, 10)
                : cell.value.toISOString().slice(0, -1)
              : typeof cell.value === "object" && cell.value !== null
                ? cell.text
                : (cell.value ?? "");
          requireThat(
            String(v).length <= 32767,
            400,
            "Excel单元格超过32767字符",
          );
          values.push(v);
        }
        if (values.some((v) => v !== "")) cells.push(values);
      });
      return { name: sheet.name, cells };
    });
  }
  return sheets
    .filter((s) => s.cells.length)
    .map((s) => ({
      name: s.name,
      headers: s.cells[0].map(String),
      rows: s.cells.slice(1),
    }));
}

export function convertCell(value: unknown, type: string): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (type === "text") return String(value);
  if (["number", "float32", "float64"].includes(type)) {
    if (typeof value === "number") return value;
    const text = String(value).trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text))
      throw Error("需要数值（不含千位分隔符）");
    return Number(text);
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["是", "true", "1"].includes(text)) return true;
    if (["否", "false", "0"].includes(text)) return false;
    throw Error("需要是/否、true/false或1/0");
  }
  if (
    ["int64", "uint64", "decimal"].includes(type) &&
    typeof value === "number"
  )
    throw Error("精确数值列请在Excel中使用文本单元格，避免精度丢失");
  if (["json", "array", "multi_select", "reference", "backlink"].includes(type))
    return typeof value === "string" ? JSON.parse(value) : value;
  if (type === "timestamp" && /^\d{4}-\d{2}-\d{2}$/.test(String(value)))
    return String(value) + "T00:00:00";
  return String(value).trim();
}

export const imports = Router();
imports.post("/tables/:table/import-file", async (req, res) => {
  const { table, permission } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  requireThat(canRecordAction(permission,table,"create"));
  const body = z
    .object({
      filename: z.string().max(200),
      content: z
        .string()
        .max(1400000)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .parse(req.body);
  res.json({
    sheets: await parseFile(body.filename, Buffer.from(body.content, "base64")),
  });
});
imports.post("/tables/:table/import-preview", async (req, res) => {
  const { table, permission } = await tableAccess(
    req.user.id,
    id.parse(req.params.table),
  );
  requireThat(canRecordAction(permission,table,"create"));
  const body = z
    .object({
      rows: z
        .array(
          z
            .array(
              z.union([
                z.string().max(100000),
                z.number(),
                z.boolean(),
                z.null(),
              ]),
            )
            .max(100),
        )
        .min(1)
        .max(1000),
      mapping: z.record(z.string(), z.number().int().min(0).max(99)),
    })
    .parse(req.body);
  const columns = visibleColumns(permission, table);
  requireThat(
    !Object.keys(body.mapping).some((key) =>
      columns.some((f: any) => f.id === key && isSystemField(f)),
    ),
    400,
    "系统字段自动生成，不能映射导入",
  );
  requireThat(
    Object.keys(body.mapping).every((key) =>
      columns.some((f: any) => f.id === key),
    ),
  );
  const values: Record<string, unknown>[] = [],
    errors: { row: number; message: string }[] = [];
  for (const [index, row] of body.rows.entries()) {
    try {
      const mapped: Record<string, unknown> = {};
      for (const f of columns) {
        if (body.mapping[f.id] === undefined) continue;
        try {
          mapped[f.id] = convertCell(row[body.mapping[f.id]], f.type);
        } catch (error) {
          throw Error(`${f.name}：${(error as Error).message}`);
        }
      }
      // Validate against the full schema; restricted required fields cannot be bypassed.
      const validated = validateRecord(table.columns, mapped);
      await validateForwardReferences(pool, req.user.id, table, validated);
      await validateNewBacklinks(pool, req.user.id, table, mapped);
      values.push(
        Object.fromEntries(
          Object.keys(mapped).map((key) => [
            key,
            table.columns.find((f: any) => f.id === key)?.type === "backlink"
              ? validateValue(
                  table.columns.find((f: any) => f.id === key),
                  mapped[key],
                )
              : validated[key],
          ]),
        ),
      );
    } catch (error) {
      errors.push({ row: index + 2, message: (error as Error).message });
    }
  }
  res.json({
    rows: errors.length ? [] : values,
    errors,
    total: body.rows.length,
  });
});
