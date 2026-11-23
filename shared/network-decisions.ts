export type NetworkDecision = {
  id: string;
  type: "event" | "random";
  label: string;
  branches: [string, string];
  selected: string;
  probability: number;
};
// A branch choice is persisted, never sampled during rendering or recalculation.
export function activeNetworkActivities<
  T extends {
    id: string;
    predecessors: { id: string; [key: string]: unknown }[];
  },
>(activities: T[], decisions: NetworkDecision[] = []) {
  const excluded = new Set(
    decisions.flatMap((d) => d.branches.filter((id) => id !== d.selected)),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of activities)
      if (
        !excluded.has(a.id) &&
        a.predecessors.length &&
        a.predecessors.every((d) => excluded.has(d.id))
      ) {
        excluded.add(a.id);
        changed = true;
      }
  }
  return {
    excluded,
    activities: activities
      .filter((a) => !excluded.has(a.id))
      .map((a) => ({
        ...a,
        predecessors: a.predecessors.filter((d) => !excluded.has(d.id)),
      })),
  };
}
