const CANONICAL_DAYS = [
  { value: "MON", label: "วันจันทร์", shortLabel: "จ." },
  { value: "TUE", label: "วันอังคาร", shortLabel: "อ." },
  { value: "WED", label: "วันพุธ", shortLabel: "พ." },
  { value: "THU", label: "วันพฤหัสบดี", shortLabel: "พฤ." },
  { value: "FRI", label: "วันศุกร์", shortLabel: "ศ." },
];

const DEFAULT_START_TIME = "08:30";
const DEFAULT_DURATION_MINUTES = 50;
const DEFAULT_PERIODS_PER_DAY = 6;
const DEFAULT_PLC_DURATION_MINUTES = 60;
const DEFAULT_PLC_REQUIRED_HOURS = 1;
const DEFAULT_PLC_MAX_SESSIONS = 1;

function toPositiveInteger(value, fallback, minimum = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.trunc(parsed));
}

function normalizeTimeString(value, fallback = DEFAULT_START_TIME) {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }

  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const hours = Math.max(0, Math.min(Number(match[1]), 23));
  const minutes = Math.max(0, Math.min(Number(match[2]), 59));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeStringToMinutes(value) {
  const [hours = "0", minutes = "0"] = normalizeTimeString(value).split(":");
  return Number(hours) * 60 + Number(minutes);
}

function minutesToTimeString(totalMinutes) {
  const safeMinutes = Math.max(0, Math.trunc(totalMinutes));
  const hours = Math.floor(safeMinutes / 60) % 24;
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addMinutes(timeText, minutesToAdd) {
  return minutesToTimeString(timeStringToMinutes(timeText) + Math.max(0, Math.trunc(minutesToAdd)));
}

function normalizeScheduleSettings(settings = {}) {
  const rawTimeStructure = settings.timeStructure || {};
  const rawPlcPolicy = settings.plcPolicy || {};
  const requestedActiveDays = Array.isArray(rawTimeStructure.activeDays)
    ? rawTimeStructure.activeDays.filter((dayCode) => CANONICAL_DAYS.some((day) => day.value === dayCode))
    : [];
  const activeDaySet = new Set(requestedActiveDays.length > 0 ? requestedActiveDays : CANONICAL_DAYS.map((day) => day.value));
  const defaultPeriodDurationMinutes = toPositiveInteger(
    rawTimeStructure.defaultPeriodDurationMinutes,
    DEFAULT_DURATION_MINUTES,
    30,
  );
  const defaultStartTime = normalizeTimeString(rawTimeStructure.defaultStartTime, DEFAULT_START_TIME);

  const days = CANONICAL_DAYS.map((day) => {
    const rawDay = rawTimeStructure.dayConfigs?.[day.value] || {};
    return {
      ...day,
      enabled: activeDaySet.has(day.value),
      teachingPeriods: toPositiveInteger(rawDay.teachingPeriods, DEFAULT_PERIODS_PER_DAY),
      startTime: normalizeTimeString(rawDay.startTime, defaultStartTime),
      periodDurationMinutes: toPositiveInteger(rawDay.periodDurationMinutes, defaultPeriodDurationMinutes, 30),
      label: String(rawDay.label || day.label),
      shortLabel: String(rawDay.shortLabel || day.shortLabel),
    };
  });
  const enabledDays = days.filter((day) => day.enabled);

  const requestedPlcDays = Array.isArray(rawPlcPolicy.allowedDays)
    ? rawPlcPolicy.allowedDays.filter((dayCode) => enabledDays.some((day) => day.value === dayCode))
    : [];
  const plcAllowedDays = requestedPlcDays.length > 0
    ? requestedPlcDays
    : (enabledDays.some((day) => day.value === "WED") ? ["WED"] : enabledDays[0] ? [enabledDays[0].value] : []);

  return {
    allowDifferentDailySchedule: rawTimeStructure.allowDifferentDailySchedule !== false,
    activeDays: enabledDays.map((day) => day.value),
    defaultStartTime,
    defaultPeriodDurationMinutes,
    dayConfigs: Object.fromEntries(days.map((day) => [day.value, day])),
    days: enabledDays,
    plcPolicy: {
      enabled: Boolean(rawPlcPolicy.enabled),
      schoolWide: rawPlcPolicy.schoolWide !== false,
      allowedDays: plcAllowedDays,
      durationMinutes: toPositiveInteger(rawPlcPolicy.durationMinutes, DEFAULT_PLC_DURATION_MINUTES, 30),
      requiredHoursPerWeekDefault: Number(
        Number(rawPlcPolicy.requiredHoursPerWeekDefault ?? DEFAULT_PLC_REQUIRED_HOURS).toFixed(2),
      ),
      maxSessionsPerWeek: toPositiveInteger(rawPlcPolicy.maxSessionsPerWeek, DEFAULT_PLC_MAX_SESSIONS),
      title: String(rawPlcPolicy.title || "PLC"),
      showInTeacherExports: rawPlcPolicy.showInTeacherExports !== false,
    },
  };
}

function getDayConfig(scheduleSettings, dayCode) {
  return scheduleSettings.days.find((day) => day.value === dayCode);
}

function getTeachingPeriodsForDay(scheduleSettings, dayCode) {
  return getDayConfig(scheduleSettings, dayCode)?.teachingPeriods || 0;
}

function isPlcSlot(scheduleSettings, dayCode, period) {
  return scheduleSettings.plcPolicy.enabled
    && scheduleSettings.plcPolicy.allowedDays.includes(dayCode)
    && Number(period) === getTeachingPeriodsForDay(scheduleSettings, dayCode) + 1;
}

function getSlotTimeLabel(scheduleSettings, dayCode, period, slotType = "TEACHING") {
  const day = getDayConfig(scheduleSettings, dayCode);
  if (!day) {
    return "";
  }

  if (slotType === "PLC") {
    const plcStart = addMinutes(day.startTime, day.periodDurationMinutes * day.teachingPeriods);
    const plcEnd = addMinutes(plcStart, scheduleSettings.plcPolicy.durationMinutes);
    return `${plcStart}-${plcEnd}`;
  }

  if (Number(period) < 1 || Number(period) > day.teachingPeriods) {
    return "";
  }

  const start = addMinutes(day.startTime, day.periodDurationMinutes * (Number(period) - 1));
  const end = addMinutes(start, day.periodDurationMinutes);
  return `${start}-${end}`;
}

function buildSyntheticPlcEntries(scheduleSettings, teacherId = "") {
  if (!teacherId || !scheduleSettings.plcPolicy.enabled) {
    return [];
  }

  return scheduleSettings.days
    .filter((day) => scheduleSettings.plcPolicy.allowedDays.includes(day.value))
    .map((day) => ({
      id: `plc-${teacherId}-${day.value}`,
      timetableId: "tt-current",
      enrollmentId: "",
      instructionalGroupId: "",
      sectionId: "",
      subjectId: "",
      deliveryMode: "WHOLE_CLASS",
      studentGroupKey: "PLC",
      roomId: "",
      day: day.value,
      period: day.teachingPeriods + 1,
      entryType: "PLC",
      subjectName: scheduleSettings.plcPolicy.title,
      deliveryModeLabel: "ชั่วโมง PLC",
      roomName: "ชั่วโมง PLC",
      groupName: "PLC",
      groupShortLabel: "PLC",
      timeLabel: getSlotTimeLabel(scheduleSettings, day.value, day.teachingPeriods + 1, "PLC"),
      teachers: [
        {
          teacherId,
          teachingRole: "LEAD",
          loadFactor: 0,
        },
      ],
      isSynthetic: true,
    }));
}

function buildBoardModel({ settings = {}, view = "section", scopeId = "", entries = [], decorateEntry }) {
  const scheduleSettings = normalizeScheduleSettings(settings);
  const filteredEntries = entries
    .filter((entry) => (
      view === "teacher"
        ? entry.teachers.some((teacher) => teacher.teacherId === scopeId)
        : entry.sectionId === scopeId
    ))
    .map((entry) => decorateEntry(entry));

  const teacherPlcEntries = view === "teacher"
    ? buildSyntheticPlcEntries(scheduleSettings, scopeId).map((entry) => decorateEntry(entry))
    : [];

  const visibleEntries = [...filteredEntries, ...teacherPlcEntries];
  const maxTeachingPeriods = scheduleSettings.days.reduce(
    (maxPeriods, day) => Math.max(maxPeriods, day.teachingPeriods),
    0,
  );
  const maxVisiblePeriod = visibleEntries.reduce(
    (maxPeriods, entry) => Math.max(maxPeriods, Number(entry.period) || 0),
    0,
  );
  const maxPeriod = view === "teacher" && scheduleSettings.plcPolicy.enabled
    ? Math.max(
      maxTeachingPeriods,
      maxVisiblePeriod,
      ...scheduleSettings.days
        .filter((day) => scheduleSettings.plcPolicy.allowedDays.includes(day.value))
        .map((day) => day.teachingPeriods + 1),
    )
    : Math.max(maxTeachingPeriods, maxVisiblePeriod);

  const columns = Array.from({ length: maxPeriod }, (_, index) => ({
    period: index + 1,
    label: `คาบ ${index + 1}`,
    shortLabel: `ช่วง ${index + 1}`,
  }));

  const visibleDaySet = new Set(visibleEntries.map((entry) => entry.day));
  const rowDays = CANONICAL_DAYS
    .map((day) => scheduleSettings.dayConfigs[day.value] || day)
    .filter((day) => day.enabled || visibleDaySet.has(day.value));

  const rows = rowDays.map((day) => ({
    day: day.value,
    label: day.label,
    shortLabel: day.shortLabel,
    cells: columns.map((column) => {
      const slotType = day.enabled && isPlcSlot(scheduleSettings, day.value, column.period)
        ? "PLC"
        : day.enabled && column.period <= day.teachingPeriods
          ? "TEACHING"
          : "CLOSED";

      return {
        day: day.value,
        period: column.period,
        slotType,
        label: slotType === "PLC" ? scheduleSettings.plcPolicy.title : column.label,
        timeLabel: getSlotTimeLabel(scheduleSettings, day.value, column.period, slotType),
        schedulable: slotType === "TEACHING",
        entries: visibleEntries.filter(
          (entry) => entry.day === day.value && Number(entry.period) === column.period,
        ),
      };
    }),
  }));

  return {
    columns,
    rows,
    visibleEntries,
    scheduleSettings,
  };
}

function findBoardCell(boardModel = {}, dayCode = "", period = 0) {
  const row = (boardModel.rows || []).find((item) => item.day === dayCode);
  if (!row) {
    return null;
  }

  return row.cells.find((cell) => Number(cell.period) === Number(period)) || null;
}

export {
  CANONICAL_DAYS,
  normalizeScheduleSettings,
  buildBoardModel,
  findBoardCell,
};
