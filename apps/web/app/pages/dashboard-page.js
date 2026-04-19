import { renderDashboardFilter } from "../components/dashboard/dashboard-filter.js";
import { renderDashboardHero } from "../components/dashboard/hero-panel.js";
import { renderDashboardIssueList } from "../components/dashboard/issue-list.js";
import { renderDashboardMetrics } from "../components/dashboard/metrics-grid.js";
import { renderDashboardReadiness } from "../components/dashboard/readiness-panel.js";
import { renderDashboardTeacherLoad } from "../components/dashboard/teacher-load-panel.js";

export function renderDashboardPage(dom, model = {}) {
  renderDashboardHero(dom.dashboardHeroPanel, {
    completionRate: model.dashboard?.completionRate,
    assignedPeriods: model.dashboard?.assignedPeriods,
    requiredPeriods: model.dashboard?.requiredPeriods,
    unresolvedCount: model.unresolvedCount,
    alertCount: model.alerts?.length || 0,
    activeUsers: model.activeUsers,
    filteredLabel: model.filteredLabel,
    syncLabel: model.syncLabel,
  });

  renderDashboardFilter(dom.dashboardFilterPanel, {
    filteredLabel: model.filteredLabel,
    filterValue: model.filterValue,
    validation: model.validation,
  });

  renderDashboardMetrics(dom.metricsGrid, {
    dashboard: model.dashboard,
    unresolvedCount: model.unresolvedCount,
  });

  renderDashboardReadiness(
    {
      insightRoot: dom.dashboardInsights,
      chartRoot: dom.dashboardSectionChart,
      statusRoot: dom.sectionStatuses,
    },
    {
      completionRate: model.dashboard?.completionRate,
      assignedPeriods: model.dashboard?.assignedPeriods,
      requiredPeriods: model.dashboard?.requiredPeriods,
      unresolvedCount: model.unresolvedCount,
      alertCount: model.alerts?.length || 0,
      activeUsers: model.activeUsers,
      filteredLabel: model.filteredLabel,
      filteredStatuses: model.filteredStatuses,
      sectionChartItems: model.sectionChartItems,
    },
  );

  renderDashboardIssueList(dom.alertFeed, model.alerts || []);
  renderDashboardTeacherLoad(
    {
      chartRoot: dom.dashboardTeacherChart,
      listRoot: dom.teacherLoads,
    },
    {
      teacherChartItems: model.teacherChartItems,
      teacherFocusItems: model.teacherFocusItems,
    },
  );
}
