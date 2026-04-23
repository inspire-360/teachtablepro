const {
  DAY_LABELS,
  DAY_SHORT_LABELS,
  WEEKDAYS,
} = require("./constants");

const DEFAULT_PERIODS_PER_DAY = 6;
const DEFAULT_PERIOD_DURATION_MINUTES = 50;
const DEFAULT_START_TIME = "08:30";
const DEFAULT_PLC_DURATION_MINUTES = 60;
const DEFAULT_PLC_DAY = "WED";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInteger(value, fallback, minimum = 1) {
  return Math.max(minimum, Math.trunc(toNumber(value, fallback)));
}

function normalizeTimeString(value, fallback = DEFAULT_START_TIME) {
  const text = trimString(value);
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
  const normalized = Math.max(0, totalMinutes);
  const hours = Math.floor(normalized / 60) % 24;
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addMinutes(timeText, minutesToAdd) {
  return minutesToTimeString(timeStringToMinutes(timeText) + Math.max(0, Math.trunc(minutesToAdd)));
}

function normalizeDayConfig(dayCode, rawConfig = {}, baseDefaults = {}) {
  const label = trimString(rawConfig.label) || DAY_LABELS[dayCode] || dayCode;
  const shortLabel = trimString(rawConfig.shortLabel) || DAY_SHORT_LABELS[dayCode] || dayCode;
  const teachingPeriods = toPositiveInteger(
    rawConfig.teachingPeriods,
    baseDefaults.teachingPeriods ?? DEFAULT_PERIODS_PER_DAY,
  );
  const periodDurationMinutes = toPositiveInteger(
    rawConfig.periodDurationMinutes,
    baseDefaults.periodDurationMinutes ?? DEFAULT_PERIOD_DURATION_MINUTES,
    30,
  );

  return {
    dayCode,
    label,
    shortLabel,
    enabled: Boolean(rawConfig.enabled),
    teachingPeriods,
    startTime: normalizeTimeString(rawConfig.startTime, baseDefaults.startTime || DEFAULT_START_TIME),
    periodDurationMinutes,
  };
}

function normalizeTimeStructure(rawTimeStructure = {}) {
  const requestedActiveDays = Array.isArray(rawTimeStructure.activeDays)
    ? rawTimeStructure.activeDays.filter((dayCode) => WEEKDAYS.includes(dayCode))
    : [];
  const requestedDaySet = new Set(requestedActiveDays);
  const activeDays = requestedActiveDays.length > 0
    ? WEEKDAYS.filter((dayCode) => requestedDaySet.has(dayCode))
    : [...WEEKDAYS];
  const defaultPeriodDurationMinutes = toPositiveInteger(
    rawTimeStructure.defaultPeriodDurationMinutes,
    DEFAULT_PERIOD_DURATION_MINUTES,
    30,
  );
  const defaultStartTime = normalizeTimeString(rawTimeStructure.defaultStartTime, DEFAULT_START_TIME);
  const baseDefaults = {
    teachingPeriods: DEFAULT_PERIODS_PER_DAY,
    periodDurationMinutes: defaultPeriodDurationMinutes,
    startTime: defaultStartTime,
  };

  const dayConfigs = Object.fromEntries(
    WEEKDAYS.map((dayCode) => {
      const nextConfig = normalizeDayConfig(
        dayCode,
        rawTimeStructure.dayConfigs?.[dayCode] || {},
        baseDefaults,
      );
      nextConfig.enabled = activeDays.includes(dayCode);
      return [dayCode, nextConfig];
    }),
  );

  return {
    allowDifferentDailySchedule: rawTimeStructure.allowDifferentDailySchedule !== false,
    activeDays,
    defaultPeriodDurationMinutes,
    defaultStartTime,
    dayConfigs,
  };
}

function normalizePlcPolicy(rawPolicy = {}, timeStructure = normalizeTimeStructure()) {
  const requestedAllowedDays = Array.isArray(rawPolicy.allowedDays)
    ? rawPolicy.allowedDays.filter((dayCode) => timeStructure.activeDays.includes(dayCode))
    : [];
  const fallbackAllowedDay = timeStructure.activeDays.includes(DEFAULT_PLC_DAY)
    ? DEFAULT_PLC_DAY
    : timeStructure.activeDays[0] || "";

  return {
    enabled: Boolean(rawPolicy.enabled),
    schoolWide: rawPolicy.schoolWide !== false,
    allowedDays: requestedAllowedDays.length > 0
      ? [...new Set(requestedAllowedDays)]
      : (fallbackAllowedDay ? [fallbackAllowedDay] : []),
    durationMinutes: toPositiveInteger(rawPolicy.durationMinutes, DEFAULT_PLC_DURATION_MINUTES, 30),
    requiredHoursPerWeekDefault: Number(
      toNumber(rawPolicy.requiredHoursPerWeekDefault, 1).toFixed(2),
    ),
    maxSessionsPerWeek: toPositiveInteger(rawPolicy.maxSessionsPerWeek, 1),
    showInTeacherExports: rawPolicy.showInTeacherExports !== false,
    title: trimString(rawPolicy.title) || "PLC",
    placementMode: "AFTER_LAST_PERIOD",
  };
}

function normalizeSettingsShape(settings = {}) {
  const timeStructure = normalizeTimeStructure(settings.timeStructure || {});
  const plcPolicy = normalizePlcPolicy(settings.plcPolicy || {}, timeStructure);
  return {
    ...settings,
    timeStructure,
    plcPolicy,
  };
}

function createDefaultTimeStructure() {
  return normalizeTimeStructure();
}

function createDefaultPlcPolicy(timeStructure = createDefaultTimeStructure()) {
  return normalizePlcPolicy({}, timeStructure);
}

function getActiveDayConfigs(settings = {}) {
  const normalizedSettings = normalizeSettingsShape(settings);
  return normalizedSettings.timeStructure.activeDays
    .map((dayCode) => normalizedSettings.timeStructure.dayConfigs[dayCode])
    .filter(Boolean);
}

function getDayConfig(settings = {}, dayCode) {
  const normalizedSettings = normalizeSettingsShape(settings);
  return normalizedSettings.timeStructure.dayConfigs[dayCode];
}

function getTeachingPeriodsForDay(settings = {}, dayCode) {
  return getDayConfig(settings, dayCode)?.teachingPeriods || 0;
}

function getExpectedWeeklyPeriods(settings = {}) {
  return getActiveDayConfigs(settings)
    .reduce((total, dayConfig) => total + dayConfig.teachingPeriods, 0);
}

function getMaxTeachingPeriods(settings = {}) {
  return getActiveDayConfigs(settings)
    .reduce((maxPeriods, dayConfig) => Math.max(maxPeriods, dayConfig.teachingPeriods), 0);
}

function isTeachingSlot(settings = {}, dayCode, period) {
  const dayConfig = getDayConfig(settings, dayCode);
  if (!dayConfig?.enabled) {
    return false;
  }
  return Number(period) >= 1 && Number(period) <= dayConfig.teachingPeriods;
}

function getPlcDays(settings = {}) {
  const normalizedSettings = normalizeSettingsShape(settings);
  if (!normalizedSettings.plcPolicy.enabled || !normalizedSettings.plcPolicy.schoolWide) {
    return [];
  }
  return normalizedSettings.plcPolicy.allowedDays.filter((dayCode) =>
    normalizedSettings.timeStructure.activeDays.includes(dayCode),
  );
}

function isPlcSlot(settings = {}, dayCode, period) {
  return getPlcDays(settings).includes(dayCode)
    && Number(period) === getTeachingPeriodsForDay(settings, dayCode) + 1;
}

function getSlotTimeLabel(settings = {}, dayCode, period, slotType = "TEACHING") {
  const normalizedSettings = normalizeSettingsShape(settings);
  const dayConfig = normalizedSettings.timeStructure.dayConfigs[dayCode];
  if (!dayConfig?.enabled) {
    return "";
  }

  if (slotType === "PLC") {
    const plcStart = addMinutes(
      dayConfig.startTime,
      dayConfig.periodDurationMinutes * dayConfig.teachingPeriods,
    );
    const plcEnd = addMinutes(plcStart, normalizedSettings.plcPolicy.durationMinutes);
    return `${plcStart}-${plcEnd}`;
  }

  if (!isTeachingSlot(normalizedSettings, dayCode, period)) {
    return "";
  }

  const startTime = addMinutes(dayConfig.startTime, dayConfig.periodDurationMinutes * (Number(period) - 1));
  const endTime = addMinutes(startTime, dayConfig.periodDurationMinutes);
  return `${startTime}-${endTime}`;
}

function getMaxBoardPeriod(settings = {}, view = "section") {
  const teachingMax = getMaxTeachingPeriods(settings);
  if (view !== "teacher") {
    return teachingMax;
  }

  const plcMax = getPlcDays(settings)
    .reduce((maxPeriod, dayCode) => Math.max(maxPeriod, getTeachingPeriodsForDay(settings, dayCode) + 1), 0);
  return Math.max(teachingMax, plcMax);
}

function buildBoardLayout(settings = {}, view = "section") {
  const normalizedSettings = normalizeSettingsShape(settings);
  const maxPeriod = getMaxBoardPeriod(normalizedSettings, view);
  const columns = Array.from({ length: maxPeriod }, (_, index) => {
    const period = index + 1;
    return {
      period,
      label: `คาบ ${period}`,
      shortLabel: `ช่วง ${period}`,
    };
  });

  const days = getActiveDayConfigs(normalizedSettings).map((dayConfig) => ({
    day: dayConfig.dayCode,
    label: dayConfig.label,
    shortLabel: dayConfig.shortLabel,
    cells: columns.map((column) => {
      const slotType = isPlcSlot(normalizedSettings, dayConfig.dayCode, column.period)
        ? "PLC"
        : isTeachingSlot(normalizedSettings, dayConfig.dayCode, column.period)
          ? "TEACHING"
          : "CLOSED";
      return {
        day: dayConfig.dayCode,
        period: column.period,
        slotType,
        schedulable: slotType === "TEACHING",
        label: slotType === "PLC" ? normalizedSettings.plcPolicy.title : column.label,
        timeLabel: getSlotTimeLabel(normalizedSettings, dayConfig.dayCode, column.period, slotType),
      };
    }),
  }));

  return {
    columns,
    days,
  };
}

function enumerateTeachingSlots(settings = {}) {
  const slots = [];
  for (const dayConfig of getActiveDayConfigs(settings)) {
    for (let period = 1; period <= dayConfig.teachingPeriods; period += 1) {
      slots.push({ day: dayConfig.dayCode, period });
    }
  }
  return slots;
}

function buildSchoolWidePlcEntries(settings = {}, teachers = [], options = {}) {
  const normalizedSettings = normalizeSettingsShape(settings);
  if (!normalizedSettings.plcPolicy.enabled || !normalizedSettings.plcPolicy.schoolWide) {
    return [];
  }
  if (options.forExport && !normalizedSettings.plcPolicy.showInTeacherExports) {
    return [];
  }

  const teacherFilterId = trimString(options.teacherId);
  return teachers
    .filter((teacher) => !teacherFilterId || teacher.id === teacherFilterId)
    .flatMap((teacher) =>
      getPlcDays(normalizedSettings).map((dayCode) => ({
        id: `plc-${teacher.id}-${dayCode}`,
        timetableId: options.timetableId || "tt-current",
        enrollmentId: "",
        instructionalGroupId: "",
        sectionId: "",
        subjectId: "",
        deliveryMode: "WHOLE_CLASS",
        studentGroupKey: "PLC",
        roomId: "",
        day: dayCode,
        period: getTeachingPeriodsForDay(normalizedSettings, dayCode) + 1,
        entryType: "PLC",
        subjectName: normalizedSettings.plcPolicy.title,
        roomName: "ชั่วโมง PLC",
        deliveryModeLabel: "ชั่วโมง PLC",
        note: "กิจกรรมพัฒนาวิชาชีพร่วมกัน",
        timeLabel: getSlotTimeLabel(normalizedSettings, dayCode, getTeachingPeriodsForDay(normalizedSettings, dayCode) + 1, "PLC"),
        teachers: [
          {
            teacherId: teacher.id,
            teachingRole: "LEAD",
            loadFactor: 0,
          },
        ],
      })),
    );
}

module.exports = {
  WEEKDAYS,
  DEFAULT_PERIODS_PER_DAY,
  DEFAULT_PERIOD_DURATION_MINUTES,
  DEFAULT_START_TIME,
  DEFAULT_PLC_DURATION_MINUTES,
  normalizeSettingsShape,
  normalizeTimeStructure,
  normalizePlcPolicy,
  createDefaultTimeStructure,
  createDefaultPlcPolicy,
  getActiveDayConfigs,
  getDayConfig,
  getTeachingPeriodsForDay,
  getExpectedWeeklyPeriods,
  getMaxTeachingPeriods,
  getMaxBoardPeriod,
  isTeachingSlot,
  isPlcSlot,
  getPlcDays,
  getSlotTimeLabel,
  buildBoardLayout,
  enumerateTeachingSlots,
  buildSchoolWidePlcEntries,
};
