const { createDefaultPlcPolicy, createDefaultTimeStructure } = require("./schedule-config");

function createEmptyDatabase() {
  const now = new Date().toISOString();
  const timeStructure = createDefaultTimeStructure();
  const plcPolicy = createDefaultPlcPolicy(timeStructure);

  return {
    settings: {
      schoolName: "",
      schoolShortName: "",
      academicYear: "",
      term: "",
      logoPath: "",
      timeStructure,
      plcPolicy,
      signatories: [
        { title: "", name: "", signatureImage: "" },
        { title: "", name: "", signatureImage: "" },
        { title: "", name: "", signatureImage: "" },
      ],
      createdAt: now,
      updatedAt: now,
    },
    teachers: [],
    rooms: [],
    subjects: [],
    sections: [],
    enrollments: [],
    instructionalGroups: [],
    timetables: [
      {
        id: "tt-current",
        name: "Current timetable",
        academicYear: "",
        term: "",
        status: "DRAFT",
        version: 1,
        unresolved: [],
        createdAt: now,
        updatedAt: now,
        entries: [],
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
  createEmptyDatabase,
};
