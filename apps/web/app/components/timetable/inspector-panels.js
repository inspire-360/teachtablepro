import {
  renderActivity,
  renderCollaborationHealth,
  renderLocks,
  renderPresence,
  renderSuggestions,
} from "../../../render.js";

export function renderTimetableInspectorPanels(targets, options = {}) {
  const {
    suggestionSummary,
    suggestionList,
    collaborationSummary,
    collaborationHealth,
    presenceList,
    lockList,
    activitySummary,
    activityList,
  } = targets;

  const {
    suggestions = [],
    suggestionsState = "idle",
    suggestionsError = "",
    selectedGroupLabel = "",
    activity = {},
    syncLabel = "",
    collaborationStatus = "idle",
    collaborationMessage = "",
  } = options;

  const activeUserCount = activity?.activeUsers?.length || 0;
  const lockCount = activity?.locks?.length || 0;
  const eventCount = activity?.recentEvents?.length || 0;

  suggestionSummary.textContent = selectedGroupLabel
    ? suggestionsState === "loading"
      ? `กำลังวิเคราะห์ช่องที่เหมาะสำหรับ ${selectedGroupLabel}`
      : suggestionsState === "error"
        ? `ยังโหลดคำแนะนำสำหรับ ${selectedGroupLabel} ไม่สำเร็จ`
        : suggestions.length > 0
          ? `พบช่วงเวลาที่เหมาะ ${suggestions.length} ช่องสำหรับ ${selectedGroupLabel}`
          : `ยังไม่พบ slot ที่เหมาะสำหรับ ${selectedGroupLabel} ในขณะนี้`
    : "เลือกกลุ่มการสอนจากฝั่งซ้ายเพื่อดู slot ที่ระบบแนะนำและเหตุผลประกอบ";

  collaborationSummary.textContent = collaborationStatus === "attention" && collaborationMessage
    ? collaborationMessage
    : collaborationStatus === "reconnecting" && collaborationMessage
      ? collaborationMessage
      : activeUserCount > 0
        ? `ออนไลน์ ${activeUserCount} คน และมี lock ที่ระบบกำลังถืออยู่ ${lockCount} รายการ`
        : "ยังไม่มีผู้ใช้งานออนไลน์ใน workspace นี้ และยังไม่มี lock ที่ถือค้าง";

  activitySummary.textContent = eventCount > 0
    ? `กิจกรรมล่าสุด ${eventCount} รายการ โดยซิงก์ล่าสุด ${syncLabel || "เมื่อสักครู่"}`
    : `ยังไม่มีกิจกรรมล่าสุด โดยซิงก์ล่าสุด ${syncLabel || "เมื่อสักครู่"}`;

  renderSuggestions(suggestionList, suggestions, {
    state: suggestionsState,
    errorMessage: suggestionsError,
  });
  renderCollaborationHealth(collaborationHealth, {
    status: collaborationStatus,
    message: collaborationMessage,
    syncLabel,
    activeUserCount,
    lockCount,
  });
  renderPresence(presenceList, activity);
  renderLocks(lockList, activity);
  renderActivity(activityList, activity);
}
