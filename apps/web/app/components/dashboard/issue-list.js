import { renderAlertFeed } from "../../../render.js";
import { escapeHtml } from "../common/html.js";

export function renderDashboardIssueList(root, alerts = []) {
  if (!root) {
    return;
  }

  renderAlertFeed(root, alerts.slice(0, 5));

  if (!alerts.length) {
    return;
  }

  const errorCount = alerts.filter((item) => item.severity === "error").length;
  const warningCount = alerts.filter((item) => item.severity === "warning").length;

  root.innerHTML = `
    <article class="issue-summary-card">
      <strong>${escapeHtml(`${alerts.length} รายการที่ต้องตรวจสอบ`)}</strong>
      <p class="muted-text">${escapeHtml(`${errorCount} ข้อผิดพลาด • ${warningCount} คำเตือน`)}</p>
    </article>
    ${root.innerHTML}
  `;
}
