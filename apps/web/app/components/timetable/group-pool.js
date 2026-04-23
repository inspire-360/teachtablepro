import { renderGroupPool } from "../../../render.js";
import { escapeHtml } from "../common/html.js";

const GROUP_SORT_OPTIONS = [
  { value: "remaining_desc", label: "เหลือคาบมากสุด" },
  { value: "unassigned_first", label: "ยังไม่ลงคาบก่อน" },
  { value: "issues_desc", label: "มี unresolved issue" },
  { value: "subject_asc", label: "ตามวิชา" },
  { value: "section_asc", label: "ตามระดับชั้น" },
];

export function renderTimetableGroupPool(targets, options = {}) {
  const {
    sortSelect,
    summaryRoot,
    poolRoot,
  } = targets;

  const {
    unresolvedGroups = [],
    selectedGroupId = "",
    sortMode = "remaining_desc",
  } = options;

  const totalRemaining = unresolvedGroups.reduce((sum, item) => sum + Number(item.remainingPeriods || 0), 0);
  const issueCount = unresolvedGroups.filter((item) => Number(item.issueCount || 0) > 0).length;

  sortSelect.innerHTML = GROUP_SORT_OPTIONS
    .map((item) => `<option value="${escapeHtml(item.value)}" ${item.value === sortMode ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");

  summaryRoot.textContent = unresolvedGroups.length
    ? `เหลือ ${totalRemaining} คาบ จาก ${unresolvedGroups.length} กลุ่ม • มีกลุ่มที่ต้องจับตา ${issueCount} กลุ่ม`
    : "ไม่มีภาระค้างจัดในขอบเขตที่กำลังเปิดอยู่";

  renderGroupPool(poolRoot, unresolvedGroups, selectedGroupId);
}
