import { escapeHtml } from "../common/html.js";

function buildStatCard(label, value, detail, tone = "") {
  return `
    <article class="catalog-stat-card ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

export function renderCatalogToolbar(targets, options = {}) {
  const {
    moduleKicker,
    moduleTitle,
    moduleDescription,
    moduleStats,
    tableKicker,
    tableTitle,
    summaryText,
  } = targets;

  const {
    moduleMeta,
    summary,
    filteredCount,
  } = options;

  if (!moduleMeta || !summary) {
    return;
  }

  moduleKicker.textContent = moduleMeta.kicker;
  moduleTitle.textContent = moduleMeta.title;
  moduleDescription.textContent = moduleMeta.description;
  tableKicker.textContent = moduleMeta.tableEyebrow;
  tableTitle.textContent = moduleMeta.tableTitle;
  summaryText.textContent = `ทั้งหมด ${summary.totalCount} รายการ • พร้อมใช้งาน ${summary.readyCount} • ต้องตรวจสอบ ${summary.attentionCount} • แสดง ${filteredCount} รายการ`;

  moduleStats.innerHTML = [
    buildStatCard("รายการทั้งหมด", summary.totalCount, "ข้อมูลในโมดูลนี้"),
    buildStatCard("พร้อมใช้งาน", summary.readyCount, "ใช้ต่อใน workflow ถัดไปได้", "is-ready"),
    buildStatCard("ต้องตรวจสอบ", summary.attentionCount, `${summary.criticalCount} รายการขาดข้อมูล • ${summary.warningCount} รายการรอเติม`, "is-attention"),
  ].join("");
}
