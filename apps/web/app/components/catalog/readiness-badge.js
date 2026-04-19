import { escapeHtml } from "../common/html.js";

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function hasPositiveNumber(value) {
  return Number(value) > 0;
}

function createStatus(tone, label, detail) {
  return {
    tone,
    label,
    detail,
  };
}

function joinMissing(parts = []) {
  return parts.filter(Boolean).join(", ");
}

function evaluateTeachersStatus(record = {}) {
  const missingRequired = [];
  if (!hasText(record.teacherCode)) {
    missingRequired.push("รหัสครู");
  }
  if (!hasText(record.fullName)) {
    missingRequired.push("ชื่อครู");
  }
  if (!hasPositiveNumber(record.maxPeriodsPerWeek)) {
    missingRequired.push("คาบสูงสุด");
  }

  if (missingRequired.length > 0) {
    return createStatus("critical", "ข้อมูลไม่ครบ", `ขาด ${joinMissing(missingRequired)}`);
  }

  const attention = [];
  if ((record.roles || []).length === 0) {
    attention.push("บทบาท");
  }
  if ((record.subjectIds || []).length === 0) {
    attention.push("วิชาที่สอน");
  }

  if (attention.length > 0) {
    return createStatus("warning", "ต้องเติมข้อมูล", `รอระบุ ${joinMissing(attention)}`);
  }

  return createStatus("ready", "พร้อมใช้งาน", `ผูกบทบาทและวิชาที่สอนแล้ว ${(record.subjectIds || []).length} วิชา`);
}

function evaluateRoomsStatus(record = {}) {
  const missingRequired = [];
  if (!hasText(record.roomCode)) {
    missingRequired.push("รหัสห้อง");
  }
  if (!hasText(record.name)) {
    missingRequired.push("ชื่อห้อง");
  }
  if (!hasPositiveNumber(record.capacity)) {
    missingRequired.push("ความจุ");
  }

  if (missingRequired.length > 0) {
    return createStatus("critical", "ข้อมูลไม่ครบ", `ขาด ${joinMissing(missingRequired)}`);
  }

  return createStatus("ready", "พร้อมใช้งาน", `รองรับ ${record.capacity} ที่นั่ง • ประเภท ${record.specialType || "-"}`);
}

function evaluateSubjectsStatus(record = {}) {
  const missingRequired = [];
  if (!hasText(record.name)) {
    missingRequired.push("ชื่อรายวิชา");
  }
  if (!hasPositiveNumber(record.weeklyPeriods)) {
    missingRequired.push("คาบต่อสัปดาห์");
  }

  if (missingRequired.length > 0) {
    return createStatus("critical", "ข้อมูลไม่ครบ", `ขาด ${joinMissing(missingRequired)}`);
  }

  const attention = [];
  if (record.subjectKind === "DEVELOPMENT_ACTIVITY") {
    if (!hasText(record.activityCategory)) {
      attention.push("ประเภทกิจกรรม");
    }
  } else {
    if (!hasText(record.subjectCode)) {
      attention.push("รหัสวิชา");
    }
    if (!hasText(record.subjectType)) {
      attention.push("ประเภทรายวิชา");
    }
    if (!hasText(record.learningArea)) {
      attention.push("กลุ่มสาระ");
    }
  }

  if (attention.length > 0) {
    return createStatus("warning", "ต้องตรวจสอบ", `รอระบุ ${joinMissing(attention)}`);
  }

  return createStatus("ready", "พร้อมเปิดสอน", `${record.weeklyPeriods} คาบ/สัปดาห์ • หน่วยกิต ${record.credits || 0}`);
}

function evaluateSectionsStatus(record = {}) {
  const missingRequired = [];
  if (!hasText(record.educationLevel)) {
    missingRequired.push("ระดับชั้น");
  }
  if (!hasText(record.grade)) {
    missingRequired.push("ชั้นปี");
  }
  if (!hasText(record.roomName)) {
    missingRequired.push("เลขห้อง");
  }
  if (!hasPositiveNumber(record.plannedPeriodsPerWeek)) {
    missingRequired.push("คาบเป้าหมาย");
  }

  if (missingRequired.length > 0) {
    return createStatus("critical", "ข้อมูลไม่ครบ", `ขาด ${joinMissing(missingRequired)}`);
  }

  const attention = [];
  if (!hasText(record.academicYear)) {
    attention.push("ปีการศึกษา");
  }
  if (!hasText(record.term)) {
    attention.push("ภาคเรียน");
  }
  if (!hasText(record.homeroomTeacherId)) {
    attention.push("ครูประจำชั้น");
  }

  if (attention.length > 0) {
    return createStatus("warning", "ต้องเติมข้อมูล", `รอระบุ ${joinMissing(attention)}`);
  }

  return createStatus("ready", "พร้อมใช้งาน", `ตั้งเป้า ${record.plannedPeriodsPerWeek} คาบ/สัปดาห์`);
}

function evaluateEnrollmentsStatus(record = {}, lookup = {}) {
  const sectionMap = lookup.sectionMap || new Map();
  const subjectMap = lookup.subjectMap || new Map();
  const teacherMap = lookup.teacherMap || new Map();
  const roomMap = lookup.roomMap || new Map();

  const missingRequired = [];
  if (!hasText(record.sectionId) || !sectionMap.has(record.sectionId)) {
    missingRequired.push("ชั้นเรียน");
  }
  if (!hasText(record.subjectId) || !subjectMap.has(record.subjectId)) {
    missingRequired.push("รายวิชา");
  }
  if (!hasPositiveNumber(record.requiredPeriodsPerWeek)) {
    missingRequired.push("คาบที่ต้องจัด");
  }

  if (missingRequired.length > 0) {
    return createStatus("critical", "ข้อมูลไม่ครบ", `ขาด ${joinMissing(missingRequired)}`);
  }

  const attention = [];
  if (!hasText(record.leadTeacherId) || !teacherMap.has(record.leadTeacherId)) {
    attention.push("ครูผู้สอนหลัก");
  }
  if (!hasText(record.preferredRoomId) || !roomMap.has(record.preferredRoomId)) {
    attention.push("ห้องหลัก");
  }

  if (attention.length > 0) {
    return createStatus("warning", "รอพร้อมจัดตาราง", `ต้องเติม ${joinMissing(attention)}`);
  }

  return createStatus("ready", "พร้อมสร้างกลุ่ม", `${record.requiredPeriodsPerWeek} คาบ/สัปดาห์ • ครูหลักและห้องหลักครบ`);
}

function evaluateInstructionalGroupsStatus(record = {}, lookup = {}) {
  const enrollmentMap = lookup.enrollmentMap || new Map();
  const roomMap = lookup.roomMap || new Map();

  const missingRequired = [];
  if (!hasText(record.enrollmentId) || !enrollmentMap.has(record.enrollmentId)) {
    missingRequired.push("แผนรายวิชา");
  }
  if (!hasText(record.groupCode)) {
    missingRequired.push("รหัสกลุ่ม");
  }
  if (!hasText(record.displayName)) {
    missingRequired.push("ชื่อกลุ่ม");
  }
  if (!hasPositiveNumber(record.requiredPeriodsPerWeek)) {
    missingRequired.push("คาบที่ต้องจัด");
  }

  if (missingRequired.length > 0) {
    return createStatus("critical", "ข้อมูลไม่ครบ", `ขาด ${joinMissing(missingRequired)}`);
  }

  const attention = [];
  if (!hasText(record.studentGroupKey)) {
    attention.push("คีย์กลุ่มผู้เรียน");
  }
  if ((record.teachers || []).length === 0) {
    attention.push("ครูผู้สอน");
  }
  if (!hasText(record.preferredRoomId) || !roomMap.has(record.preferredRoomId)) {
    attention.push("ห้องหลัก");
  }

  if (attention.length > 0) {
    return createStatus("warning", "ยังไม่พร้อมลงตาราง", `ต้องเติม ${joinMissing(attention)}`);
  }

  return createStatus("ready", "พร้อมลงตาราง", `มีครู ${(record.teachers || []).length} คน • ${record.requiredPeriodsPerWeek} คาบ/สัปดาห์`);
}

function evaluateCatalogRecordStatus(resource, record = {}, lookup = {}) {
  switch (resource) {
    case "teachers":
      return evaluateTeachersStatus(record);
    case "rooms":
      return evaluateRoomsStatus(record);
    case "subjects":
      return evaluateSubjectsStatus(record);
    case "sections":
      return evaluateSectionsStatus(record);
    case "enrollments":
      return evaluateEnrollmentsStatus(record, lookup);
    case "instructionalGroups":
      return evaluateInstructionalGroupsStatus(record, lookup);
    default:
      return createStatus("warning", "ไม่มีสถานะ", "ยังไม่กำหนดกติกาการประเมิน");
  }
}

function summarizeCatalogReadiness(resource, records = [], lookup = {}) {
  const summary = {
    totalCount: records.length,
    readyCount: 0,
    warningCount: 0,
    criticalCount: 0,
  };

  for (const record of records) {
    const status = evaluateCatalogRecordStatus(resource, record, lookup);
    if (status.tone === "ready") {
      summary.readyCount += 1;
    } else if (status.tone === "critical") {
      summary.criticalCount += 1;
    } else {
      summary.warningCount += 1;
    }
  }

  summary.attentionCount = summary.warningCount + summary.criticalCount;
  return summary;
}

function buildReadinessBadge(status = {}) {
  const toneClass = {
    ready: "is-ready",
    warning: "is-warning",
    critical: "is-critical",
  }[status.tone] || "is-warning";

  const detail = status.detail ? `<small>${escapeHtml(status.detail)}</small>` : "";
  const title = escapeHtml(status.detail || status.label || "");

  return `
    <span class="readiness-badge ${toneClass}" title="${title}">
      <strong>${escapeHtml(status.label || "ต้องตรวจสอบ")}</strong>
      ${detail}
    </span>
  `;
}

export {
  buildReadinessBadge,
  evaluateCatalogRecordStatus,
  summarizeCatalogReadiness,
};
