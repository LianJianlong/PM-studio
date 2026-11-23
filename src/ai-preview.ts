export type PreviewCell = {
  record: string;
  field: string;
  before: any;
  after: any;
};
export function previewRows(op: any, preview: any): PreviewCell[] {
  const change = preview.data.changes?.find((c: any) => c.step === op.key),
    labels = preview.labels || {},
    out: PreviewCell[] = [];
  const before = change?.before || [],
    after = change?.after || [];
  const display=(v:any):any=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v)?preview.data?.record_labels?.[v]||'关联对象（名称未加载）':Array.isArray(v)?v.map(display):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,display(x)])):v;
  const add = (record: string, field: string, old: any, next: any) => {
    if (JSON.stringify(old) !== JSON.stringify(next))
      out.push({
        record,
        field: labels[field] || field,
        before: display(old),
        after: display(next),
      });
  };
  if (before.some((r: any) => r.columns) || after.some((r: any) => r.columns)) {
    const old = before[0]?.columns || [],
      next = after[0]?.columns || [];
    for (const id of new Set([...old, ...next].map((c: any) => c.id))) {
      const a = old.find((c: any) => c.id === id),
        b = next.find((c: any) => c.id === id);
      for (const field of new Set([
        ...Object.keys(a || {}),
        ...Object.keys(b || {}),
      ]))
        add(b?.name || a?.name || id, field, a?.[field], b?.[field]);
    }
    return out;
  }
  if (before.length || after.length) {
    for (const id of new Set([...before, ...after].map((r: any) => r.id))) {
      const a = before.find((r: any) => r.id === id),
        b = after.find((r: any) => r.id === id);
      const record =
        [b?.data?.code || a?.data?.code, b?.data?.name || a?.data?.name]
          .filter(Boolean)
          .join(" · ") || preview.data?.record_labels?.[id] || "记录";
      for (const field of new Set([
        ...Object.keys(a?.data || {}),
        ...Object.keys(b?.data || {}),
      ]))
        add(record, field, a?.data?.[field], b?.data?.[field]);
    }
    return out;
  }
  const rows = op.body?.rows || (op.body?.data ? [op.body.data] : null);
  if (rows)
    for (const [i, data] of rows.entries())
      for (const [field, value] of Object.entries(data))
        add(
          [data.code, data.name].filter(Boolean).join(" · ") || String(i + 1),
          field,
          undefined,
          value,
        );
  else
    for (const [field, value] of Object.entries(op.body || {}))
      if (!["version", "reference_expected"].includes(field))
        add(op.body?.name || "", field, undefined, value);
  return out;
}
