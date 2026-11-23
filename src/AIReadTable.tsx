import { useState } from "react";
import { translateUiValue as ui, formatUiTemplate as fmt } from "./i18n";
export default function AIReadTable({ table }: { table: any }) {
  const [page, setPage] = useState(0);
  return (
    <details open>
      <summary>
        {table.name} · {fmt("{0} 条记录", [table.total])}
      </summary>
      <div className="grid-scroll">
        <table className="data-grid">
          <thead>
            <tr>
              {table.columns.map((c: any) => (
                <th key={c.id}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(page * 50, page * 50 + 50).map((r: any) => (
              <tr key={r.id}>
                {table.columns.map((c: any) => (
                  <td
                    key={c.id}
                    style={{
                      whiteSpace: "pre-wrap",
                      maxWidth: 300,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {r.data[c.id] === null || r.data[c.id] === undefined
                      ? "—"
                      : typeof r.data[c.id] === "object"
                        ? JSON.stringify(r.data[c.id])
                        : String(r.data[c.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > 50 && (
        <div className="heading-actions">
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            {ui("上一页")}
          </button>
          <span>{page + 1}</span>
          <button
            disabled={(page + 1) * 50 >= table.rows.length}
            onClick={() => setPage((p) => p + 1)}
          >
            {ui("下一页")}
          </button>
        </div>
      )}
    </details>
  );
}
