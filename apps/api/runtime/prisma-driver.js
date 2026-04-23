const { createEmptyDatabase } = require("./empty-data");
const { normalizeSettingsShape } = require("./schedule-config");

let prismaClient;

function getPrismaClient() {
  if (prismaClient) {
    return prismaClient;
  }

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for Prisma runtime");
    }

    const { PrismaPg } = require("@prisma/adapter-pg");
    const { PrismaClient } = require("@prisma/client");
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    prismaClient = new PrismaClient({ adapter });
    return prismaClient;
  } catch (error) {
    const reason = error && error.message ? ` Reason: ${error.message}` : "";
    throw new Error(`Prisma client is not ready. Run \`npm run prisma:generate\` before using Prisma mode.${reason}`);
  }
}

function toDate(value) {
  return value ? new Date(value) : new Date();
}

function asText(value) {
  return value == null ? "" : String(value);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function packSchoolMetadata(settings = {}) {
  return {
    signatories: settings.signatories || [],
    timeStructure: settings.timeStructure,
    plcPolicy: settings.plcPolicy,
  };
}

function unpackSchoolMetadata(value) {
  if (Array.isArray(value)) {
    return {
      signatories: value,
      timeStructure: undefined,
      plcPolicy: undefined,
    };
  }

  const payload = value && typeof value === "object" ? value : {};
  return {
    signatories: Array.isArray(payload.signatories) ? payload.signatories : [],
    timeStructure: payload.timeStructure,
    plcPolicy: payload.plcPolicy,
  };
}

async function replacePrismaDatabase(database) {
  const prisma = getPrismaClient();
  const normalizedSettings = normalizeSettingsShape(database.settings);

  await prisma.$transaction(async (tx) => {
    await tx.timetableChangeEvent.deleteMany();
    await tx.timetableSlotLock.deleteMany();
    await tx.timetablePresence.deleteMany();
    await tx.timetableEntry.deleteMany();
    await tx.timetable.deleteMany();
    await tx.instructionalGroup.deleteMany();
    await tx.enrollment.deleteMany();
    await tx.section.deleteMany();
    await tx.subject.deleteMany();
    await tx.room.deleteMany();
    await tx.teacher.deleteMany();
    await tx.schoolSetting.deleteMany();

    await tx.schoolSetting.create({
      data: {
        id: "school",
        schoolName: asText(normalizedSettings.schoolName),
        schoolShortName: asText(normalizedSettings.schoolShortName),
        academicYear: asText(normalizedSettings.academicYear),
        term: asText(normalizedSettings.term),
        logoPath: asText(normalizedSettings.logoPath),
        signatories: packSchoolMetadata(normalizedSettings),
        createdAt: toDate(normalizedSettings.createdAt),
        updatedAt: toDate(normalizedSettings.updatedAt),
      },
    });

    for (const teacher of database.teachers) {
      await tx.teacher.create({
        data: {
          id: teacher.id,
          teacherCode: asText(teacher.teacherCode),
          fullName: asText(teacher.fullName),
          maxPeriodsPerWeek: Number(teacher.maxPeriodsPerWeek || 0),
          roles: teacher.roles || [],
          subjectIds: teacher.subjectIds || [],
        },
      });
    }

    for (const room of database.rooms) {
      await tx.room.create({
        data: {
          id: room.id,
          roomCode: asText(room.roomCode),
          name: asText(room.name),
          specialType: asText(room.specialType),
          capacity: Number(room.capacity || 0),
        },
      });
    }

    for (const subject of database.subjects) {
      await tx.subject.create({
        data: {
          id: subject.id,
          subjectCode: asText(subject.subjectCode),
          name: asText(subject.name),
          credits: Number(subject.credits || 0),
          weeklyPeriods: Number(subject.weeklyPeriods || 0),
          learningArea: asText(subject.learningArea),
          educationLevels: subject.educationLevels || [],
        },
      });
    }

    for (const section of database.sections) {
      await tx.section.create({
        data: {
          id: section.id,
          educationLevel: section.educationLevel,
          academicYear: asText(section.academicYear),
          term: asText(section.term),
          grade: Number(section.grade || 0),
          roomName: asText(section.roomName),
          plannedPeriodsPerWeek: Number(section.plannedPeriodsPerWeek || 0),
          homeroomTeacherId: asText(section.homeroomTeacherId),
        },
      });
    }

    for (const enrollment of database.enrollments) {
      await tx.enrollment.create({
        data: {
          id: enrollment.id,
          sectionId: asText(enrollment.sectionId),
          subjectId: asText(enrollment.subjectId),
          leadTeacherId: asText(enrollment.leadTeacherId),
          requiredPeriodsPerWeek: Number(enrollment.requiredPeriodsPerWeek || 0),
          preferredRoomId: asText(enrollment.preferredRoomId),
          notes: asText(enrollment.notes),
        },
      });
    }

    for (const group of database.instructionalGroups) {
      await tx.instructionalGroup.create({
        data: {
          id: group.id,
          enrollmentId: asText(group.enrollmentId),
          groupCode: asText(group.groupCode),
          displayName: asText(group.displayName),
          deliveryMode: group.deliveryMode,
          studentGroupKey: asText(group.studentGroupKey),
          requiredPeriodsPerWeek: Number(group.requiredPeriodsPerWeek || 0),
          preferredRoomId: asText(group.preferredRoomId),
          teachers: group.teachers || [],
        },
      });
    }

    for (const timetable of database.timetables) {
      await tx.timetable.create({
        data: {
          id: timetable.id,
          name: asText(timetable.name),
          academicYear: asText(timetable.academicYear),
          term: asText(timetable.term),
          status: timetable.status,
          version: Number(timetable.version || 1),
          unresolved: timetable.unresolved || [],
          createdAt: toDate(timetable.createdAt),
          updatedAt: toDate(timetable.updatedAt),
        },
      });
    }

    for (const timetable of database.timetables) {
      for (const entry of timetable.entries || []) {
        await tx.timetableEntry.create({
          data: {
            id: entry.id,
            timetableId: entry.timetableId,
            enrollmentId: entry.enrollmentId,
            instructionalGroupId: entry.instructionalGroupId,
            sectionId: entry.sectionId,
            subjectId: entry.subjectId,
            deliveryMode: entry.deliveryMode,
            studentGroupKey: asText(entry.studentGroupKey),
            roomId: entry.roomId,
            day: entry.day,
            period: Number(entry.period || 0),
            teachers: entry.teachers || [],
            revision: Number(entry.revision || 1),
            updatedByUserId: entry.updatedByUserId || null,
            updatedAt: toDate(entry.updatedAt || timetable.updatedAt),
          },
        });
      }
    }

    for (const presence of database.collaboration.presences || []) {
      await tx.timetablePresence.create({
        data: {
          id: presence.id,
          timetableId: presence.timetableId,
          userId: presence.userId,
          displayName: asText(presence.displayName),
          status: asText(presence.status),
          currentView: asText(presence.currentView),
          selectedSectionId: asText(presence.selectedSectionId),
          selectedTeacherId: asText(presence.selectedTeacherId),
          colorToken: asText(presence.colorToken),
          lastSeenAt: toDate(presence.lastSeenAt),
          expiresAt: toDate(presence.expiresAt),
        },
      });
    }

    for (const lock of database.collaboration.locks || []) {
      await tx.timetableSlotLock.create({
        data: {
          id: lock.id,
          timetableId: lock.timetableId,
          userId: lock.userId,
          displayName: asText(lock.displayName),
          resourceType: asText(lock.resourceType),
          resourceId: asText(lock.resourceId),
          day: lock.day,
          period: Number(lock.period || 0),
          note: asText(lock.note),
          expiresAt: toDate(lock.expiresAt),
        },
      });
    }

    for (const event of database.collaboration.events || []) {
      await tx.timetableChangeEvent.create({
        data: {
          id: event.id,
          timetableId: event.timetableId,
          actorUserId: asText(event.actorUserId),
          actorDisplayName: asText(event.actorDisplayName),
          eventType: asText(event.eventType),
          baseVersion: Number(event.baseVersion || 0),
          nextVersion: Number(event.nextVersion || 0),
          payload: event.payload || {},
          createdAt: toDate(event.createdAt),
        },
      });
    }
  });
}

async function readPrismaDatabase() {
  const prisma = getPrismaClient();
  const [
    setting,
    teachers,
    rooms,
    subjects,
    sections,
    enrollments,
    instructionalGroups,
    timetables,
    timetableEntries,
    presences,
    locks,
    events,
  ] = await Promise.all([
    prisma.schoolSetting.findFirst(),
    prisma.teacher.findMany({ orderBy: { teacherCode: "asc" } }),
    prisma.room.findMany({ orderBy: { roomCode: "asc" } }),
    prisma.subject.findMany({ orderBy: { subjectCode: "asc" } }),
    prisma.section.findMany({ orderBy: [{ educationLevel: "asc" }, { grade: "asc" }, { roomName: "asc" }] }),
    prisma.enrollment.findMany({ orderBy: { id: "asc" } }),
    prisma.instructionalGroup.findMany({ orderBy: { id: "asc" } }),
    prisma.timetable.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.timetableEntry.findMany({ orderBy: [{ day: "asc" }, { period: "asc" }] }),
    prisma.timetablePresence.findMany({ orderBy: { lastSeenAt: "desc" } }),
    prisma.timetableSlotLock.findMany({ orderBy: [{ day: "asc" }, { period: "asc" }] }),
    prisma.timetableChangeEvent.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const entriesByTimetable = new Map();
  for (const entry of timetableEntries) {
    const current = entriesByTimetable.get(entry.timetableId) || [];
    current.push({
      id: entry.id,
      timetableId: entry.timetableId,
      enrollmentId: entry.enrollmentId,
      instructionalGroupId: entry.instructionalGroupId,
      sectionId: entry.sectionId,
      subjectId: entry.subjectId,
      deliveryMode: entry.deliveryMode,
      studentGroupKey: entry.studentGroupKey,
      roomId: entry.roomId,
      day: entry.day,
      period: entry.period,
      teachers: entry.teachers || [],
      revision: entry.revision,
      updatedByUserId: entry.updatedByUserId || undefined,
      updatedAt: toIso(entry.updatedAt),
    });
    entriesByTimetable.set(entry.timetableId, current);
  }

  return {
    settings: setting
      ? (() => {
          const metadata = unpackSchoolMetadata(setting.signatories);
          return normalizeSettingsShape({
            schoolName: setting.schoolName,
            schoolShortName: setting.schoolShortName,
            academicYear: setting.academicYear,
            term: setting.term,
            logoPath: setting.logoPath,
            signatories: metadata.signatories,
            timeStructure: metadata.timeStructure,
            plcPolicy: metadata.plcPolicy,
            createdAt: toIso(setting.createdAt),
            updatedAt: toIso(setting.updatedAt),
          });
        })()
      : createEmptyDatabase().settings,
    teachers: teachers.map((item) => ({
      id: item.id,
      teacherCode: item.teacherCode,
      fullName: item.fullName,
      maxPeriodsPerWeek: item.maxPeriodsPerWeek,
      roles: item.roles || [],
      subjectIds: item.subjectIds || [],
    })),
    rooms: rooms.map((item) => ({
      id: item.id,
      roomCode: item.roomCode,
      name: item.name,
      specialType: item.specialType,
      capacity: item.capacity,
    })),
    subjects: subjects.map((item) => ({
      id: item.id,
      subjectCode: item.subjectCode,
      name: item.name,
      credits: item.credits,
      weeklyPeriods: item.weeklyPeriods,
      learningArea: item.learningArea,
      educationLevels: item.educationLevels || [],
    })),
    sections: sections.map((item) => ({
      id: item.id,
      educationLevel: item.educationLevel,
      academicYear: item.academicYear,
      term: item.term,
      grade: item.grade,
      roomName: item.roomName,
      plannedPeriodsPerWeek: item.plannedPeriodsPerWeek,
      homeroomTeacherId: item.homeroomTeacherId,
    })),
    enrollments: enrollments.map((item) => ({
      id: item.id,
      sectionId: item.sectionId,
      subjectId: item.subjectId,
      leadTeacherId: item.leadTeacherId,
      requiredPeriodsPerWeek: item.requiredPeriodsPerWeek,
      preferredRoomId: item.preferredRoomId,
      notes: item.notes,
    })),
    instructionalGroups: instructionalGroups.map((item) => ({
      id: item.id,
      enrollmentId: item.enrollmentId,
      groupCode: item.groupCode,
      displayName: item.displayName,
      deliveryMode: item.deliveryMode,
      studentGroupKey: item.studentGroupKey,
      requiredPeriodsPerWeek: item.requiredPeriodsPerWeek,
      preferredRoomId: item.preferredRoomId,
      teachers: item.teachers || [],
    })),
    timetables: timetables.map((item) => ({
      id: item.id,
      name: item.name,
      academicYear: item.academicYear,
      term: item.term,
      status: item.status,
      version: item.version,
      unresolved: item.unresolved || [],
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt),
      entries: entriesByTimetable.get(item.id) || [],
    })),
    collaboration: {
      presences: presences.map((item) => ({
        id: item.id,
        timetableId: item.timetableId,
        userId: item.userId,
        displayName: item.displayName,
        status: item.status,
        currentView: item.currentView || undefined,
        selectedSectionId: item.selectedSectionId || undefined,
        selectedTeacherId: item.selectedTeacherId || undefined,
        colorToken: item.colorToken || undefined,
        lastSeenAt: toIso(item.lastSeenAt),
        expiresAt: toIso(item.expiresAt),
      })),
      locks: locks.map((item) => ({
        id: item.id,
        timetableId: item.timetableId,
        userId: item.userId,
        displayName: item.displayName,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        day: item.day,
        period: item.period,
        note: item.note || undefined,
        expiresAt: toIso(item.expiresAt),
      })),
      events: events.map((item) => ({
        id: item.id,
        timetableId: item.timetableId,
        actorUserId: item.actorUserId,
        actorDisplayName: item.actorDisplayName,
        eventType: item.eventType,
        baseVersion: item.baseVersion,
        nextVersion: item.nextVersion,
        payload: item.payload || {},
        createdAt: toIso(item.createdAt),
      })),
    },
  };
}

async function ensurePrismaDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when using TEACHTABLE_STORAGE_DRIVER=prisma");
  }

  const prisma = getPrismaClient();
  await prisma.$connect();
  const count = await prisma.schoolSetting.count();
  if (count === 0) {
    await replacePrismaDatabase(createEmptyDatabase());
  }
}

async function disconnectPrisma() {
  if (prismaClient) {
    await prismaClient.$disconnect();
  }
}

module.exports = {
  getPrismaClient,
  ensurePrismaDatabase,
  readPrismaDatabase,
  replacePrismaDatabase,
  disconnectPrisma,
};
