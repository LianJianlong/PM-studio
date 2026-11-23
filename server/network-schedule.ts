import type {ScheduleOptions} from '../shared/p6-planning.ts';
import { schedule } from "./schedule.ts";
import {
  activeNetworkActivities,
  type NetworkDecision,
} from "../shared/network-decisions.ts";
export function scheduleNetwork(
  activities: any[],
  decisions: NetworkDecision[],
  calendar: any,
  start: string,
  options:ScheduleOptions={},
) {
  const { activities: active, excluded } = activeNetworkActivities(
    activities,
    decisions,
  );
  // Validate the complete document too: dormant alternatives must remain a valid DAG.
  const all = schedule(activities, calendar, start,'duration',options),
    current = schedule(active, calendar, start,'duration',options);
  const byId = new Map(current.activities.map((a) => [a.id, a]));
  return {
    ...current,
    activities: all.activities.map((a) => ({
      ...(byId.get(a.id) || a),
      status:a.network_status||a.status,
      inactive: excluded.has(a.id),
      critical_reason:excluded.has(a.id)?'inactive':byId.get(a.id)?.critical_reason||'none',
      near_critical:!excluded.has(a.id)&&!!byId.get(a.id)?.near_critical,
      float_critical:!excluded.has(a.id)&&!!byId.get(a.id)?.float_critical,on_longest_path:!excluded.has(a.id)&&!!byId.get(a.id)?.on_longest_path,
      critical: !excluded.has(a.id) && (byId.get(a.id)?.critical || false),
    })),
  };
}
