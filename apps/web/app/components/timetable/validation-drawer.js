import { renderValidation } from "../../../render.js";

export function renderTimetableValidationDrawer(targets, options = {}) {
  const {
    root,
    body,
    summaryRoot,
    toggleButton,
    listRoot,
  } = targets;

  const {
    open = true,
    validation = {},
  } = options;

  const conflicts = validation?.conflicts || [];
  const errorCount = conflicts.filter((item) => item.severity === "error").length;
  const warningCount = conflicts.filter((item) => item.severity === "warning").length;

  summaryRoot.textContent = conflicts.length
    ? `พบข้อผิดพลาด ${errorCount} รายการ และคำเตือน ${warningCount} รายการ`
    : "ยังไม่พบปัญหาสำคัญจากการตรวจสอบล่าสุด";
  toggleButton.textContent = open ? "ซ่อนแผงตรวจสอบ" : "แสดงแผงตรวจสอบ";

  root.classList.toggle("is-collapsed", !open);
  body.hidden = !open;

  renderValidation(listRoot, validation);
}
