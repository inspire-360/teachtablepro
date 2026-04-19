import { escapeHtml } from "../common/html.js";

function buildMetricCard(item) {
  return `
    <article class="metric-card metric-card-compact tone-${escapeHtml(item.tone)} tt-soft-panel">
      <p class="metric-label">${escapeHtml(item.label)}</p>
      <p class="metric-value">${escapeHtml(item.value)}</p>
      <p class="metric-detail">${escapeHtml(item.detail)}</p>
    </article>
  `;
}

export function renderDashboardMetrics(root, { dashboard = {}, unresolvedCount = 0 } = {}) {
  if (!root) {
    return;
  }

  const items = [
    {
      label: "ครู",
      value: dashboard.teachers ?? 0,
      detail: "จำนวนครูที่พร้อมใช้งานในระบบ",
      tone: "cool",
    },
    {
      label: "ห้อง/สถานที่",
      value: dashboard.rooms ?? 0,
      detail: "พื้นที่ที่พร้อมใช้ในภาคเรียนนี้",
      tone: "warm",
    },
    {
      label: "รายวิชา",
      value: dashboard.subjects ?? 0,
      detail: "รายวิชาที่ผูกกับแผนการสอนแล้ว",
      tone: "mint",
    },
    {
      label: "กลุ่มค้างจัด",
      value: unresolvedCount,
      detail: `ความพร้อมล่าสุด ${dashboard.completionRate ?? 0}%`,
      tone: "primary",
    },
  ];

  root.innerHTML = items.map(buildMetricCard).join("");
}
