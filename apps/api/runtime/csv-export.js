const {
  DAY_LABELS,
  DELIVERY_MODE_LABELS,
  EDUCATION_LEVEL_LABELS,
  TEACHING_ROLE_LABELS,
} = require("./constants");

function escapeCell(cell) {
  const value = String(cell);
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}

function sectionLabel(section) {
  return section ? `${section.grade}/${section.roomName}` : "-";
}

function createLookupMaps(params) {
  return {
    sectionMap: new Map((params.sections || []).map((item) => [item.id, item])),
    subjectMap: new Map((params.subjects || []).map((item) => [item.id, item])),
    teacherMap: new Map((params.teachers || []).map((item) => [item.id, item])),
    roomMap: new Map((params.rooms || []).map((item) => [item.id, item])),
  };
}

function buildEntryRows(entries = [], maps, options = {}) {
  const prefix = options.includeScopeColumns
    ? [options.scopeLabel || "-", options.reportLabel || "-"]
    : [];

  return entries.map((entry) => {
    const section = maps.sectionMap.get(entry.sectionId);
    const subject = maps.subjectMap.get(entry.subjectId);
    const room = maps.roomMap.get(entry.roomId);
    const teacherNames = entry.teachers
      .map((assignment) => {
        const teacher = maps.teacherMap.get(assignment.teacherId);
        const label = teacher?.fullName || assignment.teacherId;
        return `${label} (${TEACHING_ROLE_LABELS[assignment.teachingRole] || assignment.teachingRole})`;
      })
      .join(" | ");

    return [
      ...prefix,
      DAY_LABELS[entry.day] || entry.day,
      entry.period,
      EDUCATION_LEVEL_LABELS[section?.educationLevel] || section?.educationLevel || "-",
      entry.sectionName || sectionLabel(section),
      entry.studentGroupKey || "-",
      entry.deliveryModeLabel || DELIVERY_MODE_LABELS[entry.deliveryMode] || entry.deliveryMode || "-",
      subject?.subjectCode || entry.subjectCode || "-",
      subject?.name || entry.subjectName || "-",
      teacherNames || "-",
      room?.name || entry.roomName || entry.roomId || "-",
    ];
  });
}

function buildCombinedCsv(params) {
  const maps = createLookupMaps(params);
  const scopeLabel = params.view === "teacher" ? "ครู" : "ห้องเรียน";
  const rows = [
    ["มุมมอง", "รายการ", "วัน", "คาบ", "ระดับชั้น", "ห้องเรียน", "กลุ่มผู้เรียน", "รูปแบบการสอน", "รหัสวิชา", "ชื่อวิชา", "ครูผู้สอน", "ห้อง"],
  ];

  for (const report of params.reports || []) {
    const entryRows = buildEntryRows(report.entries || [], maps, {
      includeScopeColumns: true,
      scopeLabel,
      reportLabel: report.entityLabel || report.section_name || report.entityId,
    });

    if (entryRows.length > 0) {
      rows.push(...entryRows);
      continue;
    }

    rows.push([scopeLabel, report.entityLabel || report.section_name || report.entityId, "-", "-", "-", "-", "-", "-", "-", "-", "-", "-"]);
  }

  return rowsToCsv(rows);
}

function buildSingleCsv(params) {
  const maps = createLookupMaps(params);
  const rows = [
    ["วัน", "คาบ", "ระดับชั้น", "ห้องเรียน", "กลุ่มผู้เรียน", "รูปแบบการสอน", "รหัสวิชา", "ชื่อวิชา", "ครูผู้สอน", "ห้อง"],
    ...buildEntryRows(params.entries || [], maps),
  ];

  return rowsToCsv(rows);
}

function buildTimetableCsv(params) {
  if (Array.isArray(params.reports)) {
    return buildCombinedCsv(params);
  }

  return buildSingleCsv(params);
}

module.exports = {
  rowsToCsv,
  buildTimetableCsv,
};
