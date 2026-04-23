const { randomUUID } = require("node:crypto");
const { createDefaultPlcPolicy, createDefaultTimeStructure } = require("./schedule-config");

function id(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function createSampleDatabase() {
  const now = new Date().toISOString();
  const timeStructure = createDefaultTimeStructure();
  const plcPolicy = createDefaultPlcPolicy(timeStructure);
  plcPolicy.enabled = true;
  plcPolicy.allowedDays = ["WED"];

  const teachers = [
    {
      id: "teacher-thai",
      teacherCode: "T001",
      fullName: "ครูอรพิน ศรีสุวรรณ",
      maxPeriodsPerWeek: 24,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-thai"],
    },
    {
      id: "teacher-math",
      teacherCode: "T002",
      fullName: "ครูชลธิชา อินทรา",
      maxPeriodsPerWeek: 24,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-math"],
    },
    {
      id: "teacher-sci",
      teacherCode: "T003",
      fullName: "ครูธันวา กิตติพงศ์",
      maxPeriodsPerWeek: 22,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-science"],
    },
    {
      id: "teacher-eng",
      teacherCode: "T004",
      fullName: "ครูภัทรา บุญยืน",
      maxPeriodsPerWeek: 24,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-english"],
    },
    {
      id: "teacher-social",
      teacherCode: "T005",
      fullName: "ครูศุภชัย วงษ์สุข",
      maxPeriodsPerWeek: 24,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-social"],
    },
    {
      id: "teacher-pe",
      teacherCode: "T006",
      fullName: "ครูพีระ ศรีทอง",
      maxPeriodsPerWeek: 22,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-health"],
    },
    {
      id: "teacher-art",
      teacherCode: "T007",
      fullName: "ครูอนงค์ ขจร",
      maxPeriodsPerWeek: 20,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-art"],
    },
    {
      id: "teacher-tech",
      teacherCode: "T008",
      fullName: "ครูวริษฐา จันทร",
      maxPeriodsPerWeek: 20,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-tech"],
    },
    {
      id: "teacher-activity",
      teacherCode: "T009",
      fullName: "ครูมณีรัตน์ ใจดี",
      maxPeriodsPerWeek: 24,
      roles: ["SUBJECT_TEACHER", "ACADEMIC_MANAGER"],
      subjectIds: ["subject-activity", "subject-guidance"],
    },
    {
      id: "teacher-sci-assist",
      teacherCode: "T010",
      fullName: "ครูจิรภัทร์ นวลศรี",
      maxPeriodsPerWeek: 18,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-science"],
    },
    {
      id: "teacher-eng-2",
      teacherCode: "T011",
      fullName: "ครูภาคิน วัฒนะ",
      maxPeriodsPerWeek: 20,
      roles: ["SUBJECT_TEACHER"],
      subjectIds: ["subject-english"],
    },
    {
      id: "teacher-admin",
      teacherCode: "A001",
      fullName: "หัวหน้าวิชาการ สมพร แก้วคำ",
      maxPeriodsPerWeek: 12,
      roles: ["ADMIN", "ACADEMIC_MANAGER"],
      subjectIds: [],
    },
  ];

  const rooms = [
    { id: "room-p51", roomCode: "P51", name: "ป.5/1", specialType: "CLASSROOM", capacity: 40 },
    { id: "room-p52", roomCode: "P52", name: "ป.5/2", specialType: "CLASSROOM", capacity: 40 },
    { id: "room-m11", roomCode: "M11", name: "ม.1/1", specialType: "CLASSROOM", capacity: 45 },
    { id: "room-m21", roomCode: "M21", name: "ม.2/1", specialType: "CLASSROOM", capacity: 45 },
    { id: "room-lab1", roomCode: "LAB1", name: "ห้องวิทยาศาสตร์ 1", specialType: "SCIENCE_LAB", capacity: 36 },
    { id: "room-com", roomCode: "COM1", name: "ห้องคอมพิวเตอร์", specialType: "COMPUTER", capacity: 36 },
    { id: "room-art", roomCode: "ART1", name: "ห้องศิลปะ", specialType: "ART", capacity: 30 },
    { id: "room-hall", roomCode: "HALL", name: "หอประชุม", specialType: "HALL", capacity: 200 },
  ];

  const subjects = [
    { id: "subject-thai", subjectCode: "THA101", name: "ภาษาไทย", credits: 1, weeklyPeriods: 5, learningArea: "ภาษาไทย", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-math", subjectCode: "MAT101", name: "คณิตศาสตร์", credits: 1, weeklyPeriods: 5, learningArea: "คณิตศาสตร์", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-science", subjectCode: "SCI101", name: "วิทยาศาสตร์", credits: 1, weeklyPeriods: 4, learningArea: "วิทยาศาสตร์", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-english", subjectCode: "ENG101", name: "ภาษาอังกฤษ", credits: 1, weeklyPeriods: 4, learningArea: "ภาษาต่างประเทศ", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-social", subjectCode: "SOC101", name: "สังคมศึกษา", credits: 1, weeklyPeriods: 3, learningArea: "สังคมศึกษา", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-health", subjectCode: "HEA101", name: "สุขศึกษาและพลศึกษา", credits: 1, weeklyPeriods: 2, learningArea: "สุขศึกษา", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-art", subjectCode: "ART101", name: "ศิลปะ", credits: 1, weeklyPeriods: 2, learningArea: "ศิลปะ", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-tech", subjectCode: "TEC101", name: "เทคโนโลยีและคอมพิวเตอร์", credits: 1, weeklyPeriods: 2, learningArea: "การงานอาชีพ", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-activity", subjectCode: "ACT101", name: "กิจกรรมพัฒนาผู้เรียน", credits: 1, weeklyPeriods: 2, learningArea: "กิจกรรม", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-guidance", subjectCode: "GUI101", name: "แนะแนว/โฮมรูม", credits: 1, weeklyPeriods: 1, learningArea: "กิจกรรม", educationLevels: ["PRIMARY", "LOWER_SECONDARY"] },
    { id: "subject-reading", subjectCode: "REA101", name: "อ่านเสริม", credits: 1, weeklyPeriods: 4, learningArea: "ภาษาไทย", educationLevels: ["PRIMARY"] },
  ];

  const sections = [
    {
      id: "section-p51",
      educationLevel: "PRIMARY",
      academicYear: "2569",
      term: "1",
      grade: 5,
      roomName: "1",
      plannedPeriodsPerWeek: 30,
      homeroomTeacherId: "teacher-thai",
    },
    {
      id: "section-p52",
      educationLevel: "PRIMARY",
      academicYear: "2569",
      term: "1",
      grade: 5,
      roomName: "2",
      plannedPeriodsPerWeek: 30,
      homeroomTeacherId: "teacher-math",
    },
    {
      id: "section-m11",
      educationLevel: "LOWER_SECONDARY",
      academicYear: "2569",
      term: "1",
      grade: 1,
      roomName: "1",
      plannedPeriodsPerWeek: 30,
      homeroomTeacherId: "teacher-activity",
    },
    {
      id: "section-m21",
      educationLevel: "LOWER_SECONDARY",
      academicYear: "2569",
      term: "1",
      grade: 2,
      roomName: "1",
      plannedPeriodsPerWeek: 30,
      homeroomTeacherId: "teacher-social",
    },
  ];

  const enrollments = [];
  const instructionalGroups = [];

  function addEnrollment(sectionId, subjectId, requiredPeriodsPerWeek, leadTeacherId, preferredRoomId, notes) {
    const enrollmentId = id("enroll");
    enrollments.push({
      id: enrollmentId,
      sectionId,
      subjectId,
      leadTeacherId,
      requiredPeriodsPerWeek,
      preferredRoomId,
      notes: notes || "",
    });
    return enrollmentId;
  }

  function addGroup(enrollmentId, groupCode, displayName, deliveryMode, studentGroupKey, requiredPeriodsPerWeek, teacherAssignments, preferredRoomId) {
    instructionalGroups.push({
      id: id("group"),
      enrollmentId,
      groupCode,
      displayName,
      deliveryMode,
      studentGroupKey,
      requiredPeriodsPerWeek,
      preferredRoomId,
      teachers: teacherAssignments.map((assignment) => ({
        id: id("agt"),
        instructionalGroupId: "",
        teacherId: assignment.teacherId,
        teachingRole: assignment.teachingRole,
        loadFactor: assignment.loadFactor,
      })),
    });
    const group = instructionalGroups[instructionalGroups.length - 1];
    group.teachers = group.teachers.map((assignment) => ({
      ...assignment,
      instructionalGroupId: group.id,
    }));
    return group.id;
  }

  function addWholeClassBundle(sectionId, subjectId, periods, teacherId, preferredRoomId, notes) {
    const enrollmentId = addEnrollment(sectionId, subjectId, periods, teacherId, preferredRoomId, notes);
    addGroup(
      enrollmentId,
      "WHOLE",
      "ทั้งห้อง",
      "WHOLE_CLASS",
      "WHOLE_CLASS",
      periods,
      [{ teacherId, teachingRole: "LEAD", loadFactor: 1 }],
      preferredRoomId,
    );
  }

  function addTeamTeachingBundle(sectionId, subjectId, periods, teachersForGroup, preferredRoomId, notes) {
    const enrollmentId = addEnrollment(sectionId, subjectId, periods, teachersForGroup[0]?.teacherId, preferredRoomId, notes);
    addGroup(
      enrollmentId,
      "TEAM",
      "ทีมสอนร่วม",
      "TEAM_TEACHING",
      "WHOLE_CLASS",
      periods,
      teachersForGroup,
      preferredRoomId,
    );
  }

  function addSplitBundle(sectionId, subjectId, periods, groupA, groupB, preferredRoomId, notes) {
    const enrollmentId = addEnrollment(sectionId, subjectId, periods, groupA.teacherId, preferredRoomId, notes);
    addGroup(
      enrollmentId,
      "A",
      "กลุ่ม A",
      "SPLIT_GROUP",
      "GROUP_A",
      periods,
      [{ teacherId: groupA.teacherId, teachingRole: "LEAD", loadFactor: 1 }],
      preferredRoomId,
    );
    addGroup(
      enrollmentId,
      "B",
      "กลุ่ม B",
      "SPLIT_GROUP",
      "GROUP_B",
      periods,
      [{ teacherId: groupB.teacherId, teachingRole: "LEAD", loadFactor: 1 }],
      preferredRoomId,
    );
  }

  addWholeClassBundle("section-p51", "subject-thai", 5, "teacher-thai", "room-p51");
  addWholeClassBundle("section-p51", "subject-math", 5, "teacher-math", "room-p51");
  addWholeClassBundle("section-p51", "subject-science", 4, "teacher-sci", "room-lab1");
  addWholeClassBundle("section-p51", "subject-english", 4, "teacher-eng", "room-p51");
  addWholeClassBundle("section-p51", "subject-social", 3, "teacher-social", "room-p51");
  addWholeClassBundle("section-p51", "subject-health", 2, "teacher-pe", "room-hall");
  addWholeClassBundle("section-p51", "subject-art", 2, "teacher-art", "room-art");
  addWholeClassBundle("section-p51", "subject-tech", 2, "teacher-tech", "room-com");
  addWholeClassBundle("section-p51", "subject-activity", 2, "teacher-activity", "room-hall");
  addWholeClassBundle("section-p51", "subject-guidance", 1, "teacher-thai", "room-p51");

  addWholeClassBundle("section-p52", "subject-thai", 5, "teacher-thai", "room-p52");
  addWholeClassBundle("section-p52", "subject-math", 5, "teacher-math", "room-p52");
  addWholeClassBundle("section-p52", "subject-science", 4, "teacher-sci", "room-lab1");
  addWholeClassBundle("section-p52", "subject-english", 4, "teacher-eng", "room-p52");
  addWholeClassBundle("section-p52", "subject-social", 3, "teacher-social", "room-p52");
  addWholeClassBundle("section-p52", "subject-health", 2, "teacher-pe", "room-hall");
  addWholeClassBundle("section-p52", "subject-art", 2, "teacher-art", "room-art");
  addWholeClassBundle("section-p52", "subject-tech", 2, "teacher-tech", "room-com");
  addWholeClassBundle("section-p52", "subject-activity", 2, "teacher-activity", "room-hall");
  addWholeClassBundle("section-p52", "subject-guidance", 1, "teacher-math", "room-p52");

  addWholeClassBundle("section-m11", "subject-thai", 5, "teacher-thai", "room-m11");
  addWholeClassBundle("section-m11", "subject-math", 5, "teacher-math", "room-m11");
  addWholeClassBundle("section-m11", "subject-science", 4, "teacher-sci", "room-lab1");
  addSplitBundle("section-m11", "subject-english", 2, { teacherId: "teacher-eng" }, { teacherId: "teacher-eng-2" }, "room-m11", "แบ่งทักษะการสื่อสาร");
  addWholeClassBundle("section-m11", "subject-social", 3, "teacher-social", "room-m11");
  addWholeClassBundle("section-m11", "subject-health", 2, "teacher-pe", "room-hall");
  addWholeClassBundle("section-m11", "subject-art", 2, "teacher-art", "room-art");
  addWholeClassBundle("section-m11", "subject-tech", 2, "teacher-tech", "room-com");
  addWholeClassBundle("section-m11", "subject-activity", 4, "teacher-activity", "room-hall");
  addWholeClassBundle("section-m11", "subject-guidance", 1, "teacher-activity", "room-m11");

  addWholeClassBundle("section-m21", "subject-thai", 5, "teacher-thai", "room-m21");
  addWholeClassBundle("section-m21", "subject-math", 5, "teacher-math", "room-m21");
  addTeamTeachingBundle(
    "section-m21",
    "subject-science",
    4,
    [
      { teacherId: "teacher-sci", teachingRole: "LEAD", loadFactor: 1 },
      { teacherId: "teacher-sci-assist", teachingRole: "ASSISTANT", loadFactor: 0.5 },
    ],
    "room-lab1",
    "ปฏิบัติการใช้ครูช่วยสอน",
  );
  addSplitBundle("section-m21", "subject-english", 2, { teacherId: "teacher-eng" }, { teacherId: "teacher-eng-2" }, "room-m21");
  addWholeClassBundle("section-m21", "subject-social", 3, "teacher-social", "room-m21");
  addWholeClassBundle("section-m21", "subject-health", 2, "teacher-pe", "room-hall");
  addWholeClassBundle("section-m21", "subject-art", 2, "teacher-art", "room-art");
  addWholeClassBundle("section-m21", "subject-tech", 2, "teacher-tech", "room-com");
  addWholeClassBundle("section-m21", "subject-activity", 4, "teacher-activity", "room-hall");
  addWholeClassBundle("section-m21", "subject-guidance", 1, "teacher-social", "room-m21");

  return {
    settings: {
      schoolName: "โรงเรียนตัวอย่างวิทยา",
      schoolShortName: "TeachTable Demo School",
      academicYear: "2569",
      term: "1",
      logoPath: "",
      timeStructure,
      plcPolicy,
      signatories: [
        { title: "ผู้บริหารสถานศึกษา", name: "........................................" },
        { title: "ฝ่ายบริหารวิชาการ", name: "........................................" },
        { title: "ครูผู้สอน", name: "........................................" },
      ],
      createdAt: now,
      updatedAt: now,
    },
    teachers,
    rooms,
    subjects,
    sections,
    enrollments,
    instructionalGroups,
    timetables: [
      {
        id: "tt-current",
        name: "ตารางเรียนภาคเรียน 1/2569",
        academicYear: "2569",
        term: "1",
        status: "DRAFT",
        version: 1,
        entries: [],
        unresolved: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    collaboration: {
      presences: [],
      locks: [],
      events: [],
    },
  };
}

module.exports = {
  createSampleDatabase,
};
