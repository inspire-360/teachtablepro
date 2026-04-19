export function renderDashboardFilter(root, { filteredLabel = "ทุกระดับชั้น", filterValue = "", validation = {} } = {}) {
  if (!root) {
    return;
  }

  const kicker = root.querySelector(".eyebrow");
  const title = root.querySelector(".tt-section-title");
  const note = root.querySelector("#dashboard-filter-note");
  const select = root.querySelector("#dashboard-level-filter");
  const conflicts = validation.conflicts || [];
  const errorCount = conflicts.filter((item) => item.severity === "error").length;
  const warningCount = conflicts.filter((item) => item.severity === "warning").length;

  if (kicker) {
    kicker.textContent = "Dashboard Filter";
  }

  if (title) {
    title.textContent = filterValue ? `กำลังติดตามระดับ ${filteredLabel}` : "เลือกมุมมองที่ต้องการติดตาม";
  }

  if (note) {
    note.textContent = `กำลังแสดงภาพรวม${filteredLabel} • ${errorCount} ข้อผิดพลาด • ${warningCount} คำเตือน`;
  }

  if (select) {
    select.value = filterValue;
  }
}
