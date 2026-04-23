const { randomUUID } = require("node:crypto");
const { autoSchedule } = require("./auto-scheduler");
const { applyCollaborativeMutation, claimSlotLock, heartbeatPresence, releaseSlotLock } = require("./collaboration-service");
const {
  DELIVERY_MODES,
  EDUCATION_LEVELS,
  TEACHING_ROLES,
  USER_ROLES,
} = require("./constants");
const { getExpectedWeeklyPeriods, normalizeSettingsShape } = require("./schedule-config");
const { validateTimetable } = require("./conflict-engine");
const { buildDataset, buildUnresolvedGroups, getCurrentTimetable } = require("./selectors");

function createId(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGradeValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : Number.NaN;
  }

  const text = trimString(value);
  if (!text) {
    return Number.NaN;
  }

  const digits = text.match(/\d+/);
  if (!digits) {
    return Number.NaN;
  }

  return Number(digits[0]);
}

function ensureRequired(value, label) {
  if (value === null || value === undefined) {
    throw new Error(`กรุณาระบุ ${label}`);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`กรุณาระบุ ${label}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`กรุณาระบุ ${label}`);
    }
    return;
  }

  if (!trimString(value)) {
    throw new Error(`กรุณาระบุ ${label}`);
  }
}

function ensureUnique(collection, field, value, label, currentId) {
  const normalized = trimString(value).toLowerCase();
  const duplicate = collection.find((item) => trimString(item[field]).toLowerCase() === normalized && item.id !== currentId);
  if (duplicate) {
    throw new Error(`${label} ซ้ำในระบบ`);
  }
}

function ensureRefExists(collection, id, label) {
  if (id && !collection.some((item) => item.id === id)) {
    throw new Error(`ไม่พบ ${label} ที่เลือก`);
  }
}

function ensureRequiredRef(collection, id, label) {
  ensureRequired(id, label);
  ensureRefExists(collection, id, label);
}

function normalizeTeacher(db, payload, currentId) {
  ensureRequired(payload.teacherCode, "รหัสครู");
  ensureRequired(payload.fullName, "ชื่อครู");
  ensureUnique(db.teachers, "teacherCode", payload.teacherCode, "รหัสครู", currentId);
  const subjectIds = Array.isArray(payload.subjectIds) ? payload.subjectIds.filter(Boolean) : [];
  subjectIds.forEach((subjectId) => ensureRefExists(db.subjects, subjectId, "รายวิชา"));

  return {
    id: currentId || createId("teacher"),
    teacherCode: trimString(payload.teacherCode),
    fullName: trimString(payload.fullName),
    maxPeriodsPerWeek: Math.max(1, toNumber(payload.maxPeriodsPerWeek, 24)),
    roles: (Array.isArray(payload.roles) ? payload.roles : []).filter((role) => USER_ROLES.includes(role)),
    subjectIds,
  };
}

function normalizeRoom(db, payload, currentId) {
  ensureRequired(payload.roomCode, "รหัสห้อง");
  ensureRequired(payload.name, "ชื่อห้อง");
  ensureUnique(db.rooms, "roomCode", payload.roomCode, "รหัสห้อง", currentId);
  return {
    id: currentId || createId("room"),
    roomCode: trimString(payload.roomCode),
    name: trimString(payload.name),
    specialType: trimString(payload.specialType) || "CLASSROOM",
    capacity: Math.max(1, toNumber(payload.capacity, 40)),
  };
}

function normalizeSubject(db, payload, currentId) {
  const subjectKind = trimString(payload.subjectKind) || "ACADEMIC";
  const subjectType = trimString(payload.subjectType);
  const activityCategory = trimString(payload.activityCategory);

  ensureRequired(payload.name, "ชื่อวิชา");
  if (subjectKind === "DEVELOPMENT_ACTIVITY") {
    ensureRequired(activityCategory, "ประเภทกิจกรรมพัฒนาผู้เรียน");
  } else {
    ensureRequired(payload.subjectCode, "รหัสวิชา");
    ensureRequired(payload.learningArea, "กลุ่มสาระการเรียนรู้");
    ensureRequired(subjectType, "ประเภทรายวิชา");
    ensureUnique(db.subjects, "subjectCode", payload.subjectCode, "รหัสวิชา", currentId);
  }
  return {
    id: currentId || createId("subject"),
    subjectCode: subjectKind === "DEVELOPMENT_ACTIVITY" ? "" : trimString(payload.subjectCode),
    name: trimString(payload.name),
    credits: Math.max(0, toNumber(payload.credits, 1)),
    weeklyPeriods: Math.max(1, toNumber(payload.weeklyPeriods, 1)),
    learningArea: subjectKind === "DEVELOPMENT_ACTIVITY" ? "กิจกรรมพัฒนาผู้เรียน" : trimString(payload.learningArea),
    subjectKind,
    subjectType: subjectKind === "DEVELOPMENT_ACTIVITY" ? "DEVELOPMENT_ACTIVITY" : subjectType,
    activityCategory,
    educationLevels: (Array.isArray(payload.educationLevels) ? payload.educationLevels : []).filter((level) =>
      EDUCATION_LEVELS.includes(level),
    ),
  };
}

function normalizeSection(db, payload, currentId) {
  if (!EDUCATION_LEVELS.includes(payload.educationLevel)) {
    throw new Error("ระดับการศึกษาไม่ถูกต้อง");
  }
  ensureRequired(payload.grade, "ชั้นปี");
  ensureRequired(payload.roomName, "ห้องเรียน");
  ensureRefExists(db.teachers, payload.homeroomTeacherId, "ครูประจำชั้น");
  return {
    id: currentId || createId("section"),
    educationLevel: payload.educationLevel,
    academicYear: trimString(payload.academicYear) || db.settings.academicYear,
    term: trimString(payload.term) || db.settings.term,
    grade: Math.max(1, toNumber(payload.grade, 1)),
    roomName: trimString(payload.roomName),
    plannedPeriodsPerWeek: Math.max(1, toNumber(payload.plannedPeriodsPerWeek, getExpectedWeeklyPeriods(db.settings))),
    homeroomTeacherId: payload.homeroomTeacherId || "",
  };
}

function normalizeSectionSafe(db, payload, currentId) {
  if (!EDUCATION_LEVELS.includes(payload.educationLevel)) {
    throw new Error("ระดับการศึกษาไม่ถูกต้อง");
  }

  ensureRequired(payload.grade, "ชั้นปี");
  const normalizedGrade = parseGradeValue(payload.grade);
  if (!Number.isFinite(normalizedGrade) || normalizedGrade < 1) {
    throw new Error("กรุณาระบุ ชั้นปี");
  }

  ensureRequired(payload.roomName, "ห้องเรียน");
  ensureRefExists(db.teachers, payload.homeroomTeacherId, "ครูประจำชั้น");

  return {
    id: currentId || createId("section"),
    educationLevel: payload.educationLevel,
    academicYear: trimString(payload.academicYear) || db.settings.academicYear,
    term: trimString(payload.term) || db.settings.term,
    grade: normalizedGrade,
    roomName: trimString(payload.roomName),
    plannedPeriodsPerWeek: Math.max(1, toNumber(payload.plannedPeriodsPerWeek, getExpectedWeeklyPeriods(db.settings))),
    homeroomTeacherId: payload.homeroomTeacherId || "",
  };
}

function normalizeEnrollment(db, payload, currentId) {
  ensureRequiredRef(db.sections, payload.sectionId, "ชั้นเรียน");
  ensureRequiredRef(db.subjects, payload.subjectId, "รายวิชา");
  ensureRequiredRef(db.teachers, payload.leadTeacherId, "ครูผู้สอนหลัก");
  ensureRequiredRef(db.rooms, payload.preferredRoomId, "ห้อง/สถานที่หลัก");
  return {
    id: currentId || createId("enroll"),
    sectionId: payload.sectionId,
    subjectId: payload.subjectId,
    leadTeacherId: payload.leadTeacherId,
    requiredPeriodsPerWeek: Math.max(1, toNumber(payload.requiredPeriodsPerWeek, 1)),
    preferredRoomId: payload.preferredRoomId,
    notes: trimString(payload.notes),
  };
}

function normalizeInstructionalGroup(db, payload, currentId) {
  if (!DELIVERY_MODES.includes(payload.deliveryMode)) {
    throw new Error("รูปแบบการสอนไม่ถูกต้อง");
  }
  ensureRequiredRef(db.enrollments, payload.enrollmentId, "แผนรายวิชา");
  ensureRequired(payload.groupCode, "รหัสกลุ่ม");
  ensureRequired(payload.displayName, "ชื่อกลุ่ม");
  ensureRequired(payload.studentGroupKey, "student group key");
  ensureRequiredRef(db.rooms, payload.preferredRoomId, "ห้อง/สถานที่หลัก");

  const teachers = (Array.isArray(payload.teachers) ? payload.teachers : []).map((assignment) => {
    ensureRequiredRef(db.teachers, assignment.teacherId, "ครูผู้สอน");
    if (!TEACHING_ROLES.includes(assignment.teachingRole)) {
      throw new Error("บทบาทครูไม่ถูกต้อง");
    }
    return {
      id: assignment.id || createId("agt"),
      instructionalGroupId: currentId || "",
      teacherId: assignment.teacherId,
      teachingRole: assignment.teachingRole,
      loadFactor: Math.max(0.25, toNumber(assignment.loadFactor, 1)),
    };
  });

  if (!teachers.length) {
    throw new Error("กรุณากำหนดครูผู้สอนอย่างน้อย 1 คน");
  }

  const groupId = currentId || createId("group");
  return {
    id: groupId,
    enrollmentId: payload.enrollmentId,
    groupCode: trimString(payload.groupCode),
    displayName: trimString(payload.displayName),
    deliveryMode: payload.deliveryMode,
    studentGroupKey: trimString(payload.studentGroupKey),
    requiredPeriodsPerWeek: Math.max(1, toNumber(payload.requiredPeriodsPerWeek, 1)),
    preferredRoomId: payload.preferredRoomId,
    teachers: teachers.map((assignment) => ({ ...assignment, instructionalGroupId: groupId })),
  };
}

function normalizeSettings(db, payload) {
  const currentSettings = normalizeSettingsShape(db.settings);
  const signatories = Array.isArray(payload.signatories) ? payload.signatories : currentSettings.signatories;
  const mergedSettings = {
    ...currentSettings,
    schoolName: trimString(payload.schoolName) || currentSettings.schoolName,
    schoolShortName: trimString(payload.schoolShortName) || currentSettings.schoolShortName,
    academicYear: trimString(payload.academicYear) || currentSettings.academicYear,
    term: trimString(payload.term) || currentSettings.term,
    logoPath: trimString(payload.logoPath),
    signatories: signatories.map((item) => ({
      title: trimString(item.title),
      name: trimString(item.name),
      signatureImage: trimString(item.signatureImage),
    })),
    timeStructure: payload.timeStructure || currentSettings.timeStructure,
    plcPolicy: payload.plcPolicy || currentSettings.plcPolicy,
    updatedAt: new Date().toISOString(),
  };

  return normalizeSettingsShape(mergedSettings);
}

function listByResource(db, resource) {
  return db[resource];
}

function createByResource(db, resource, payload) {
  const collection = db[resource];
  const next = normalizeByResource(db, resource, payload);
  collection.push(next);
  return next;
}

function updateByResource(db, resource, id, payload) {
  const collection = db[resource];
  const index = collection.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error("ไม่พบข้อมูลที่ต้องการแก้ไข");
  }

  const next = normalizeByResource(db, resource, { ...collection[index], ...payload }, id);
  collection[index] = next;
  return next;
}

function deleteByResource(db, resource, id) {
  if (resource === "teachers") {
    if (db.sections.some((item) => item.homeroomTeacherId === id) ||
      db.enrollments.some((item) => item.leadTeacherId === id) ||
      db.instructionalGroups.some((group) => group.teachers.some((assignment) => assignment.teacherId === id)) ||
      getCurrentTimetable(db).entries.some((entry) => entry.teachers.some((teacher) => teacher.teacherId === id))) {
      throw new Error("ไม่สามารถลบครูที่ถูกใช้งานอยู่ได้");
    }
  }

  if (resource === "rooms") {
    if (db.enrollments.some((item) => item.preferredRoomId === id) ||
      db.instructionalGroups.some((item) => item.preferredRoomId === id) ||
      getCurrentTimetable(db).entries.some((entry) => entry.roomId === id)) {
      throw new Error("ไม่สามารถลบห้องที่ถูกใช้งานอยู่ได้");
    }
  }

  if (resource === "subjects" && db.enrollments.some((item) => item.subjectId === id)) {
    throw new Error("ไม่สามารถลบรายวิชาที่ถูกใช้งานอยู่ได้");
  }

  if (resource === "sections" &&
    (db.enrollments.some((item) => item.sectionId === id) || getCurrentTimetable(db).entries.some((entry) => entry.sectionId === id))) {
    throw new Error("ไม่สามารถลบชั้นเรียนที่ยังมีการลงทะเบียนหรือคาบสอนอยู่ได้");
  }

  if (resource === "enrollments") {
    const groupIds = db.instructionalGroups.filter((group) => group.enrollmentId === id).map((group) => group.id);
    db.instructionalGroups = db.instructionalGroups.filter((group) => group.enrollmentId !== id);
    getCurrentTimetable(db).entries = getCurrentTimetable(db).entries.filter(
      (entry) => entry.enrollmentId !== id && !groupIds.includes(entry.instructionalGroupId),
    );
  }

  if (resource === "instructionalGroups") {
    getCurrentTimetable(db).entries = getCurrentTimetable(db).entries.filter((entry) => entry.instructionalGroupId !== id);
  }

  const collection = db[resource];
  const index = collection.findIndex((item) => item.id === id);
  if (index === -1) {
    throw new Error("ไม่พบข้อมูลที่ต้องการลบ");
  }

  const [deleted] = collection.splice(index, 1);
  return deleted;
}

function normalizeByResource(db, resource, payload, currentId) {
  switch (resource) {
    case "teachers":
      return normalizeTeacher(db, payload, currentId);
    case "rooms":
      return normalizeRoom(db, payload, currentId);
    case "subjects":
      return normalizeSubject(db, payload, currentId);
    case "sections":
      return normalizeSectionSafe(db, payload, currentId);
    case "enrollments":
      return normalizeEnrollment(db, payload, currentId);
    case "instructionalGroups":
      return normalizeInstructionalGroup(db, payload, currentId);
    default:
      throw new Error("resource ไม่รองรับ");
  }
}

function updateSettings(db, payload) {
  db.settings = normalizeSettings(db, payload);
  return db.settings;
}

function pruneCollaboration(db) {
  const now = Date.now();
  db.collaboration.presences = db.collaboration.presences.filter((presence) => new Date(presence.expiresAt).getTime() > now);
  db.collaboration.locks = db.collaboration.locks.filter((lock) => new Date(lock.expiresAt).getTime() > now);
}

function runAutoSchedule(db, options = {}) {
  const timetable = getCurrentTimetable(db);
  const dataset = buildDataset(db, timetable);
  const result = autoSchedule(dataset, options);
  timetable.entries = result.entries;
  timetable.unresolved = result.unresolved;
  timetable.version += 1;
  timetable.updatedAt = new Date().toISOString();
  db.collaboration.events.push({
    id: createId("evt"),
    timetableId: timetable.id,
    actorUserId: options.actorUserId || "system",
    actorDisplayName: options.actorDisplayName || "ระบบจัดตารางอัตโนมัติ",
    eventType: "BULK_AUTOSCHEDULE",
    baseVersion: Math.max(timetable.version - 1, 0),
    nextVersion: timetable.version,
    payload: {
      unresolved: result.unresolved,
      forceRebuild: Boolean(options.forceRebuild),
    },
    createdAt: new Date().toISOString(),
  });
  return result;
}

function runValidation(db) {
  return validateTimetable(buildDataset(db));
}

function applyMutation(db, mutation) {
  pruneCollaboration(db);
  const timetable = getCurrentTimetable(db);
  const state = {
    snapshot: buildDataset(db, timetable),
    presences: db.collaboration.presences,
    locks: db.collaboration.locks,
    events: db.collaboration.events,
  };

  const response = applyCollaborativeMutation(state, mutation);
  db.collaboration.presences = response.nextState.presences;
  db.collaboration.locks = response.nextState.locks;
  db.collaboration.events = response.nextState.events;

  if (response.result.ok) {
    timetable.entries = response.nextState.snapshot.entries;
    timetable.version = response.nextState.snapshot.version;
    timetable.updatedAt = new Date().toISOString();
    timetable.unresolved = buildUnresolvedGroups(db).map((item) => ({
      instructionalGroupId: item.groupId,
      remainingPeriods: item.remainingPeriods,
      reason: "ยังจัดไม่ครบตามจำนวนคาบที่กำหนด",
    }));
  }

  return response.result;
}

function joinOrHeartbeat(db, payload) {
  pruneCollaboration(db);
  const timetable = getCurrentTimetable(db);
  const nextState = heartbeatPresence(
    {
      snapshot: buildDataset(db),
      presences: db.collaboration.presences,
      locks: db.collaboration.locks,
      events: db.collaboration.events,
    },
    { ...payload, timetableId: timetable.id },
  );
  db.collaboration.presences = nextState.presences;
  return nextState.presences;
}

function claimLockOnDb(db, payload) {
  pruneCollaboration(db);
  const timetable = getCurrentTimetable(db);
  const result = claimSlotLock(
    {
      snapshot: buildDataset(db),
      presences: db.collaboration.presences,
      locks: db.collaboration.locks,
      events: db.collaboration.events,
    },
    { ...payload, timetableId: timetable.id },
  );
  db.collaboration.locks = result.locks;
  return result;
}

function releaseLockOnDb(db, lockId, userId) {
  pruneCollaboration(db);
  const nextState = releaseSlotLock(
    {
      snapshot: buildDataset(db),
      presences: db.collaboration.presences,
      locks: db.collaboration.locks,
      events: db.collaboration.events,
    },
    { lockId, userId },
  );
  db.collaboration.locks = nextState.locks;
  return nextState.locks;
}

module.exports = {
  createId,
  listByResource,
  createByResource,
  updateByResource,
  deleteByResource,
  updateSettings,
  pruneCollaboration,
  runAutoSchedule,
  runValidation,
  applyMutation,
  joinOrHeartbeat,
  claimLockOnDb,
  releaseLockOnDb,
};
