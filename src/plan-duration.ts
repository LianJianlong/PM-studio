import {durationSummary,durationText} from '../shared/duration-summary';
import {translateUiText as t} from './i18n';
/** One display contract for overview, scheduling, network and printed SVG. */
export function planDurationLabels(plan:any,hoursPerDay=8){
 const hours=plan?.calendar_config?.hours_per_day||hoursPerDay;
 const summary=plan?.duration_summary??durationSummary(plan?.activities||[],hours);
 const working=`${t('工作日')}：${t(durationText(summary.work_span,hours))}`;
 const calendar=`${t('自然日')}：${summary.calendar_days}${t('天')}`;
 return {working,calendar,both:`${working} · ${calendar}`};
}
