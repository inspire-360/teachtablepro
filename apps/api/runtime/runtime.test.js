const test = require("node:test");
const assert = require("node:assert/strict");

const { autoSchedule } = require("./auto-scheduler");
const { applyCollaborativeMutation, claimSlotLock } = require("./collaboration-service");
const { validateTimetable } = require("./conflict-engine");
const { buildTimetableCsv } = require("./csv-export");
const { createByResource } = require("./db-service");
const { createEmptyDatabase } = require("./empty-data");
const { createSampleDatabase } = require("./sample-data");
const { buildCsvPayload, buildDataset, buildExportReports, buildPdfPayload, getEntriesForView } = require("./selectors");

test("autoSchedule creates timetable entries from seeded data", () => {
  const db = createSampleDatabase();
  const dataset = buildDataset(db);
  const result = autoSchedule(dataset, { forceRebuild: true });

  assert.ok(result.entries.length > 0);
  assert.ok(result.completionRate >= 0);
});

test("buildDataset injects normalized time structure and PLC defaults", () => {
  const db = createEmptyDatabase();
  const dataset = buildDataset(db);

  assert.deepEqual(dataset.settings.timeStructure.activeDays, ["MON", "TUE", "WED", "THU", "FRI"]);
  assert.equal(dataset.settings.timeStructure.dayConfigs.MON.teachingPeriods, 6);
  assert.equal(dataset.settings.plcPolicy.title, "PLC");
  assert.equal(dataset.settings.plcPolicy.allowedDays[0], "WED");
});

test("validateTimetable detects teacher double booking", () => {
  const db = createSampleDatabase();
  const dataset = buildDataset(db);
  dataset.entries = [
    {
      id: "entry-1",
      timetableId: dataset.timetableId,
      enrollmentId: db.enrollments[0].id,
      instructionalGroupId: db.instructionalGroups[0].id,
      sectionId: db.enrollments[0].sectionId,
      subjectId: db.enrollments[0].subjectId,
      deliveryMode: "WHOLE_CLASS",
      studentGroupKey: "WHOLE_CLASS",
      roomId: db.rooms[0].id,
      day: "MON",
      period: 1,
      teachers: [{ teacherId: "teacher-math", teachingRole: "LEAD", loadFactor: 1 }],
    },
    {
      id: "entry-2",
      timetableId: dataset.timetableId,
      enrollmentId: db.enrollments[1].id,
      instructionalGroupId: db.instructionalGroups[1].id,
      sectionId: db.enrollments[1].sectionId,
      subjectId: db.enrollments[1].subjectId,
      deliveryMode: "WHOLE_CLASS",
      studentGroupKey: "WHOLE_CLASS",
      roomId: db.rooms[1].id,
      day: "MON",
      period: 1,
      teachers: [{ teacherId: "teacher-math", teachingRole: "LEAD", loadFactor: 1 }],
    },
  ];

  const validation = validateTimetable(dataset);
  assert.ok(validation.conflicts.some((item) => item.code === "TEACHER_DOUBLE_BOOKED"));
});

test("validateTimetable flags entries outside the configured time structure", () => {
  const db = createSampleDatabase();
  db.settings.timeStructure.dayConfigs.MON.teachingPeriods = 4;
  const dataset = buildDataset(db);
  dataset.entries = [
    {
      id: "entry-outside-slot",
      timetableId: dataset.timetableId,
      enrollmentId: db.enrollments[0].id,
      instructionalGroupId: db.instructionalGroups[0].id,
      sectionId: db.enrollments[0].sectionId,
      subjectId: db.enrollments[0].subjectId,
      deliveryMode: "WHOLE_CLASS",
      studentGroupKey: "WHOLE_CLASS",
      roomId: db.rooms[0].id,
      day: "MON",
      period: 6,
      teachers: [{ teacherId: db.teachers[0].id, teachingRole: "LEAD", loadFactor: 1 }],
    },
  ];

  const validation = validateTimetable(dataset);
  assert.ok(validation.conflicts.some((item) => item.code === "ENTRY_OUTSIDE_TIME_STRUCTURE"));
});

test("collaboration mutation increments version when locks are held", () => {
  const db = createSampleDatabase();
  const dataset = buildDataset(db);
  const group = db.instructionalGroups[0];
  const enrollment = db.enrollments.find((item) => item.id === group.enrollmentId);
  const patch = {
    enrollmentId: enrollment.id,
    instructionalGroupId: group.id,
    sectionId: enrollment.sectionId,
    subjectId: enrollment.subjectId,
    deliveryMode: group.deliveryMode,
    studentGroupKey: group.studentGroupKey,
    roomId: db.rooms[0].id,
    day: "MON",
    period: 1,
    teachers: group.teachers.map((assignment) => ({
      teacherId: assignment.teacherId,
      teachingRole: assignment.teachingRole,
      loadFactor: assignment.loadFactor,
    })),
  };

  let locks = [];
  for (const request of [
    { resourceType: "SECTION", resourceId: enrollment.sectionId },
    { resourceType: "INSTRUCTIONAL_GROUP", resourceId: group.id },
    { resourceType: "ROOM", resourceId: db.rooms[0].id },
    ...patch.teachers.map((teacher) => ({ resourceType: "TEACHER", resourceId: teacher.teacherId })),
  ]) {
    const result = claimSlotLock(
      { snapshot: dataset, presences: [], locks, events: [] },
      { ...request, timetableId: dataset.timetableId, userId: "u-1", displayName: "tester", day: "MON", period: 1 },
    );
    locks = result.locks;
  }

  const response = applyCollaborativeMutation(
    { snapshot: dataset, presences: [], locks, events: [] },
    {
      actorUserId: "u-1",
      actorDisplayName: "tester",
      timetableId: dataset.timetableId,
      baseVersion: dataset.version,
      expectedLockIds: locks.map((item) => item.id),
      patches: [patch],
    },
  );

  assert.equal(response.result.ok, true);
  assert.equal(response.result.nextVersion, dataset.version + 1);
});

test("create section accepts numeric grade and optional homeroom teacher", () => {
  const db = createEmptyDatabase();
  const created = createByResource(db, "sections", {
    educationLevel: "PRIMARY",
    grade: 1,
    roomName: "1",
    plannedPeriodsPerWeek: 30,
    academicYear: "2569",
    term: "1",
    homeroomTeacherId: "",
  });

  assert.equal(created.grade, 1);
  assert.equal(created.roomName, "1");
  assert.equal(db.sections.length, 1);
});

test("create section accepts grade labels from the form safely", () => {
  const db = createEmptyDatabase();
  const created = createByResource(db, "sections", {
    educationLevel: "PRIMARY",
    grade: "ป.4",
    roomName: "2",
    plannedPeriodsPerWeek: 30,
    academicYear: "2569",
    term: "1",
    homeroomTeacherId: "",
  });

  assert.equal(created.grade, 4);
  assert.equal(created.roomName, "2");
});

test("buildPdfPayload supports multiple selected reports", () => {
  const db = createSampleDatabase();
  const teacherIds = db.teachers.slice(0, 2).map((teacher) => teacher.id);
  const payload = buildPdfPayload(db, {
    view: "teacher",
    scope: "selected",
    entityIds: teacherIds,
  });

  assert.equal(payload.reports.length, 2);
  assert.deepEqual(payload.reports.map((report) => report.entityId), teacherIds);
});

test("teacher reports include PLC entries and dynamic period labels", () => {
  const db = createSampleDatabase();
  db.settings.timeStructure.dayConfigs.MON.teachingPeriods = 7;
  db.settings.plcPolicy.enabled = true;
  db.settings.plcPolicy.allowedDays = ["MON"];

  const teacherId = db.teachers[0].id;
  const entries = getEntriesForView(db, "teacher", teacherId);
  const report = buildExportReports(db, {
    view: "teacher",
    scope: "selected",
    entityIds: [teacherId],
  })[0];

  assert.ok(entries.some((entry) => entry.entryType === "PLC"));
  assert.equal(report.periodLabels.length, 8);
  assert.ok(report.entries.some((entry) => entry.entryType === "PLC"));
});

test("buildTimetableCsv combines selected reports into one file", () => {
  const db = createSampleDatabase();
  db.timetables[0].entries = [
    {
      id: "entry-1",
      timetableId: db.timetables[0].id,
      enrollmentId: db.enrollments[0].id,
      instructionalGroupId: db.instructionalGroups[0].id,
      sectionId: db.enrollments[0].sectionId,
      subjectId: db.enrollments[0].subjectId,
      deliveryMode: "WHOLE_CLASS",
      studentGroupKey: "WHOLE_CLASS",
      roomId: db.rooms[0].id,
      day: "MON",
      period: 1,
      teachers: [{ teacherId: db.teachers[0].id, teachingRole: "LEAD", loadFactor: 1 }],
    },
  ];

  const csv = buildTimetableCsv(buildCsvPayload(db, {
    view: "section",
    scope: "selected",
    entityIds: [db.sections[0].id],
  }));

  assert.match(csv, /มุมมอง,รายการ,/);
  assert.match(csv, /ห้องเรียน/);
});
