const { DAY_LABELS } = require("./constants");
const {
  buildSchoolWidePlcEntries,
  enumerateTeachingSlots,
  getActiveDayConfigs,
  getExpectedWeeklyPeriods,
  getTeachingPeriodsForDay,
  isTeachingSlot,
  normalizeSettingsShape,
} = require("./schedule-config");

function toSlotKey(day, period) {
  return `${day}-${period}`;
}

function occupiesWholeSection(entry) {
  return entry.deliveryMode !== "SPLIT_GROUP" || entry.studentGroupKey === "WHOLE_CLASS";
}

function addSlot(registry, key, slotKey) {
  const slots = registry.get(key) || new Set();
  slots.add(slotKey);
  registry.set(key, slots);
}

function pushCollisionConflict(code, registry, key, entry, conflicts, message) {
  const existing = registry.get(key);
  if (!existing) {
    registry.set(key, entry);
    return;
  }

  conflicts.push({
    code,
    severity: "error",
    entityIds: [existing.id, entry.id],
    day: entry.day,
    period: entry.period,
    message,
  });
}

function pushTeacherCollisionConflict(registry, key, entry, teacherId, conflicts) {
  const existing = registry.get(key);
  if (!existing) {
    registry.set(key, {
      entryId: entry.id,
      teacherId,
      sourceLabel: entry.entryType === "PLC" ? "PLC" : "TEACHING",
    });
    return;
  }

  const message = existing.sourceLabel === "PLC"
    ? `ครู ${teacherId} ติดกิจกรรม PLC อยู่ในช่วงเวลาเดียวกัน`
    : `ครู ${teacherId} ถูกจัดสอนซ้อนในช่วงเวลาเดียวกัน`;

  conflicts.push({
    code: "TEACHER_DOUBLE_BOOKED",
    severity: "error",
    entityIds: [existing.entryId, entry.id, teacherId],
    day: entry.day,
    period: entry.period,
    message,
  });
}

function hasWholeClassOverlap(entries) {
  const wholeClassCount = entries.filter((entry) => occupiesWholeSection(entry)).length;
  return wholeClassCount > 0 && entries.length > 1;
}

function findDuplicateStudentGroups(entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.studentGroupKey, (counts.get(entry.studentGroupKey) || 0) + 1);
  }

  return [...counts.entries()].filter(([, count]) => count > 1).map(([groupKey]) => groupKey);
}

function distinctSlotCount(entries) {
  return new Set(entries.map((entry) => toSlotKey(entry.day, entry.period))).size;
}

function findSectionIdForGroup(group, context) {
  const enrollment = context.enrollments.find((item) => item.id === group.enrollmentId);
  if (!enrollment) {
    throw new Error(`กลุ่มการสอน ${group.id} ไม่มีข้อมูลอ้างอิงห้องเรียน`);
  }
  return enrollment.sectionId;
}

function entriesConflictByStudentCoverage(entry, incomingGroupKey, incomingDeliveryMode) {
  if (occupiesWholeSection(entry) || incomingDeliveryMode !== "SPLIT_GROUP" || incomingGroupKey === "WHOLE_CLASS") {
    return true;
  }

  return entry.studentGroupKey === incomingGroupKey;
}

function ensureSection(sectionId, sections) {
  const section = sections.find((item) => item.id === sectionId);
  if (!section) {
    throw new Error(`ไม่พบห้องเรียน ${sectionId}`);
  }
  return section;
}

function validateTimetable(dataset) {
  const settings = normalizeSettingsShape(dataset.settings);
  const conflicts = [];
  const teacherSlotMap = new Map();
  const roomSlotMap = new Map();
  const sectionSlotMap = new Map();
  const teacherLoad = new Map();
  const sectionDailySlots = new Map();
  const sectionWeeklySlots = new Map();
  const enrollmentSlotUsage = new Map();
  const groupSlotUsage = new Map();

  for (const plcEntry of buildSchoolWidePlcEntries(settings, dataset.teachers, { timetableId: dataset.timetableId })) {
    const slotKey = toSlotKey(plcEntry.day, plcEntry.period);
    for (const teacher of plcEntry.teachers) {
      teacherSlotMap.set(`${teacher.teacherId}:${slotKey}`, {
        entryId: plcEntry.id,
        teacherId: teacher.teacherId,
        sourceLabel: "PLC",
      });
    }
  }

  for (const entry of dataset.entries) {
    if (!isTeachingSlot(settings, entry.day, entry.period)) {
      conflicts.push({
        code: "ENTRY_OUTSIDE_TIME_STRUCTURE",
        severity: "error",
        entityIds: [entry.id, entry.sectionId],
        day: entry.day,
        period: entry.period,
        message: `คาบ ${entry.period} ใน${DAY_LABELS[entry.day] || entry.day} ไม่อยู่ในโครงสร้างเวลาที่ตั้งไว้`,
      });
      continue;
    }

    const slotKey = toSlotKey(entry.day, entry.period);
    const roomKey = `${entry.roomId}:${slotKey}`;
    const sectionKey = `${entry.sectionId}:${entry.day}:${entry.period}`;
    const dayKey = `${entry.sectionId}:${entry.day}`;

    pushCollisionConflict(
      "ROOM_DOUBLE_BOOKED",
      roomSlotMap,
      roomKey,
      entry,
      conflicts,
      "ห้องเรียนถูกใช้งานซ้อนกันในช่วงเวลาเดียวกัน",
    );

    const entriesAtSlot = sectionSlotMap.get(sectionKey) || [];
    entriesAtSlot.push(entry);
    sectionSlotMap.set(sectionKey, entriesAtSlot);

    for (const teacher of entry.teachers) {
      const teacherKey = `${teacher.teacherId}:${slotKey}`;
      pushTeacherCollisionConflict(teacherSlotMap, teacherKey, entry, teacher.teacherId, conflicts);
      teacherLoad.set(teacher.teacherId, (teacherLoad.get(teacher.teacherId) || 0) + (teacher.loadFactor || 1));
    }

    addSlot(sectionDailySlots, dayKey, slotKey);
    addSlot(sectionWeeklySlots, entry.sectionId, slotKey);
    addSlot(enrollmentSlotUsage, entry.enrollmentId, slotKey);
    addSlot(groupSlotUsage, entry.instructionalGroupId, slotKey);
  }

  for (const [sectionSlotKey, entriesAtSlot] of sectionSlotMap.entries()) {
    const [sectionId, day, rawPeriod] = sectionSlotKey.split(":");
    const period = Number(rawPeriod);

    if (hasWholeClassOverlap(entriesAtSlot)) {
      conflicts.push({
        code: "SECTION_WHOLE_CLASS_COLLISION",
        severity: "error",
        entityIds: entriesAtSlot.map((entry) => entry.id),
        day,
        period,
        message: `ห้องเรียน ${sectionId} มีคาบทั้งห้องซ้อนกับคาบอื่นในช่วงเวลาเดียวกัน`,
      });
      continue;
    }

    const duplicateGroupKeys = findDuplicateStudentGroups(entriesAtSlot);
    if (duplicateGroupKeys.length > 0) {
      conflicts.push({
        code: "SECTION_GROUP_OVERLAP",
        severity: "error",
        entityIds: entriesAtSlot.map((entry) => entry.id),
        day,
        period,
        message: `มีกลุ่มย่อยซ้ำกันในคาบเดียวกัน: ${duplicateGroupKeys.join(", ")}`,
      });
    }
  }

  for (const teacher of dataset.teachers) {
    const usedLoad = teacherLoad.get(teacher.id) || 0;
    if (usedLoad > teacher.maxPeriodsPerWeek) {
      conflicts.push({
        code: "TEACHER_OVERLOAD",
        severity: "error",
        entityIds: [teacher.id],
        message: `ครู ${teacher.fullName} ถูกจัดสอน ${usedLoad} คาบ เกินกว่าค่าสูงสุด ${teacher.maxPeriodsPerWeek} คาบ`,
      });
    }
  }

  for (const enrollment of dataset.enrollments) {
    const assignedDistinctSlots = enrollmentSlotUsage.get(enrollment.id)?.size || 0;
    if (assignedDistinctSlots !== enrollment.requiredPeriodsPerWeek) {
      conflicts.push({
        code: "MISSING_SUBJECT_PERIODS",
        severity: "error",
        entityIds: [enrollment.id, enrollment.sectionId, enrollment.subjectId],
        message: `รายวิชาในห้องเรียนนี้ถูกจัด ${assignedDistinctSlots} จาก ${enrollment.requiredPeriodsPerWeek} คาบ`,
      });
    }
  }

  for (const group of dataset.instructionalGroups) {
    const assignedGroupPeriods = groupSlotUsage.get(group.id)?.size || 0;
    if (assignedGroupPeriods !== group.requiredPeriodsPerWeek) {
      conflicts.push({
        code: "MISSING_GROUP_PERIODS",
        severity: "error",
        entityIds: [group.id, group.enrollmentId],
        message: `กลุ่ม ${group.displayName} ถูกจัด ${assignedGroupPeriods} จาก ${group.requiredPeriodsPerWeek} คาบ`,
      });
    }
  }

  const expectedWeeklyPeriods = getExpectedWeeklyPeriods(settings);
  for (const section of dataset.sections) {
    const weeklyTotal = sectionWeeklySlots.get(section.id)?.size || 0;
    if (weeklyTotal !== expectedWeeklyPeriods) {
      conflicts.push({
        code: "SECTION_WEEKLY_TOTAL_INVALID",
        severity: "error",
        entityIds: [section.id],
        message: `ห้อง ${section.grade}/${section.roomName} ถูกจัด ${weeklyTotal} คาบ จากเป้าหมาย ${expectedWeeklyPeriods} คาบต่อสัปดาห์`,
      });
    }

    for (const dayConfig of getActiveDayConfigs(settings)) {
      const totalPerDay = sectionDailySlots.get(`${section.id}:${dayConfig.dayCode}`)?.size || 0;
      if (totalPerDay !== dayConfig.teachingPeriods) {
        conflicts.push({
          code: "SECTION_DAILY_TOTAL_INVALID",
          severity: "warning",
          entityIds: [section.id],
          day: dayConfig.dayCode,
          message: `ห้อง ${section.grade}/${section.roomName} มี ${totalPerDay} คาบใน${dayConfig.label} จากที่กำหนด ${dayConfig.teachingPeriods} คาบ`,
        });
      }
    }
  }

  const assignedPeriods = [...sectionWeeklySlots.values()].reduce((sum, slots) => sum + slots.size, 0);
  const requiredPeriods = dataset.sections.length * expectedWeeklyPeriods;

  return {
    conflicts,
    summary: {
      completionRate: requiredPeriods === 0 ? 0 : Math.round((assignedPeriods / requiredPeriods) * 100),
      assignedPeriods,
      requiredPeriods,
    },
  };
}

function findSuggestedSlots(context) {
  const settings = normalizeSettingsShape(context.settings);
  const group = context.group;
  const section = ensureSection(findSectionIdForGroup(group, context), context.sections);
  const sectionEntries = context.entries.filter((entry) => entry.sectionId === section.id);
  const groupTeacherIds = new Set(group.teachers.map((teacher) => teacher.teacherId));
  const teacherEntries = [
    ...context.entries.filter((entry) =>
      entry.teachers.some((teacher) => groupTeacherIds.has(teacher.teacherId)),
    ),
    ...buildSchoolWidePlcEntries(settings, context.teachers || []).filter((entry) =>
      entry.teachers.some((teacher) => groupTeacherIds.has(teacher.teacherId)),
    ),
  ];
  const sameEnrollmentEntries = context.entries.filter((entry) => entry.enrollmentId === group.enrollmentId);
  const suggestions = [];

  for (const slot of enumerateTeachingSlots(settings)) {
    const { day, period } = slot;
    const reasons = [];
    let score = 100;
    const slotEntries = sectionEntries.filter((entry) => entry.day === day && entry.period === period);
    const sectionBlocked = slotEntries.some((entry) =>
      entriesConflictByStudentCoverage(entry, group.studentGroupKey, group.deliveryMode),
    );
    const teacherBlocked = teacherEntries.some((entry) => entry.day === day && entry.period === period);

    if (sectionBlocked || teacherBlocked) {
      continue;
    }

    const dailyExpectedPeriods = getTeachingPeriodsForDay(settings, day);
    const dailyLoad = distinctSlotCount(sectionEntries.filter((entry) => entry.day === day));
    const teacherAdjacent = teacherEntries.some((entry) => entry.day === day && Math.abs(entry.period - period) === 1);
    const sameDaySubjectCount = distinctSlotCount(sameEnrollmentEntries.filter((entry) => entry.day === day));

    if (dailyLoad < dailyExpectedPeriods) {
      score += 10;
      reasons.push("ช่วยเติมวันเรียนให้ครบตามโครงสร้างเวลา");
    }

    if (teacherAdjacent) {
      score -= 15;
      reasons.push("มีครูในกลุ่มสอนคาบติดกันอยู่แล้ว");
    }

    if (sameDaySubjectCount >= 2) {
      score -= 20;
      reasons.push("รายวิชานี้เริ่มกระจุกในวันเดียวกัน");
    }

    if (period >= Math.max(1, dailyExpectedPeriods - 1)) {
      score -= 5;
      reasons.push("เป็นช่วงปลายวัน เหมาะเป็นตัวเลือกสำรอง");
    }

    suggestions.push({ day, period, score, reasons });
  }

  return suggestions.sort((left, right) => right.score - left.score).slice(0, 8);
}

module.exports = {
  validateTimetable,
  findSuggestedSlots,
};
