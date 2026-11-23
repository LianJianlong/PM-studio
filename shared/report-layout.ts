export type ReportSections<T> = Record<"header" | "detail" | "summary" | "footer", T[]>;

export function moveReportBlock<T extends { id: string }>(
  sections: ReportSections<T>,
  blockId: string,
  target: keyof ReportSections<T>,
  beforeId?: string,
): ReportSections<T> {
  if (!blockId || blockId === beforeId) return sections;
  const source = (Object.keys(sections) as (keyof ReportSections<T>)[]).find((key) =>
    sections[key].some((block) => block.id === blockId),
  );
  if (!source) return sections;
  const block = sections[source].find((entry) => entry.id === blockId)!;
  const next = Object.fromEntries(
    (Object.keys(sections) as (keyof ReportSections<T>)[]).map((key) => [
      key,
      sections[key].filter((entry) => entry.id !== blockId),
    ]),
  ) as ReportSections<T>;
  const index = beforeId
    ? next[target].findIndex((entry) => entry.id === beforeId)
    : -1;
  next[target].splice(index < 0 ? next[target].length : index, 0, block);
  return next;
}

export function nudgeReportBlock<T extends { id: string }>(
  sections: ReportSections<T>,
  blockId: string,
  direction: -1 | 1,
): ReportSections<T> {
  const section = (Object.keys(sections) as (keyof ReportSections<T>)[]).find((key) =>
    sections[key].some((block) => block.id === blockId),
  );
  if (!section) return sections;
  const index = sections[section].findIndex((block) => block.id === blockId);
  const swap = index + direction;
  if (swap < 0 || swap >= sections[section].length) return sections;
  const next = { ...sections, [section]: [...sections[section]] };
  [next[section][index], next[section][swap]] = [next[section][swap], next[section][index]];
  return next;
}
