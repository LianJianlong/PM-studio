import {localizeChart,interfaceLocale} from "./i18n";
import * as echarts from "echarts/core";
import { BarChart, FunnelChart, GaugeChart, LineChart, PieChart, RadarChart, ScatterChart } from "echarts/charts";
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart, FunnelChart, GaugeChart, LineChart, PieChart, RadarChart, ScatterChart,
  GridComponent, LegendComponent, RadarComponent, TooltipComponent, SVGRenderer,
]);

export function mountReportChart(element: HTMLElement, option: unknown) {
  const chart = echarts.init(element, undefined, { renderer: "svg", locale: interfaceLocale()==='zh-CN'?'ZH':'EN' });
  chart.setOption(localizeChart(option) as echarts.EChartsCoreOption);
  return chart;
}
