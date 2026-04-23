const {
  DAY_LABELS,
  DELIVERY_MODE_LABELS,
  EDUCATION_LEVEL_LABELS,
  TEACHING_ROLE_LABELS,
} = require("./constants");
const { validateTimetable, findSuggestedSlots } = require("./conflict-engine");
const { createEmptyDatabase } = require("./empty-data");
const {
  buildBoardLayout,
  buildSchoolWidePlcEntries,
  getExpectedWeeklyPeriods,
  normalizeSettingsShape,
} = require("./schedule-config");

function getCurrentTimetable(db) {
  return db.timetables[0] || createEmptyDatabase().timetables[0];
}

function buildDataset(db, timetable = getCurrentTimetable(db)) {
  return {
    timetableId: timetable.id,
    version: timetable.version,
    settings: normalizeSettingsShape(db.settings),
    teachers: db.teachers,
    rooms: db.rooms,
    sections: db.sections,
    subjects: db.subjects,
    enrollments: db.enrollments,
    instructionalGroups: db.instructionalGroups,
    entries: timetable.entries || [],
  };
}

function buildMaps(db) {
  return {
    teacherMap: new Map(db.teachers.map((item) => [item.id, item])),
    roomMap: new Map(db.rooms.map((item) => [item.id, item])),
    sectionMap: new Map(db.sections.map((item) => [item.id, item])),
    subjectMap: new Map(db.subjects.map((item) => [item.id, item])),
    enrollmentMap: new Map(db.enrollments.map((item) => [item.id, item])),
    groupMap: new Map(db.instructionalGroups.map((item) => [item.id, item])),
  };
}

function sectionLabel(section) {
  return `${section.grade}/${section.roomName}`;
}

function hashColor(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }

  const palette = ["#123d7a", "#0f766e", "#9f6d1c", "#8f1d40", "#4f46e5", "#0d9488", "#c2410c", "#0369a1"];
  return palette[Math.abs(hash) % palette.length];
}

function decorateEntry(entry, db, maps = buildMaps(db)) {
  const subject = maps.subjectMap.get(entry.subjectId);
  const room = maps.roomMap.get(entry.roomId);
  const section = maps.sectionMap.get(entry.sectionId);
  const group = maps.groupMap.get(entry.instructionalGroupId);
  const teachers = entry.teachers.map((assignment) => {
    const teacher = maps.teacherMap.get(assignment.teacherId);
    return {
      ...assignment,
      fullName: teacher?.fullName || assignment.teacherId,
      label: `${teacher?.fullName || assignment.teacherId} (${TEACHING_ROLE_LABELS[assignment.teachingRole] || assignment.teachingRole})`,
    };
  });

  return {
    ...entry,
    subjectName: entry.subjectName || subject?.name || entry.subjectId || "PLC",
    subjectCode: subject?.subjectCode || entry.subjectCode || entry.subjectId || "PLC",
    roomName: entry.roomName || room?.name || entry.roomId || "-",
    sectionName: entry.sectionName || (section ? sectionLabel(section) : entry.sectionId || "-"),
    sectionEducationLevel: section ? EDUCATION_LEVEL_LABELS[section.educationLevel] : "-",
    deliveryModeLabel: entry.deliveryModeLabel || DELIVERY_MODE_LABELS[entry.deliveryMode] || entry.deliveryMode || "-",
    groupName: entry.groupName || group?.displayName || entry.studentGroupKey || "-",
    teacherLabels: teachers.map((teacher) => teacher.label),
    teachersDetailed: teachers,
    colorTone: hashColor(entry.subjectId),
  };
}

function buildTeacherLoads(db, dataset = buildDataset(db), maps = buildMaps(db)) {
  const teacherLoadMap = new Map(db.teachers.map((teacher) => [teacher.id, 0]));
  const teachingGroupsMap = new Map(db.teachers.map((teacher) => [teacher.id, new Set()]));
  const plcLoadMap = new Map(db.teachers.map((teacher) => [teacher.id, 0]));

  for (const entry of dataset.entries) {
    for (const teacher of entry.teachers) {
      teacherLoadMap.set(teacher.teacherId, (teacherLoadMap.get(teacher.teacherId) || 0) + (teacher.loadFactor || 1));
      teachingGroupsMap.get(teacher.teacherId)?.add(entry.instructionalGroupId);
    }
  }

  for (const plcEntry of buildSchoolWidePlcEntries(dataset.settings, dataset.teachers)) {
    for (const teacher of plcEntry.teachers) {
      plcLoadMap.set(teacher.teacherId, (plcLoadMap.get(teacher.teacherId) || 0) + 1);
    }
  }

  return db.teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.fullName,
    current: Number((teacherLoadMap.get(teacher.id) || 0).toFixed(2)),
    max: teacher.maxPeriodsPerWeek,
    plcPeriods: plcLoadMap.get(teacher.id) || 0,
    subjectNames: teacher.subjectIds
      .map((subjectId) => maps.subjectMap.get(subjectId)?.name)
      .filter(Boolean),
    assignedGroups: teachingGroupsMap.get(teacher.id)?.size || 0,
  }));
}

function buildUnresolvedGroups(db, dataset = buildDataset(db), maps = buildMaps(db)) {
  const slotUsage = new Map();

  for (const entry of dataset.entries) {
    const slots = slotUsage.get(entry.instructionalGroupId) || new Set();
    slots.add(`${entry.day}:${entry.period}`);
    slotUsage.set(entry.instructionalGroupId, slots);
  }

  return db.instructionalGroups
    .map((group) => {
      const enrollment = maps.enrollmentMap.get(group.enrollmentId);
      const section = enrollment ? maps.sectionMap.get(enrollment.sectionId) : undefined;
      const subject = enrollment ? maps.subjectMap.get(enrollment.subjectId) : undefined;
      const assigned = slotUsage.get(group.id)?.size || 0;
      return {
        groupId: group.id,
        enrollmentId: group.enrollmentId,
        subjectName: subject?.name || "-",
        sectionName: section ? sectionLabel(section) : "-",
        displayName: group.displayName,
        deliveryMode: group.deliveryMode,
        deliveryModeLabel: DELIVERY_MODE_LABELS[group.deliveryMode] || group.deliveryMode,
        studentGroupKey: group.studentGroupKey,
        requiredPeriodsPerWeek: group.requiredPeriodsPerWeek,
        assignedPeriods: assigned,
        remainingPeriods: Math.max(group.requiredPeriodsPerWeek - assigned, 0),
        teachers: group.teachers.map((assignment) => maps.teacherMap.get(assignment.teacherId)?.fullName || assignment.teacherId),
      };
    })
    .filter((item) => item.remainingPeriods > 0)
    .sort((left, right) => right.remainingPeriods - left.remainingPeriods || left.sectionName.localeCompare(right.sectionName));
}

function buildSectionStatuses(db, dataset = buildDataset(db), validation = validateTimetable(dataset)) {
  const sectionSlotUsage = new Map();
  const expectedWeeklyPeriods = getExpectedWeeklyPeriods(dataset.settings);

  for (const entry of dataset.entries) {
    const slots = sectionSlotUsage.get(entry.sectionId) || new Set();
    slots.add(`${entry.day}:${entry.period}`);
    sectionSlotUsage.set(entry.sectionId, slots);
  }

  return db.sections.map((section) => {
    const assignedPeriods = sectionSlotUsage.get(section.id)?.size || 0;
    const conflicts = validation.conflicts.filter((conflict) => conflict.entityIds.includes(section.id));
    return {
      id: section.id,
      educationLevel: section.educationLevel,
      educationLevelLabel: EDUCATION_LEVEL_LABELS[section.educationLevel] || section.educationLevel,
      label: sectionLabel(section),
      assignedPeriods,
      plannedPeriodsPerWeek: expectedWeeklyPeriods,
      completionRate: expectedWeeklyPeriods === 0 ? 0 : Math.round((assignedPeriods / expectedWeeklyPeriods) * 100),
      warningCount: conflicts.filter((item) => item.severity === "warning").length,
      errorCount: conflicts.filter((item) => item.severity === "error").length,
    };
  });
}

function buildDashboardSummary(db, dataset = buildDataset(db), validation = validateTimetable(dataset)) {
  return {
    teachers: db.teachers.length,
    rooms: db.rooms.length,
    subjects: db.subjects.length,
    scheduledTimetables: db.timetables.length,
    completionRate: validation.summary.completionRate,
    assignedPeriods: validation.summary.assignedPeriods,
    requiredPeriods: validation.summary.requiredPeriods,
    alerts: validation.conflicts.slice(0, 8).map((conflict) => ({
      severity: conflict.severity,
      message: conflict.message,
      code: conflict.code,
    })),
  };
}

function getEntriesForView(db, view, entityId, dataset = buildDataset(db)) {
  if (!entityId) {
    return [];
  }

  if (view === "teacher") {
    return [
      ...dataset.entries.filter((entry) => entry.teachers.some((teacher) => teacher.teacherId === entityId)),
      ...buildSchoolWidePlcEntries(dataset.settings, dataset.teachers, {
        teacherId: entityId,
        timetableId: dataset.timetableId,
      }),
    ];
  }
  return dataset.entries.filter((entry) => entry.sectionId === entityId);
}

function listEntitiesForView(db, view) {
  if (view === "teacher") {
    return db.teachers.map((teacher) => ({
      id: teacher.id,
      label: teacher.fullName,
      educationLevelLabel: "ตารางครูผู้สอน",
    }));
  }

  return db.sections.map((section) => ({
    id: section.id,
    label: sectionLabel(section),
    educationLevelLabel: EDUCATION_LEVEL_LABELS[section.educationLevel] || section.educationLevel || "-",
  }));
}

function resolveEntityIdsForView(db, options = {}) {
  const view = options.view === "teacher" ? "teacher" : "section";
  const entities = listEntitiesForView(db, view);
  const validIds = new Set(entities.map((item) => item.id));
  const fallbackId = validIds.has(options.entityId) ? options.entityId : entities[0]?.id || "";
  const requestedIds = Array.isArray(options.entityIds) ? options.entityIds : [];

  let entityIds = [];
  if (options.scope === "all") {
    entityIds = entities.map((item) => item.id);
  } else if (options.scope === "selected") {
    entityIds = requestedIds.filter((id) => validIds.has(id));
  } else if (fallbackId) {
    entityIds = [fallbackId];
  }

  const deduped = [...new Set(entityIds)];
  if (deduped.length > 0) {
    return deduped;
  }

  return fallbackId ? [fallbackId] : [];
}

function buildTimetableMatrix(db, options, dataset = buildDataset(db), maps = buildMaps(db)) {
  const entries = getEntriesForView(db, options.view, options.entityId, dataset);
  const layout = buildBoardLayout(dataset.settings, options.view);
  const matrix = layout.days.map((dayConfig) => dayConfig.cells.map(() => []));

  for (const entry of entries) {
    const dayIndex = layout.days.findIndex((dayConfig) => dayConfig.day === entry.day);
    if (dayIndex === -1) {
      continue;
    }
    const periodIndex = Number(entry.period) - 1;
    if (!matrix[dayIndex]?.[periodIndex]) {
      continue;
    }
    matrix[dayIndex][periodIndex].push(decorateEntry(entry, db, maps));
  }

  for (const dayRows of matrix) {
    for (const cellEntries of dayRows) {
      cellEntries.sort((left, right) => left.subjectName.localeCompare(right.subjectName));
    }
  }

  return matrix;
}

function buildPrintableMatrix(db, options, dataset = buildDataset(db), maps = buildMaps(db)) {
  const layout = buildBoardLayout(dataset.settings, options.view);
  const matrix = buildTimetableMatrix(db, options, dataset, maps);

  return layout.days.map((dayConfig, dayIndex) =>
    dayConfig.cells.map((cell, periodIndex) => {
      const entries = matrix[dayIndex]?.[periodIndex] || [];
      if (entries.length === 0) {
        return cell.slotType === "CLOSED" ? "" : "-";
      }

      return entries
        .map((entry) => {
          if (entry.entryType === "PLC") {
            return `${entry.subjectName}\n${entry.timeLabel || ""}`.trim();
          }

          const teacherLine = entry.teachersDetailed.map((teacher) => teacher.fullName).join(", ");
          const groupLine = entry.studentGroupKey === "WHOLE_CLASS" ? "" : `\n${entry.groupName}`;
          return `${entry.subjectName}${groupLine}\n${teacherLine}\n${entry.roomName}`;
        })
        .join("\n----------------\n");
    }),
  );
}

function buildActivityPayload(db, timetable = getCurrentTimetable(db)) {
  return {
    version: timetable.version,
    activeUsers: db.collaboration.presences.map((presence) => ({
      userId: presence.userId,
      displayName: presence.displayName,
      currentView: presence.currentView,
      selectedSectionId: presence.selectedSectionId,
      selectedTeacherId: presence.selectedTeacherId,
      lastSeenAt: presence.lastSeenAt,
      colorToken: presence.colorToken,
    })),
    locks: db.collaboration.locks.map((lock) => ({
      lockId: lock.id,
      resourceType: lock.resourceType,
      resourceId: lock.resourceId,
      day: lock.day,
      period: lock.period,
      displayName: lock.displayName,
      expiresAt: lock.expiresAt,
      note: lock.note,
    })),
    recentEvents: [...db.collaboration.events]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 12)
      .map((event) => ({
        eventType: event.eventType,
        actorDisplayName: event.actorDisplayName,
        createdAt: event.createdAt,
      })),
  };
}

function buildBootstrapPayload(db) {
  const timetable = getCurrentTimetable(db);
  const dataset = buildDataset(db, timetable);
  const maps = buildMaps(db);
  const validation = validateTimetable(dataset);

  return {
    settings: dataset.settings,
    teachers: db.teachers,
    rooms: db.rooms,
    subjects: db.subjects,
    sections: db.sections,
    enrollments: db.enrollments,
    instructionalGroups: db.instructionalGroups,
    timetable,
    dashboard: buildDashboardSummary(db, dataset, validation),
    validation,
    teacherLoads: buildTeacherLoads(db, dataset, maps),
    sectionStatuses: buildSectionStatuses(db, dataset, validation),
    unresolvedGroups: buildUnresolvedGroups(db, dataset, maps),
    activity: buildActivityPayload(db, timetable),
  };
}

function getGroupSuggestions(db, groupId) {
  const dataset = buildDataset(db);
  const group = db.instructionalGroups.find((item) => item.id === groupId);
  if (!group) {
    throw new Error(`ไม่พบกลุ่มการสอน ${groupId}`);
  }

  return findSuggestedSlots({
    settings: dataset.settings,
    group,
    enrollments: dataset.enrollments,
    entries: dataset.entries,
    teachers: dataset.teachers,
    sections: dataset.sections,
  }).map((slot) => ({
    ...slot,
    dayLabel: DAY_LABELS[slot.day] || slot.day,
  }));
}

function resolveDefaultRoomId(db, groupId) {
  const group = db.instructionalGroups.find((item) => item.id === groupId);
  if (!group) {
    return db.rooms[0]?.id;
  }

  if (group.preferredRoomId) {
    return group.preferredRoomId;
  }

  const enrollment = db.enrollments.find((item) => item.id === group.enrollmentId);
  if (enrollment?.preferredRoomId) {
    return enrollment.preferredRoomId;
  }

  const section = enrollment ? db.sections.find((item) => item.id === enrollment.sectionId) : undefined;
  const matchingRoom = db.rooms.find((room) => room.name.endsWith(`/${section?.roomName || ""}`));
  return matchingRoom?.id || db.rooms[0]?.id;
}

function buildExportReports(db, options = {}) {
  const maps = buildMaps(db);
  const dataset = buildDataset(db);
  const view = options.view === "teacher" ? "teacher" : "section";
  const isTeacherView = view === "teacher";
  const entityIds = resolveEntityIdsForView(db, {
    view,
    scope: options.scope,
    entityId: options.entityId,
    entityIds: options.entityIds,
  });

  return entityIds.map((entityId) => {
    const entity = isTeacherView ? maps.teacherMap.get(entityId) : maps.sectionMap.get(entityId);
    const layout = buildBoardLayout(dataset.settings, view);
    return {
      view,
      entityId,
      entityLabel: isTeacherView ? entity?.fullName || entityId : entity ? sectionLabel(entity) : entityId,
      report_title: isTeacherView ? "ตารางสอนรายครู" : "ตารางเรียนประจำภาคเรียน",
      education_level: isTeacherView
        ? "ตารางครูผู้สอน"
        : entity
          ? EDUCATION_LEVEL_LABELS[entity.educationLevel] || entity.educationLevel
          : "-",
      section_name: isTeacherView ? entity?.fullName || entityId : entity ? sectionLabel(entity) : entityId,
      matrix: buildPrintableMatrix(db, { view, entityId }, dataset, maps),
      dayLabels: layout.days.map((day) => day.label),
      periodLabels: layout.columns.map((column) => column.label),
      entries: getEntriesForView(db, view, entityId, dataset),
    };
  });
}

function buildCsvPayload(db, options = {}) {
  return {
    view: options.view === "teacher" ? "teacher" : "section",
    reports: buildExportReports(db, options),
    sections: db.sections,
    subjects: db.subjects,
    teachers: db.teachers,
    rooms: db.rooms,
  };
}

function buildPdfPayload(db, options = {}) {
  const settings = normalizeSettingsShape(db.settings);
  return {
    school_name: settings.schoolName,
    term: settings.term,
    academic_year: settings.academicYear,
    printed_at: new Date().toLocaleString("th-TH"),
    logo_path: settings.logoPath || "",
    signatories: settings.signatories,
    reports: buildExportReports(db, options),
  };
}

module.exports = {
  getCurrentTimetable,
  buildDataset,
  buildMaps,
  decorateEntry,
  buildTeacherLoads,
  buildUnresolvedGroups,
  buildSectionStatuses,
  buildDashboardSummary,
  buildTimetableMatrix,
  buildPrintableMatrix,
  buildActivityPayload,
  buildBootstrapPayload,
  getGroupSuggestions,
  resolveDefaultRoomId,
  buildExportReports,
  buildCsvPayload,
  buildPdfPayload,
  getEntriesForView,
  listEntitiesForView,
  resolveEntityIdsForView,
};
