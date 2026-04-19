import { renderDashboardBars, renderDashboardInsights, renderSectionStatuses } from "../../../render.js";

export function renderDashboardReadiness(roots = {}, snapshot = {}) {
  const { insightRoot, chartRoot, statusRoot } = roots;

  renderDashboardInsights(insightRoot, {
    completionRate: snapshot.completionRate,
    assignedPeriods: snapshot.assignedPeriods,
    requiredPeriods: snapshot.requiredPeriods,
    unresolvedCount: snapshot.unresolvedCount,
    alertCount: snapshot.alertCount,
    activeUsers: snapshot.activeUsers,
    filteredLabel: snapshot.filteredLabel,
  });

  renderDashboardBars(chartRoot, snapshot.sectionChartItems || [], {
    valueKey: "completionRate",
    currentKey: "assignedPeriods",
    totalKey: "plannedPeriodsPerWeek",
    emptyTitle: "ยังไม่มีชั้นเรียนในมุมมองนี้",
    emptyBody: "เพิ่มชั้นเรียนหรือเปลี่ยนตัวกรองเพื่อดูกราฟความครอบคลุม",
  });

  renderSectionStatuses(statusRoot, (snapshot.filteredStatuses || []).slice(0, 4));
}
