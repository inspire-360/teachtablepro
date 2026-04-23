const { enumerateTeachingSlots } = require("./schedule-config");
const { findSuggestedSlots, validateTimetable } = require("./conflict-engine");

function findEnrollment(enrollmentId, enrollments) {
  const enrollment = enrollments.find((item) => item.id === enrollmentId);
  if (!enrollment) {
    throw new Error(`ไม่พบแผนรายวิชา ${enrollmentId}`);
  }
  return enrollment;
}

function distinctScheduledPeriods(entries, instructionalGroupId) {
  return new Set(
    entries
      .filter((entry) => entry.instructionalGroupId === instructionalGroupId)
      .map((entry) => `${entry.day}:${entry.period}`),
  ).size;
}

function pickRoomId(group, enrollment, rooms) {
  if (group.preferredRoomId) {
    return group.preferredRoomId;
  }

  if (enrollment.preferredRoomId) {
    return enrollment.preferredRoomId;
  }

  return rooms[0]?.id || "room-default";
}

function hasDuplicateGroupSameDay(entries, group, day) {
  const subjectCount = entries.filter((entry) => entry.instructionalGroupId === group.id && entry.day === day).length;
  return subjectCount >= 2;
}

function autoSchedule(dataset, options = {}) {
  const entries = options.forceRebuild ? [] : [...dataset.entries];
  const unresolved = [];

  const orderedGroups = [...dataset.instructionalGroups].sort((left, right) => {
    if (right.requiredPeriodsPerWeek !== left.requiredPeriodsPerWeek) {
      return right.requiredPeriodsPerWeek - left.requiredPeriodsPerWeek;
    }

    return right.teachers.length - left.teachers.length;
  });

  for (const group of orderedGroups) {
    if (group.teachers.length === 0) {
      unresolved.push({
        instructionalGroupId: group.id,
        remainingPeriods: group.requiredPeriodsPerWeek,
        reason: "ยังไม่ได้กำหนดครูในกลุ่มการสอนนี้",
      });
      continue;
    }

    const enrollment = findEnrollment(group.enrollmentId, dataset.enrollments);
    const alreadyPlaced = distinctScheduledPeriods(entries, group.id);
    let remaining = group.requiredPeriodsPerWeek - alreadyPlaced;

    while (remaining > 0) {
      const suggestions = findSuggestedSlots({
        settings: dataset.settings,
        group,
        enrollments: dataset.enrollments,
        entries,
        teachers: dataset.teachers,
        sections: dataset.sections,
      });

      const nextSlot = suggestions.find((slot) => !hasDuplicateGroupSameDay(entries, group, slot.day));
      if (!nextSlot) {
        unresolved.push({
          instructionalGroupId: group.id,
          remainingPeriods: remaining,
          reason: "ไม่พบคาบที่ผ่านเงื่อนไขด้านครู ห้อง และกลุ่มผู้เรียน",
        });
        break;
      }

      entries.push({
        id: `generated-${group.id}-${nextSlot.day}-${nextSlot.period}-${remaining}`,
        timetableId: dataset.timetableId || "tt-current",
        enrollmentId: group.enrollmentId,
        instructionalGroupId: group.id,
        sectionId: enrollment.sectionId,
        subjectId: enrollment.subjectId,
        deliveryMode: group.deliveryMode,
        studentGroupKey: group.studentGroupKey,
        roomId: pickRoomId(group, enrollment, dataset.rooms),
        day: nextSlot.day,
        period: nextSlot.period,
        teachers: group.teachers.map((teacher) => ({
          teacherId: teacher.teacherId,
          teachingRole: teacher.teachingRole,
          loadFactor: teacher.loadFactor,
        })),
      });

      remaining -= 1;
    }
  }

  const validation = validateTimetable({ ...dataset, entries });

  return {
    entries,
    unresolved,
    completionRate: validation.summary.completionRate,
    conflicts: validation.conflicts,
  };
}

function enumerateAllSlots(settings = {}) {
  return enumerateTeachingSlots(settings);
}

module.exports = {
  autoSchedule,
  enumerateAllSlots,
};
