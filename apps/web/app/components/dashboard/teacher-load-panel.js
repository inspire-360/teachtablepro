import { renderDashboardBars, renderTeacherLoads } from "../../../render.js";

export function renderDashboardTeacherLoad(roots = {}, snapshot = {}) {
  const { chartRoot, listRoot } = roots;

  renderDashboardBars(chartRoot, snapshot.teacherChartItems || [], {
    valueKey: "loadPercent",
    currentKey: "current",
    totalKey: "max",
    labelKey: "name",
    emptyTitle: "ยังไม่มีข้อมูลภาระงานครู",
    emptyBody: "เพิ่มครูและคาบที่จัดแล้วเพื่อให้กราฟภาระงานเริ่มทำงาน",
    mode: "load",
  });

  renderTeacherLoads(listRoot, snapshot.teacherFocusItems || []);
}
