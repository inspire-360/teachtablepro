import {
  applyMutation,
  autoSchedule,
  claimLock,
  configureApiClient,
  deleteResource,
  exportCsv,
  exportPdf,
  getActivity,
  getBootstrap,
  getSuggestions,
  heartbeat,
  joinCollaboration,
  printTimetable,
  releaseLock,
  saveResource,
  saveSettings,
  validateTimetable,
} from "./app/services/api-client.js";
import {
  getCurrentIdToken,
  initializeFirebaseAuth,
  observeAuthState,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
} from "./app/services/auth-service.js";
import { getDom } from "./app/dom.js";
import { createRouter } from "./app/router.js";
import { createAppStore, createInitialAppState } from "./app/store/app-store.js";
import { isCompactShellViewport, renderAppShellState } from "./app/components/shell/app-shell.js";
import { renderPageBreadcrumb, renderPageSubnav } from "./app/components/shell/page-header.js";
import { renderSidebarNav } from "./app/components/shell/sidebar.js";
import { showToast } from "./app/components/common/toast.js";
import { renderUserMenuNote } from "./app/components/shell/user-menu.js";
import { renderDashboardPage } from "./app/pages/dashboard-page.js";
import { renderCatalogPage } from "./app/pages/catalog-page.js";
import { renderExportsPage } from "./app/pages/exports-page.js";
import { renderTimetablePage } from "./app/pages/timetable-page.js";
import { DEFAULT_SCREEN, HEARTBEAT_INTERVAL_MS } from "./app/utils/constants.js";
import { formatSyncTime, getInitials, humanizeProvider } from "./app/utils/formatters.js";
import { CANONICAL_DAYS, buildBoardModel, findBoardCell } from "./app/utils/schedule-config.js";
import {
  CATALOG_OPTIONS,
  NAV_ITEMS,
  SCREEN_META,
  SECTION_GRADE_OPTIONS,
  buildAssignmentRowHtml,
  buildSplitGroupRowHtml,
  buildButtonLabel,
  buildModalForm,
  escapeHtml,
  formatDeliveryMode,
  formatSectionLabel,
  formatTeachingRole,
  iconMarkup,
  renderActivity,
  renderAlertFeed,
  renderBoardGrid,
  renderBoardHead,
  renderDashboardBars,
  renderDashboardInsights,
  renderExportScopeSelect,
  renderExportSelectionPanel,
  renderGroupPool,
  renderLocks,
  renderMetrics,
  renderPresence,
  renderScopeSelect,
  renderSectionStatuses,
  renderSettingsForm,
  renderStatusList,
  renderSuggestions,
  renderTeacherLoads,
  renderValidation,
  renderViewSwitch,
  renderWorkspaceState,
} from "./render.js";

const router = createRouter({
  screens: Object.keys(SCREEN_META),
  defaultScreen: DEFAULT_SCREEN,
});
const CATALOG_ROUTE_VALUES = CATALOG_OPTIONS.map((item) => item.value);
const appStore = createAppStore(
  createInitialAppState(
    router.resolve(),
    router.resolveSubpath("catalog", window.location.hash, {
      allowedValues: CATALOG_ROUTE_VALUES,
      fallback: CATALOG_OPTIONS[0].value,
    }),
  ),
);
const state = appStore.getState();

let authUnsubscribe = () => undefined;
let heartbeatTimer = null;
let authBootstrapTimer = null;
let unauthorizedHandled = false;
let pendingNavigationHash = "";

const SUBJECT_AREA_COLORS = {
  "ภาษาไทย": "#d95f5f",
  "คณิตศาสตร์": "#2a9d8f",
  "วิทยาศาสตร์และเทคโนโลยี": "#2176c7",
  "สังคมศึกษา ศาสนา และวัฒนธรรม": "#d49a1f",
  "สุขศึกษาและพลศึกษา": "#ef7d57",
  "ศิลปะ": "#b95db1",
  "การงานอาชีพ": "#8f6b3a",
  "ภาษาต่างประเทศ": "#5a6fd8",
};
const DEVELOPMENT_ACTIVITY_COLOR = "#f28f3b";
const DEFAULT_SUBJECT_COLOR = "#187498";

const dom = getDom();

configureApiClient({
  getAccessToken: () => getCurrentIdToken(false),
  onUnauthorized: handleUnauthorized,
});

function resolveScreenFromHash() {
  return router.resolve(window.location.hash);
}

function resolveCatalogTypeFromHash(hashValue = window.location.hash, fallback = state.catalogType) {
  return router.resolveSubpath("catalog", hashValue, {
    allowedValues: CATALOG_ROUTE_VALUES,
    fallback,
  });
}

function setScreen(screen) {
  const nextScreen = router.resolve(router.build(screen));
  state.screen = nextScreen;
  closeSidebar();
  const nextSubpath = nextScreen === "catalog" ? state.catalogType : "";
  pendingNavigationHash = router.build(nextScreen, nextSubpath);
  router.navigate(nextScreen, window, nextSubpath);
  if (state.auth.status === "signed_in" && state.data) {
    renderWorkspaceHeader();
    applyScreenVisibility();
  }
  render();
}

function currentCatalogOption() {
  return CATALOG_OPTIONS.find((item) => item.value === state.catalogType) || CATALOG_OPTIONS[0];
}

function buildCatalogSubnavItems() {
  return CATALOG_OPTIONS.map((item) => ({
    ...item,
    count: Array.isArray(state.data?.[item.value]) ? state.data[item.value].length : undefined,
  }));
}

function setCatalogType(nextType) {
  const resolvedType = CATALOG_OPTIONS.some((item) => item.value === nextType) ? nextType : state.catalogType;

  if (resolvedType === state.catalogType) {
    return;
  }

  state.catalogType = resolvedType;
  state.catalogFilter = "";

  if (state.screen === "catalog") {
    pendingNavigationHash = router.build("catalog", resolvedType);
    router.navigate("catalog", window, resolvedType);
  }

  render();
}

function mountShellRegions() {
  const profileConsole = document.querySelector(".profile-console");

  if (dom.sidebarNavSlot.firstElementChild !== dom.nav) {
    dom.sidebarNavSlot.append(dom.nav);
  }

  if (profileConsole && dom.sidebarUserSlot.firstElementChild !== profileConsole) {
    dom.sidebarUserSlot.append(profileConsole);
  }

  dom.sidebarNavSection.classList.remove("hidden");
  dom.sidebarUserSection.classList.remove("hidden");
}

function renderShellState() {
  const compact = isCompactShellViewport(window);

  mountShellRegions();
  renderAppShellState(dom.appShell, dom.sidebarBackdrop, dom.sidebarToggleButton, dom.sidebarCloseButton, {
    compact,
    sidebarOpen: state.sidebarOpen,
  });

  const shouldLockScroll = state.auth.status === "signed_in" && compact && state.sidebarOpen;
  document.body.classList.toggle("shell-lock-scroll", shouldLockScroll);
}

function closeSidebar() {
  if (!state.sidebarOpen) {
    renderShellState();
    return;
  }

  state.sidebarOpen = false;
  renderShellState();
}

function toggleSidebar() {
  if (!isCompactShellViewport(window)) {
    return;
  }

  state.sidebarOpen = !state.sidebarOpen;
  renderShellState();
}

function clearAuthBootstrapFallback() {
  if (authBootstrapTimer) {
    window.clearTimeout(authBootstrapTimer);
    authBootstrapTimer = null;
  }
}

function scheduleAuthBootstrapFallback() {
  clearAuthBootstrapFallback();
  authBootstrapTimer = window.setTimeout(() => {
    if (state.auth.status !== "loading") {
      return;
    }

    state.auth.status = "signed_out";
    setAuthError("TeachTable is taking longer than expected to prepare sign-in. You can refresh or continue once Firebase responds.");
    render();
  }, 4500);
}

function getDisplayNameStorageKey(uid) {
  return `teachtable-display-name:${uid}`;
}

function hydrateUserProfile(user) {
  const storedName = localStorage.getItem(getDisplayNameStorageKey(user.uid));
  const fallbackName = user.displayName || user.email?.split("@")[0] || "ผู้ใช้ TeachTable";
  state.userProfile = {
    userId: user.uid,
    displayName: storedName || fallbackName,
  };
  dom.displayNameInput.value = state.userProfile.displayName;
}

function setAuthError(message = "") {
  state.auth.error = message;
  dom.authErrorMessage.textContent = message;
  dom.authErrorMessage.classList.toggle("hidden", !message);
}

function clearAuthError() {
  setAuthError("");
}

function currentViewLabel() {
  return state.view === "teacher" ? "มุมมองครู" : "มุมมองห้องเรียน";
}

function createAppError(message, meta = {}) {
  const error = new Error(message);
  Object.assign(error, meta);
  return error;
}

function setCollaborationState(status = "idle", message = "") {
  state.collaborationStatus = status;
  state.collaborationMessage = message;
}

function resetSuggestionState() {
  state.suggestions = [];
  state.suggestionsState = "idle";
  state.suggestionsError = "";
}

function resetTimetableSelection() {
  state.selectedGroupId = "";
  resetSuggestionState();
}

function restoreBoardNote() {
  const defaultText = dom.timetableBoardNote.dataset.defaultText;
  if (defaultText) {
    dom.timetableBoardNote.textContent = defaultText;
  }
}

function clearBoardDragClasses() {
  dom.boardGrid.querySelectorAll(".slot-cell.is-drop-target, .slot-cell.is-drop-occupied, .slot-cell.is-drop-locked, .slot-cell.is-drop-disabled, .slot-cell.is-slot-soft-preview")
    .forEach((slot) => slot.classList.remove("is-drop-target", "is-drop-occupied", "is-drop-locked", "is-drop-disabled", "is-slot-soft-preview"));
  dom.boardGrid.querySelectorAll(".entry-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  dom.groupPool.querySelectorAll(".group-card.is-dragging").forEach((card) => card.classList.remove("is-dragging"));
  dom.suggestionList.querySelectorAll(".stack-item.is-active-preview").forEach((item) => item.classList.remove("is-active-preview"));
}

function buildCurrentBoardModel(lookup = getLookup()) {
  if (!state.data) {
    return {
      columns: [],
      rows: [],
      visibleEntries: [],
      scheduleSettings: {},
    };
  }

  return buildBoardModel({
    settings: state.data.settings,
    view: state.view,
    scopeId: state.scopeId,
    entries: state.data.timetable.entries,
    decorateEntry: (entry) => decorateEntry(entry, lookup),
  });
}

function describeSlotState(day, period) {
  if (!state.data) {
    return "";
  }

  const boardModel = buildCurrentBoardModel();
  const cell = findBoardCell(boardModel, day, period);
  if (!cell) {
    return "ช่วงเวลานี้อยู่นอกโครงสร้างตารางของขอบเขตที่กำลังเปิดอยู่";
  }

  const activeLocks = (state.data.activity?.locks || []).filter(
    (lock) => lock.day === day && Number(lock.period) === Number(period),
  );

  const row = boardModel.rows.find((item) => item.day === day);
  const dayLabel = row?.label || day;
  const entryText = cell.slotType === "CLOSED"
    ? "เป็นช่องปิดตามโครงสร้างเวลา ยังไม่สามารถวางคาบสอนได้"
    : cell.slotType === "PLC"
      ? `เป็นช่วง ${cell.label || "PLC"} ของ${dayLabel}`
      : cell.entries.length > 0
        ? `มีคาบอยู่แล้ว ${cell.entries.length} รายการ`
        : "ยังไม่มีคาบในช่องนี้";
  const lockText = activeLocks.length > 0
    ? `และมี lock อยู่ ${activeLocks.length} รายการ`
    : "และยังไม่มี lock ที่ถือค้าง";
  const timeText = cell.timeLabel ? ` เวลา ${cell.timeLabel}` : "";

  return `${dayLabel} คาบ ${period}:${timeText} ${entryText} ${lockText}`.trim();
}

function previewBoardSlot(day, period, options = {}) {
  const {
    mode = "soft",
    sourceElement = null,
    scroll = false,
    allowDrop = true,
  } = options;

  clearBoardDragClasses();
  const slot = dom.boardGrid.querySelector(`.slot-cell[data-day="${day}"][data-period="${period}"]`);
  if (!slot) {
    restoreBoardNote();
    return;
  }

  if (mode === "drop") {
    if (allowDrop) {
      slot.classList.add("is-drop-target");
    } else {
      slot.classList.add("is-drop-disabled");
    }
    const hasEntries = slot.querySelectorAll(".entry-card").length > 0;
    const hasLocks = (state.data?.activity?.locks || []).some(
      (lock) => lock.day === day && Number(lock.period) === Number(period),
    );
    if (allowDrop && hasEntries) {
      slot.classList.add("is-drop-occupied");
    }
    if (hasLocks) {
      slot.classList.add("is-drop-locked");
    }
  } else {
    slot.classList.add("is-slot-soft-preview");
  }

  if (sourceElement) {
    sourceElement.classList.add("is-active-preview");
  }

  dom.timetableBoardNote.textContent = describeSlotState(day, period);

  if (scroll) {
    slot.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }
}

async function loadSuggestionsForSelectedGroup(groupId, options = {}) {
  const {
    keepExisting = false,
  } = options;

  if (!groupId) {
    resetSuggestionState();
    render();
    return;
  }

  state.selectedGroupId = groupId;
  state.suggestionsState = "loading";
  state.suggestionsError = "";
  if (!keepExisting) {
    state.suggestions = [];
  }
  render();

  try {
    const suggestions = await getSuggestions(groupId);
    if (state.selectedGroupId !== groupId) {
      return;
    }
    state.suggestions = suggestions;
    state.suggestionsState = "ready";
    state.suggestionsError = "";
    render();
  } catch (error) {
    if (state.selectedGroupId !== groupId) {
      return;
    }
    state.suggestions = [];
    state.suggestionsState = "error";
    state.suggestionsError = error.message || "ไม่สามารถโหลดคำแนะนำได้";
    render();
    throw error;
  }
}

function buildMutationFailureMessage(result = {}) {
  if (Array.isArray(result.conflicts) && result.conflicts.length > 0) {
    return result.conflicts[0]?.message || `พบความขัดแย้ง ${result.conflicts.length} รายการในช่องที่เลือก`;
  }

  return result.staleReason || "ไม่สามารถบันทึกการเปลี่ยนแปลงตารางสอนได้";
}

function openExportsScreen() {
  setScreen("exports");
}

function buildPreviewMetaCard(label, value, note = "") {
  return `
    <article class="preview-meta-card">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value || "-")}</strong>
      ${note ? `<span>${escapeHtml(note)}</span>` : ""}
    </article>
  `;
}

function buildPreviewTeacherChips(assignments = [], lookup = getLookup()) {
  if (!assignments.length) {
    return '<p class="preview-helper">ยังไม่ได้กำหนดครูผู้สอน</p>';
  }

  return `
    <div class="preview-chip-list">
      ${assignments
        .map((assignment) => {
          const teacherName = lookup.teacherMap.get(assignment.teacherId)?.fullName || assignment.teacherId;
          const roleLabel = formatTeachingRole(assignment.teachingRole || "LEAD");
          const loadNote = Number(assignment.loadFactor || 1) !== 1 ? ` · load ${assignment.loadFactor}` : "";
          return `<span class="preview-chip">${escapeHtml(`${teacherName} • ${roleLabel}${loadNote}`)}</span>`;
        })
        .join("")}
    </div>
  `;
}

function buildSuggestionPreviewMarkup(groupId) {
  if (state.selectedGroupId !== groupId) {
    return '<p class="preview-helper">กดพรีวิวเพื่อให้ระบบโหลดคำแนะนำของกลุ่มนี้ก่อนลากลงตาราง</p>';
  }

  if (state.suggestionsState === "loading") {
    return '<p class="preview-helper">กำลังวิเคราะห์ช่วงเวลาที่เหมาะสมสำหรับกลุ่มนี้</p>';
  }

  if (state.suggestionsState === "error") {
    return `<p class="preview-helper critical">${escapeHtml(state.suggestionsError || "โหลดคำแนะนำไม่สำเร็จ")}</p>`;
  }

  if (!state.suggestions.length) {
    return '<p class="preview-helper">ยังไม่พบ slot ที่เหมาะสมในขอบเขตนี้ ลองเปลี่ยนมุมมองหรือปลด lock ก่อน</p>';
  }

  return `
    <div class="preview-suggestion-list">
      ${state.suggestions
        .slice(0, 4)
        .map((item) => `
          <article class="preview-suggestion-item">
            <strong>${escapeHtml(`${item.dayLabel || item.day} • คาบ ${item.period}`)}</strong>
            <span>${escapeHtml(`คะแนน ${item.score}`)}</span>
            <p>${escapeHtml((item.reasons || []).join(" • ") || "เป็นช่วงเวลาที่สมดุลสำหรับกลุ่มนี้")}</p>
          </article>
        `)
        .join("")}
    </div>
  `;
}

function resolvePreviewModalContent(lookup) {
  if (!state.previewModal.open || !state.data) {
    return null;
  }

  const resolvedLookup = lookup || getLookup();

  if (state.previewModal.type === "entry") {
    const entry = state.data.timetable.entries.find((item) => item.id === state.previewModal.targetId);
    if (!entry) {
      return null;
    }

    const decorated = decorateEntry(entry, resolvedLookup);
    const enrollment = resolvedLookup.enrollmentMap.get(entry.enrollmentId);
    const group = resolvedLookup.groupMap.get(entry.instructionalGroupId);
    const subject = resolvedLookup.subjectMap.get(entry.subjectId);
    const section = resolvedLookup.sectionMap.get(entry.sectionId);
    const notes = String(enrollment?.notes || "").trim();

    return {
      caption: "รายละเอียดคาบในตาราง",
      title: `${decorated.subjectName} • ${decorated.groupShortLabel || decorated.groupName}`,
      body: `
        <div class="preview-meta-grid">
          ${buildPreviewMetaCard("วัน/คาบ", `${decorated.day} • คาบ ${decorated.period}`, section ? formatSectionLabel(section) : "")}
          ${buildPreviewMetaCard("ห้อง/พื้นที่", decorated.roomName, decorated.deliveryModeLabel)}
          ${buildPreviewMetaCard("รายวิชา", subject?.subjectCode ? `${subject.subjectCode} • ${decorated.subjectName}` : decorated.subjectName, subject?.learningArea || "")}
          ${buildPreviewMetaCard("แผนรายวิชา", `${entry.requiredPeriodsPerWeek || enrollment?.requiredPeriodsPerWeek || 1} คาบ/สัปดาห์`, group?.studentGroupKey || entry.studentGroupKey)}
        </div>
        <article class="preview-detail-panel">
          <h4 class="tt-section-title">ครูผู้สอน</h4>
          ${buildPreviewTeacherChips(entry.teachers, resolvedLookup)}
        </article>
        <article class="preview-detail-panel">
          <h4 class="tt-section-title">มุมมองเต็มของรายวิชา</h4>
          <p>${escapeHtml([
            section ? `ชั้นเรียน ${formatSectionLabel(section)}` : "",
            decorated.deliveryModeLabel ? `รูปแบบ ${decorated.deliveryModeLabel}` : "",
            group?.displayName ? `กลุ่ม ${group.displayName}` : "",
          ].filter(Boolean).join(" • ") || "ไม่มีข้อมูลเพิ่มเติม")}</p>
          ${notes ? `<p class="preview-helper">${escapeHtml(notes)}</p>` : '<p class="preview-helper">ไม่มีหมายเหตุพิเศษในแผนรายวิชานี้</p>'}
        </article>
      `,
    };
  }

  if (state.previewModal.type === "group") {
    const group = resolvedLookup.groupMap.get(state.previewModal.targetId);
    if (!group) {
      return null;
    }

    const enrollment = resolvedLookup.enrollmentMap.get(group.enrollmentId);
    const subject = resolvedLookup.subjectMap.get(enrollment?.subjectId);
    const section = resolvedLookup.sectionMap.get(enrollment?.sectionId);
    const unresolved = state.data.unresolvedGroups.find((item) => item.groupId === group.id);
    const remainingPeriods = unresolved?.remainingPeriods ?? Math.max((group.requiredPeriodsPerWeek || 0) - (unresolved?.assignedPeriods || 0), 0);
    const roomName = resolvedLookup.roomMap.get(group.preferredRoomId || enrollment?.preferredRoomId)?.name || "-";
    const notes = String(enrollment?.notes || "").trim();

    return {
      caption: "พรีวิวก่อนลากลงตาราง",
      title: `${subject?.name || group.displayName} • ${group.displayName}`,
      body: `
        <div class="preview-meta-grid">
          ${buildPreviewMetaCard("ชั้น/ห้อง", section ? formatSectionLabel(section) : "-", subject?.subjectCode || "")}
          ${buildPreviewMetaCard("คาบที่ต้องลง", `${remainingPeriods} จาก ${group.requiredPeriodsPerWeek || enrollment?.requiredPeriodsPerWeek || 1} คาบ`, formatDeliveryMode(group.deliveryMode))}
          ${buildPreviewMetaCard("ห้องหลัก", roomName, group.studentGroupKey || "WHOLE_CLASS")}
          ${buildPreviewMetaCard("แผนแม่", enrollment?.requiredPeriodsPerWeek ? `${enrollment.requiredPeriodsPerWeek} คาบ/สัปดาห์` : "-", enrollment?.notes ? "มีหมายเหตุ" : "ไม่มีหมายเหตุ")}
        </div>
        <article class="preview-detail-panel">
          <h4 class="tt-section-title">ครูผู้สอนของกลุ่มนี้</h4>
          ${buildPreviewTeacherChips(group.teachers || [], resolvedLookup)}
        </article>
        <article class="preview-detail-panel">
          <h4 class="tt-section-title">คำแนะนำเบื้องต้นก่อนลงคาบ</h4>
          ${buildSuggestionPreviewMarkup(group.id)}
        </article>
        ${notes ? `
          <article class="preview-detail-panel">
            <h4 class="tt-section-title">หมายเหตุของแผนรายวิชา</h4>
            <p class="preview-helper">${escapeHtml(notes)}</p>
          </article>
        ` : ""}
      `,
    };
  }

  return null;
}

function renderPreviewModal() {
  const preview = resolvePreviewModalContent();
  const open = Boolean(preview);
  dom.previewModal.classList.toggle("hidden", !open);
  if (!open) {
    if (state.previewModal.open) {
      state.previewModal = {
        open: false,
        type: "",
        targetId: "",
      };
    }
    dom.previewModalBody.innerHTML = "";
    return;
  }

  dom.previewModalCaption.textContent = preview.caption;
  dom.previewModalTitle.textContent = preview.title;
  dom.previewModalBody.innerHTML = preview.body;
}

function openPreviewModal(type, targetId) {
  state.previewModal = {
    open: true,
    type,
    targetId,
  };
  renderPreviewModal();
}

function closePreviewModal() {
  state.previewModal = {
    open: false,
    type: "",
    targetId: "",
  };
  renderPreviewModal();
}

function toggleValidationDrawer() {
  state.validationDrawerOpen = !state.validationDrawerOpen;
  render();
}

function emphasizeBoardSlot(day, period) {
  const slot = dom.boardGrid.querySelector(`.slot-cell[data-day="${day}"][data-period="${period}"]`);
  if (!slot) {
    showToast(dom.toastStack, "ไม่พบตำแหน่งนี้ในขอบเขตที่กำลังเปิดอยู่", "error");
    return;
  }

  slot.classList.add("is-slot-emphasis");
  slot.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  window.setTimeout(() => slot.classList.remove("is-slot-emphasis"), 1800);
}

function isBusy(key) {
  return state.busy.has(key);
}

function toggleBusy(key, enabled) {
  if (enabled) {
    state.busy.add(key);
  } else {
    state.busy.delete(key);
  }
  renderBusyState();
}

async function runAction(key, action, options = {}) {
  if (isBusy(key)) {
    return null;
  }

  toggleBusy(key, true);
  try {
    const result = await action();
    if (options.successMessage) {
      showToast(dom.toastStack, options.successMessage);
    }
    return result;
  } catch (error) {
    console.error(error);
    if (typeof options.onError === "function") {
      options.onError(error);
    }
    showToast(dom.toastStack, options.errorMessage || error.message || "เกิดข้อผิดพลาดบางอย่าง", "error");
    return null;
  } finally {
    toggleBusy(key, false);
  }
}

function setButtonBusy(button, busy, idleLabel, busyLabel) {
  if (!button) {
    return;
  }
  button.disabled = busy;
  const label = busy ? busyLabel : idleLabel;
  button.innerHTML = button.dataset.icon ? buildButtonLabel(button.dataset.icon, label) : label;
}

function hydrateStaticButtonIcons() {
  document.querySelectorAll("button[data-icon]").forEach((button) => {
    if (button.dataset.iconHydrated === "true") {
      return;
    }
    button.innerHTML = buildButtonLabel(button.dataset.icon, button.textContent.trim());
    button.dataset.iconHydrated = "true";
  });
}

function renderBusyState() {
  setButtonBusy(dom.googleSigninButton, isBusy("auth-google"), "เข้าสู่ระบบด้วย Google", "กำลังเปิด Google...");
  setButtonBusy(dom.emailLoginButton, isBusy("auth-email"), "เข้าสู่ระบบด้วยอีเมล", "กำลังเข้าสู่ระบบ...");
  setButtonBusy(dom.saveProfileButton, isBusy("save-profile"), "บันทึกชื่อ", "กำลังบันทึก...");
  setButtonBusy(dom.signoutButton, isBusy("sign-out"), "ออกจากระบบ", "กำลังออกจากระบบ...");
  setButtonBusy(dom.refreshButton, isBusy("refresh"), "รีเฟรชข้อมูล", "กำลังรีเฟรช...");
  const addRecordIdleLabel = dom.addRecordButton.dataset.idleLabel || "เพิ่มรายการ";
  setButtonBusy(dom.addRecordButton, false, addRecordIdleLabel, addRecordIdleLabel);
  setButtonBusy(dom.validateButton, isBusy("validate"), "ตรวจสอบ", "กำลังตรวจสอบ...");
  setButtonBusy(dom.exportCsvButton, isBusy("export-csv"), "ส่งออก CSV", "กำลังส่งออก...");
  setButtonBusy(dom.exportPdfButton, isBusy("export-pdf"), "ส่งออก PDF", "กำลังส่งออก...");
  setButtonBusy(dom.printButton, isBusy("print"), "พิมพ์", "กำลังเตรียมพิมพ์...");
  setButtonBusy(dom.autoScheduleButton, isBusy("auto-schedule"), "จัดวางอัตโนมัติ", "กำลังจัดตาราง...");
  setButtonBusy(dom.heroAutoButton, isBusy("auto-schedule"), "จัดตารางอัตโนมัติ", "กำลังจัดตาราง...");
  setButtonBusy(dom.saveSettingsButton, isBusy("save-settings"), "บันทึกการตั้งค่า", "กำลังบันทึก...");

  if (!state.auth.config.ready) {
    dom.googleSigninButton.disabled = true;
    dom.emailLoginButton.disabled = true;
  }

  const modalSubmit = dom.modalForm.querySelector('button[type="submit"]');
  if (modalSubmit) {
    const idleLabel = modalSubmit.dataset.idleLabel || modalSubmit.textContent.trim();
    modalSubmit.dataset.idleLabel = idleLabel;
    modalSubmit.disabled = isBusy("modal-submit");
    const label = isBusy("modal-submit") ? "กำลังบันทึก..." : idleLabel;
    modalSubmit.innerHTML = modalSubmit.dataset.icon ? buildButtonLabel(modalSubmit.dataset.icon, label) : label;
  }
}

function handleUnauthorized() {
  if (unauthorizedHandled || state.auth.status !== "signed_in") {
    return;
  }
  unauthorizedHandled = true;
  showToast(dom.toastStack, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง", "error");
  signOutUser()
    .catch(() => undefined)
    .finally(() => {
      unauthorizedHandled = false;
    });
}

function getLookup() {
  const data = state.data;
  if (state.lookupCache.data === data && state.lookupCache.value) {
    return state.lookupCache.value;
  }

  const lookup = {
    teachers: data.teachers,
    rooms: data.rooms,
    subjects: data.subjects,
    sections: data.sections,
    enrollments: data.enrollments,
    instructionalGroups: data.instructionalGroups,
    settings: data.settings,
    teacherMap: new Map(data.teachers.map((item) => [item.id, item])),
    roomMap: new Map(data.rooms.map((item) => [item.id, item])),
    subjectMap: new Map(data.subjects.map((item) => [item.id, item])),
    sectionMap: new Map(data.sections.map((item) => [item.id, item])),
    enrollmentMap: new Map(data.enrollments.map((item) => [item.id, item])),
    groupMap: new Map(data.instructionalGroups.map((item) => [item.id, item])),
  };

  state.lookupCache = {
    data,
    value: lookup,
  };

  return lookup;
}

function currentScopeLabel() {
  if (!state.data) {
    return "-";
  }
  const lookup = getLookup();
  if (state.view === "teacher") {
    return lookup.teacherMap.get(state.scopeId)?.fullName || "-";
  }
  return formatSectionLabel(lookup.sectionMap.get(state.scopeId));
}

function exportEntitiesForCurrentView() {
  if (!state.data) {
    return [];
  }

  return state.view === "teacher"
    ? state.data.teachers.map((teacher) => ({ id: teacher.id, label: teacher.fullName }))
    : state.data.sections.map((section) => ({ id: section.id, label: formatSectionLabel(section) }));
}

function visibleExportEntities() {
  const normalizedSearch = state.exportSearch.trim().toLowerCase();
  const entities = exportEntitiesForCurrentView();
  return normalizedSearch
    ? entities.filter((item) => item.label.toLowerCase().includes(normalizedSearch))
    : entities;
}

function ensureExportSelection() {
  const validIds = new Set(exportEntitiesForCurrentView().map((item) => item.id));
  state.exportSelectionIds = state.exportSelectionIds.filter((id) => validIds.has(id));

  if (state.exportScope === "selected" && state.exportSelectionIds.length === 0 && validIds.has(state.scopeId)) {
    state.exportSelectionIds = [state.scopeId];
  }
}

function exportScopeSummary() {
  const currentLabel = currentScopeLabel();
  if (state.exportScope === "all") {
    return state.view === "teacher" ? "กำลังเตรียมครูทั้งหมด" : "กำลังเตรียมห้องเรียนทั้งหมด";
  }

  if (state.exportScope === "selected") {
    const count = state.exportSelectionIds.length;
    if (count === 0) {
      return state.view === "teacher" ? "ยังไม่ได้เลือกครูสำหรับส่งออก" : "ยังไม่ได้เลือกห้องเรียนสำหรับส่งออก";
    }
    return state.view === "teacher"
      ? `กำลังเตรียมครูที่เลือก ${count} คน`
      : `กำลังเตรียมห้องเรียนที่เลือก ${count} ห้อง`;
  }

  return state.view === "teacher"
    ? `กำลังเตรียมตารางของ ${currentLabel}`
    : `กำลังเตรียมตารางของ ${currentLabel}`;
}

function currentExportParams() {
  return {
    view: state.view,
    scope: state.exportScope,
    entityId: state.scopeId,
    entityIds: state.exportScope === "selected" ? state.exportSelectionIds : [],
  };
}

function assertExportReady() {
  const entities = exportEntitiesForCurrentView();
  if (entities.length === 0) {
    throw new Error(state.view === "teacher" ? "ยังไม่มีข้อมูลครูสำหรับส่งออกหรือพิมพ์" : "ยังไม่มีข้อมูลห้องเรียนสำหรับส่งออกหรือพิมพ์");
  }

  if (state.exportScope === "selected" && state.exportSelectionIds.length === 0) {
    throw new Error(state.view === "teacher" ? "กรุณาเลือกครูอย่างน้อย 1 คน" : "กรุณาเลือกห้องเรียนอย่างน้อย 1 ห้อง");
  }
}

function ensureScope() {
  if (!state.data) {
    return;
  }
  const source = state.view === "teacher" ? state.data.teachers : state.data.sections;
  if (!source.some((item) => item.id === state.scopeId)) {
    state.scopeId = source[0]?.id || "";
  }
  ensureExportSelection();
}

async function applyViewChange(nextView) {
  if (nextView !== "teacher" && nextView !== "section") {
    return;
  }

  if (state.view === nextView) {
    render();
    return;
  }

  state.view = nextView;
  state.exportSearch = "";
  ensureScope();
  resetTimetableSelection();
  render();
  await syncProfile().catch((error) => console.error(error));
}

async function applyScopeChange(nextScopeId) {
  state.scopeId = nextScopeId;
  ensureExportSelection();
  resetTimetableSelection();
  render();
  await syncProfile().catch((error) => console.error(error));
}

function decorateEntry(entry, lookup = getLookup()) {
  const subject = lookup.subjectMap.get(entry.subjectId);
  const room = lookup.roomMap.get(entry.roomId);
  const group = lookup.groupMap.get(entry.instructionalGroupId);
  const section = lookup.sectionMap.get(entry.sectionId);
  const colorTone = getSubjectColor(subject);
  const teacherAssignments = Array.isArray(entry.teachers) ? entry.teachers : [];
  const teacherNames = teacherAssignments
    .map((assignment) => lookup.teacherMap.get(assignment.teacherId)?.fullName || assignment.teacherId)
    .filter(Boolean);

  return {
    ...entry,
    subjectName: entry.subjectName || subject?.name || entry.subjectId || "PLC",
    groupName: entry.groupName || group?.displayName || entry.studentGroupKey || "PLC",
    groupShortLabel: entry.groupShortLabel || group?.groupCode || group?.displayName || entry.studentGroupKey || "PLC",
    roomName: entry.roomName || room?.name || entry.roomId || "-",
    teacherLabels: teacherAssignments.map((assignment) => {
      const teacher = lookup.teacherMap.get(assignment.teacherId);
      return `${teacher?.fullName || assignment.teacherId} (${formatTeachingRole(assignment.teachingRole)})`;
    }),
    teacherNames,
    teacherSummary: summarizeTeacherNames(teacherNames),
    sectionName: entry.sectionName || formatSectionLabel(section),
    deliveryModeLabel: entry.deliveryModeLabel || (group?.deliveryMode ? formatDeliveryMode(group.deliveryMode) : formatDeliveryMode(entry.deliveryMode)),
    previewHint: entry.previewHint || entry.note || `${entry.sectionName || formatSectionLabel(section)} • ${entry.roomName || room?.name || entry.roomId || "-"}`,
    colorTone,
    colorSoft: hexToRgba(colorTone, 0.16),
  };
}

function hexToRgba(hex, alpha) {
  const normalized = String(hex || "")
    .replace("#", "")
    .trim();

  if (normalized.length !== 6) {
    return `rgba(24, 116, 152, ${alpha})`;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function summarizeTeacherNames(names = []) {
  if (names.length === 0) {
    return "ยังไม่กำหนดครู";
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names[0]} และอีก ${names.length - 1} คน`;
}

function getSubjectColor(subject) {
  if (!subject) {
    return DEFAULT_SUBJECT_COLOR;
  }

  if (subject.subjectKind === "DEVELOPMENT_ACTIVITY") {
    return DEVELOPMENT_ACTIVITY_COLOR;
  }

  return SUBJECT_AREA_COLORS[subject.learningArea] || DEFAULT_SUBJECT_COLOR;
}

function decorateUnresolvedGroup(group, lookup = getLookup()) {
  const enrollment = lookup.enrollmentMap.get(group.enrollmentId);
  const subject = lookup.subjectMap.get(enrollment?.subjectId);
  const colorTone = getSubjectColor(subject);
  const issueCount = (state.data?.validation?.conflicts || []).filter(
    (item) => item.entityIds?.includes(group.groupId) || item.entityIds?.includes(group.enrollmentId),
  ).length;
  const teacherNames = (group.teachers || []).filter(Boolean);

  return {
    ...group,
    issueCount,
    teacherSummary: summarizeTeacherNames(teacherNames),
    previewHint: issueCount > 0 ? `มี ${issueCount} ประเด็นที่ควรตรวจสอบก่อนลงคาบ` : "พร้อมพรีวิวก่อนลากลงตาราง",
    colorTone,
    colorSoft: hexToRgba(colorTone, 0.18),
  };
}

function sortUnresolvedGroups(groups = []) {
  const items = [...groups];

  switch (state.groupSortMode) {
    case "unassigned_first":
      return items.sort((left, right) =>
        (left.assignedPeriods === 0 ? 0 : 1) - (right.assignedPeriods === 0 ? 0 : 1)
        || right.remainingPeriods - left.remainingPeriods
        || left.sectionName.localeCompare(right.sectionName));
    case "issues_desc":
      return items.sort((left, right) =>
        right.issueCount - left.issueCount
        || right.remainingPeriods - left.remainingPeriods
        || left.subjectName.localeCompare(right.subjectName));
    case "subject_asc":
      return items.sort((left, right) =>
        left.subjectName.localeCompare(right.subjectName)
        || left.sectionName.localeCompare(right.sectionName));
    case "section_asc":
      return items.sort((left, right) =>
        left.sectionName.localeCompare(right.sectionName)
        || left.subjectName.localeCompare(right.subjectName));
    case "remaining_desc":
    default:
      return items.sort((left, right) =>
        right.remainingPeriods - left.remainingPeriods
        || right.issueCount - left.issueCount
        || left.sectionName.localeCompare(right.sectionName));
  }
}

function createDefaultSplitGroups(leadTeacherId = "", preferredRoomId = "") {
  return [
    {
      groupCode: "A",
      displayName: "กลุ่ม A",
      studentGroupKey: "GROUP_A",
      teacherId: leadTeacherId,
      preferredRoomId,
    },
    {
      groupCode: "B",
      displayName: "กลุ่ม B",
      studentGroupKey: "GROUP_B",
      teacherId: leadTeacherId,
      preferredRoomId,
    },
  ];
}

function normalizeEnrollmentTeacherAssignments(assignments = [], leadTeacherId = "") {
  const fallback = leadTeacherId
    ? [{ teacherId: leadTeacherId, teachingRole: "LEAD", loadFactor: 1 }]
    : [];
  const source = assignments.length ? assignments : fallback;
  const unique = new Map();

  source.forEach((assignment) => {
    if (!assignment?.teacherId) {
      return;
    }
    const key = `${assignment.teacherId}:${assignment.teachingRole || "LEAD"}`;
    if (!unique.has(key)) {
      unique.set(key, {
        teacherId: assignment.teacherId,
        teachingRole: assignment.teachingRole || "LEAD",
        loadFactor: Number(assignment.loadFactor) || 1,
      });
    }
  });

  return [...unique.values()];
}

function buildEnrollmentModalRecord(record = {}, lookup = getLookup()) {
  if (!record?.id) {
    return {
      ...record,
      sectionScopeMode: record.sectionScopeMode || "SINGLE_SECTION",
      targetSectionIds: record.targetSectionIds || (record.sectionId ? [record.sectionId] : []),
      deliveryTemplate: record.deliveryTemplate || "WHOLE_CLASS",
      teacherAssignments: normalizeEnrollmentTeacherAssignments(record.teacherAssignments || [], record.leadTeacherId),
      splitGroups: record.splitGroups || createDefaultSplitGroups(record.leadTeacherId, record.preferredRoomId),
    };
  }

  const groups = lookup.instructionalGroups.filter((group) => group.enrollmentId === record.id);
  const firstGroup = groups[0];
  const isSplitTemplate = groups.length > 1 && groups.every((group) => group.deliveryMode === "SPLIT_GROUP");
  const deliveryTemplate = isSplitTemplate
    ? "SPLIT_GROUP"
    : firstGroup?.deliveryMode || record.deliveryTemplate || "WHOLE_CLASS";

  return {
    ...record,
    sectionScopeMode: "SINGLE_SECTION",
    targetSectionIds: record.sectionId ? [record.sectionId] : [],
    deliveryTemplate,
    teacherAssignments: isSplitTemplate
      ? normalizeEnrollmentTeacherAssignments([], record.leadTeacherId)
      : normalizeEnrollmentTeacherAssignments(firstGroup?.teachers || [], record.leadTeacherId),
    splitGroups: isSplitTemplate
      ? groups.map((group) => ({
          groupCode: group.groupCode,
          displayName: group.displayName,
          studentGroupKey: group.studentGroupKey,
          teacherId: group.teachers?.[0]?.teacherId || record.leadTeacherId || "",
          preferredRoomId: group.preferredRoomId || record.preferredRoomId || "",
        }))
      : createDefaultSplitGroups(record.leadTeacherId, record.preferredRoomId),
  };
}

function resolveEnrollmentTargetSectionIds(plan, lookup = getLookup()) {
  if (plan.sectionScopeMode === "ALL_ROOMS_IN_GRADE") {
    const anchor = lookup.sectionMap.get(plan.sectionId);
    if (!anchor) {
      return [];
    }
    return lookup.sections
      .filter((section) =>
        section.educationLevel === anchor.educationLevel
        && Number(section.grade) === Number(anchor.grade)
        && String(section.academicYear || "") === String(anchor.academicYear || "")
        && String(section.term || "") === String(anchor.term || ""),
      )
      .map((section) => section.id);
  }

  if (plan.sectionScopeMode === "SELECTED_SECTIONS") {
    const validIds = new Set(lookup.sections.map((section) => section.id));
    const selected = (plan.targetSectionIds || []).filter((id) => validIds.has(id));
    return selected.length ? [...new Set(selected)] : [plan.sectionId];
  }

  return plan.sectionId ? [plan.sectionId] : [];
}

function buildEnrollmentPayload(plan, sectionId) {
  return {
    sectionId,
    subjectId: plan.subjectId,
    leadTeacherId: plan.leadTeacherId,
    requiredPeriodsPerWeek: Number(plan.requiredPeriodsPerWeek) || 1,
    preferredRoomId: plan.preferredRoomId,
    notes: plan.notes || "",
  };
}

function buildInstructionalGroupsFromPlan(plan, enrollmentId) {
  const sharedTeachers = normalizeEnrollmentTeacherAssignments(plan.teacherAssignments || [], plan.leadTeacherId);
  if (plan.deliveryTemplate === "SPLIT_GROUP") {
    const splitGroups = (plan.splitGroups || [])
      .filter((group) => group.groupCode && group.displayName && group.studentGroupKey)
      .map((group) => ({
        enrollmentId,
        groupCode: group.groupCode,
        displayName: group.displayName,
        deliveryMode: "SPLIT_GROUP",
        studentGroupKey: group.studentGroupKey,
        requiredPeriodsPerWeek: Number(plan.requiredPeriodsPerWeek) || 1,
        preferredRoomId: group.preferredRoomId || plan.preferredRoomId,
        teachers: normalizeEnrollmentTeacherAssignments(
          [{ teacherId: group.teacherId || plan.leadTeacherId, teachingRole: "LEAD", loadFactor: 1 }],
          plan.leadTeacherId,
        ),
      }));

    if (splitGroups.length < 2) {
      throw new Error("กรุณากำหนดกลุ่มย่อยอย่างน้อย 2 กลุ่ม");
    }

    const codeSet = new Set();
    const studentKeySet = new Set();
    splitGroups.forEach((group) => {
      if (codeSet.has(group.groupCode)) {
        throw new Error(`รหัสกลุ่ม ${group.groupCode} ซ้ำกัน`);
      }
      if (studentKeySet.has(group.studentGroupKey)) {
        throw new Error(`คีย์นักเรียน ${group.studentGroupKey} ซ้ำกัน`);
      }
      codeSet.add(group.groupCode);
      studentKeySet.add(group.studentGroupKey);
    });

    return splitGroups;
  }

  const deliveryMode = plan.deliveryTemplate === "TEAM_TEACHING"
    ? "TEAM_TEACHING"
    : plan.deliveryTemplate === "LARGE_GROUP"
      ? "LARGE_GROUP"
      : "WHOLE_CLASS";

  return [{
    enrollmentId,
    groupCode: deliveryMode === "TEAM_TEACHING" ? "TEAM" : deliveryMode === "LARGE_GROUP" ? "LARGE" : "WHOLE",
    displayName: deliveryMode === "TEAM_TEACHING" ? "สอนร่วม" : deliveryMode === "LARGE_GROUP" ? "สอนรวม" : "ทั้งห้อง",
    deliveryMode,
    studentGroupKey: deliveryMode === "LARGE_GROUP" ? "LARGE_GROUP" : "WHOLE_CLASS",
    requiredPeriodsPerWeek: Number(plan.requiredPeriodsPerWeek) || 1,
    preferredRoomId: plan.preferredRoomId,
    teachers: sharedTeachers,
  }];
}

async function syncInstructionalGroupsForEnrollment(enrollmentId, desiredGroups = [], existingGroups = []) {
  const existingByCode = new Map(existingGroups.map((group) => [group.groupCode, group]));
  const desiredCodes = new Set(desiredGroups.map((group) => group.groupCode));

  for (const group of desiredGroups) {
    const current = existingByCode.get(group.groupCode);
    if (current) {
      await saveResource("instructionalGroups", group, current.id);
    } else {
      await saveResource("instructionalGroups", group);
    }
  }

  for (const group of existingGroups) {
    if (!desiredCodes.has(group.groupCode)) {
      await deleteResource("instructionalGroups", group.id);
    }
  }
}

async function saveEnrollmentPlan(plan, recordId = "") {
  const lookup = getLookup();
  if (recordId) {
    const currentRecord = state.data.enrollments.find((item) => item.id === recordId);
    if (!currentRecord) {
      throw new Error("ไม่พบแผนรายวิชาที่ต้องการแก้ไข");
    }

    const existingGroups = state.data.instructionalGroups.filter((group) => group.enrollmentId === recordId);
    const nextEnrollmentPayload = buildEnrollmentPayload(plan, currentRecord.sectionId);
    await saveResource("enrollments", nextEnrollmentPayload, recordId);
    await syncInstructionalGroupsForEnrollment(
      recordId,
      buildInstructionalGroupsFromPlan(plan, recordId),
      existingGroups,
    );
    return { count: 1, mode: "update" };
  }

  const targetSectionIds = resolveEnrollmentTargetSectionIds(plan, lookup);
  if (targetSectionIds.length === 0) {
    throw new Error("กรุณาเลือกห้องเรียนอย่างน้อย 1 ห้อง");
  }

  const duplicateSections = targetSectionIds
    .filter((sectionId) => lookup.enrollments.some((item) => item.sectionId === sectionId && item.subjectId === plan.subjectId))
    .map((sectionId) => formatSectionLabel(lookup.sectionMap.get(sectionId)));
  if (duplicateSections.length > 0) {
    throw new Error(`มีแผนรายวิชานี้อยู่แล้วใน ${duplicateSections.join(", ")}`);
  }

  for (const sectionId of targetSectionIds) {
    const createdEnrollment = await saveResource("enrollments", buildEnrollmentPayload(plan, sectionId));
    const groups = buildInstructionalGroupsFromPlan(plan, createdEnrollment.id);
    for (const group of groups) {
      await saveResource("instructionalGroups", group);
    }
  }

  return { count: targetSectionIds.length, mode: "create" };
}

function incrementAcademicYear(value = "") {
  const normalized = String(value || "").trim();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    return String(numeric + 1);
  }
  return normalized ? `${normalized}-next` : String(new Date().getFullYear() + 543);
}

async function copyEnrollmentToNextAcademicYear(enrollmentId) {
  const lookup = getLookup();
  const enrollment = lookup.enrollmentMap.get(enrollmentId);
  if (!enrollment) {
    throw new Error("ไม่พบแผนรายวิชาที่ต้องการคัดลอก");
  }

  const sourceSection = lookup.sectionMap.get(enrollment.sectionId);
  if (!sourceSection) {
    throw new Error("ไม่พบห้องเรียนต้นทางของแผนรายวิชา");
  }

  const nextAcademicYear = incrementAcademicYear(sourceSection.academicYear || lookup.settings?.academicYear || "");
  let targetSection = lookup.sections.find((section) =>
    section.educationLevel === sourceSection.educationLevel
    && Number(section.grade) === Number(sourceSection.grade)
    && String(section.roomName || "") === String(sourceSection.roomName || "")
    && String(section.term || "") === String(sourceSection.term || "")
    && String(section.academicYear || "") === nextAcademicYear,
  );

  if (!targetSection) {
    targetSection = await saveResource("sections", {
      educationLevel: sourceSection.educationLevel,
      grade: sourceSection.grade,
      roomName: sourceSection.roomName,
      plannedPeriodsPerWeek: sourceSection.plannedPeriodsPerWeek,
      academicYear: nextAcademicYear,
      term: sourceSection.term,
      homeroomTeacherId: sourceSection.homeroomTeacherId,
    });
  }

  if (lookup.enrollments.some((item) => item.sectionId === targetSection.id && item.subjectId === enrollment.subjectId)) {
    throw new Error(`มีแผนรายวิชานี้ใน ${formatSectionLabel(targetSection)} ปีการศึกษา ${nextAcademicYear} อยู่แล้ว`);
  }

  const createdEnrollment = await saveResource("enrollments", {
    sectionId: targetSection.id,
    subjectId: enrollment.subjectId,
    leadTeacherId: enrollment.leadTeacherId,
    requiredPeriodsPerWeek: enrollment.requiredPeriodsPerWeek,
    preferredRoomId: enrollment.preferredRoomId,
    notes: enrollment.notes,
  });

  const groups = lookup.instructionalGroups.filter((group) => group.enrollmentId === enrollmentId);
  for (const group of groups) {
    await saveResource("instructionalGroups", {
      enrollmentId: createdEnrollment.id,
      groupCode: group.groupCode,
      displayName: group.displayName,
      deliveryMode: group.deliveryMode,
      studentGroupKey: group.studentGroupKey,
      requiredPeriodsPerWeek: group.requiredPeriodsPerWeek,
      preferredRoomId: group.preferredRoomId,
      teachers: (group.teachers || []).map((assignment) => ({
        teacherId: assignment.teacherId,
        teachingRole: assignment.teachingRole,
        loadFactor: assignment.loadFactor,
      })),
    });
  }

  return {
    targetSectionLabel: formatSectionLabel(targetSection),
    nextAcademicYear,
  };
}

function buildTimetableSnapshot(lookup = getLookup()) {
  const boardModel = buildCurrentBoardModel(lookup);
  const visibleEntries = boardModel.visibleEntries || [];
  const unresolvedGroups = sortUnresolvedGroups(unresolvedForCurrentScope(lookup));
  const selectedGroup = state.selectedGroupId ? lookup.groupMap.get(state.selectedGroupId) : null;

  return {
    boardModel,
    unresolvedGroups,
    currentScopeLabel: currentScopeLabel(),
    currentViewLabel: currentViewLabel(),
    occupiedSlotCount: boardModel.rows
      .flatMap((row) => row.cells)
      .filter((cell) => cell.entries.length > 0).length,
    entryCount: visibleEntries.length,
    unresolvedGroupCount: unresolvedGroups.length,
    validationCount: state.data?.validation?.conflicts?.length || 0,
    selectedGroupLabel: selectedGroup?.displayName || "",
    exportEntities: exportEntitiesForCurrentView(),
    exportScopeSummary: exportScopeSummary(),
  };
}

function dashboardLevelLabel(value) {
  if (value === "PRIMARY") {
    return "ระดับประถมศึกษา";
  }
  if (value === "LOWER_SECONDARY") {
    return "ระดับมัธยมศึกษาตอนต้น";
  }
  return "ทุกระดับชั้น";
}

function filterSectionStatusesByLevel(statuses = []) {
  if (!state.dashboardLevelFilter) {
    return statuses;
  }
  return statuses.filter((item) => item.educationLevel === state.dashboardLevelFilter);
}

function buildDashboardSnapshot() {
  const filteredStatuses = filterSectionStatusesByLevel(state.data?.sectionStatuses || []);
  const sectionChartItems = [...filteredStatuses]
    .sort((left, right) => left.completionRate - right.completionRate || left.label.localeCompare(right.label))
    .slice(0, 6)
    .map((item) => ({
      label: item.label,
      subtitle: item.educationLevelLabel,
      assignedPeriods: item.assignedPeriods,
      plannedPeriodsPerWeek: item.plannedPeriodsPerWeek,
      completionRate: item.completionRate,
      footnote: `${item.errorCount} ข้อผิดพลาด • ${item.warningCount} คำเตือน`,
    }));

  const rankedTeacherLoads = [...(state.data?.teacherLoads || [])]
    .map((item) => ({
      ...item,
      loadPercent: Math.round(((item.current || 0) / Math.max(item.max || 1, 1)) * 100),
      subtitle: (item.subjectNames || []).join(", ") || "ยังไม่ได้ผูกรายวิชา",
      footnote: `${item.assignedGroups || 0} กลุ่มการสอน${item.plcPeriods ? ` • PLC ${item.plcPeriods} ช่วง` : ""}`,
    }))
    .sort((left, right) => right.loadPercent - left.loadPercent || right.current - left.current);

  const teacherChartItems = rankedTeacherLoads.slice(0, 6);
  const teacherFocusItems = rankedTeacherLoads
    .filter((item) => item.loadPercent >= 85 || item.assignedGroups > 0)
    .slice(0, 4);

  return {
    filteredStatuses,
    sectionChartItems,
    teacherChartItems,
    teacherFocusItems: teacherFocusItems.length ? teacherFocusItems : rankedTeacherLoads.slice(0, 3),
    filteredLabel: dashboardLevelLabel(state.dashboardLevelFilter),
  };
}

function buildAssetPreviewMarkup(src, alt, emptyText) {
  if (!src) {
    return `<span class="asset-preview-empty">${escapeHtml(emptyText)}</span>`;
  }
  return `<img class="asset-preview-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพได้"));
    reader.readAsDataURL(file);
  });
}

async function applySettingsAsset(input) {
  const file = input.files?.[0];
  if (!file) {
    return;
  }

  const hiddenName = input.dataset.hiddenName;
  const previewId = input.dataset.previewId;
  if (!hiddenName || !previewId) {
    return;
  }

  const hiddenInput = dom.settingsForm.querySelector(`[name="${hiddenName}"]`);
  const previewRoot = document.getElementById(previewId);
  if (!hiddenInput || !previewRoot) {
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  hiddenInput.value = dataUrl;
  previewRoot.innerHTML = buildAssetPreviewMarkup(dataUrl, file.name, "ยังไม่ได้อัปโหลดรูปภาพ");
  state.settingsDirty = true;
}

function unresolvedForCurrentScope(lookup = getLookup()) {
  if (state.view === "teacher") {
    return state.data.unresolvedGroups
      .filter((item) => {
        const group = lookup.groupMap.get(item.groupId);
        return group?.teachers.some((assignment) => assignment.teacherId === state.scopeId);
      })
      .map((item) => decorateUnresolvedGroup(item, lookup));
  }

  return state.data.unresolvedGroups
    .filter((item) => {
      const enrollment = lookup.enrollmentMap.get(item.enrollmentId);
      return enrollment?.sectionId === state.scopeId;
    })
    .map((item) => decorateUnresolvedGroup(item, lookup));
}

function syncVisibilityState(element, shouldHide) {
  if (!element) {
    return;
  }

  element.classList.toggle("hidden", shouldHide);
  element.hidden = shouldHide;
  element.setAttribute("aria-hidden", String(shouldHide));
}

function renderAppVisibility() {
  syncVisibilityState(dom.bootScreen, state.auth.status !== "loading");
  syncVisibilityState(dom.authScreen, state.auth.status !== "signed_out");
  syncVisibilityState(dom.appShell, state.auth.status !== "signed_in");
}

function renderAuthState() {
  if (!state.auth.config.ready) {
    dom.authStatusChip.textContent = "ต้องตั้งค่า Firebase";
    setAuthError(`ยังตั้งค่า Firebase ไม่ครบ: ${state.auth.config.missingKeys.join(", ")}`);
    dom.googleSigninButton.disabled = true;
    dom.emailLoginButton.disabled = true;
    return;
  }

  dom.authStatusChip.textContent = "ต้องยืนยันตัวตน";
  dom.googleSigninButton.disabled = false;
  dom.emailLoginButton.disabled = false;
}

function renderWorkspaceHeader() {
  const meta = SCREEN_META[state.screen] || SCREEN_META[DEFAULT_SCREEN];
  const settings = state.data?.settings;
  const provider = state.auth.user?.providerData?.[0]?.providerId || "";
  const collaboratorCount = state.data?.activity?.activeUsers?.length || 0;
  const catalogOption = currentCatalogOption();
  const syncLabel = formatSyncTime(state.lastSyncedAt);
  const collaborationStatus = state.collaborationStatus;
  const collaborationMessage = state.collaborationMessage;

  dom.schoolCaption.textContent = settings
    ? `${settings.schoolName} • ภาคเรียน ${settings.term}/${settings.academicYear}`
    : "TeachTable";

  dom.pageTitle.textContent = state.screen === "timetable" && state.data
    ? `${meta.title} • ${currentScopeLabel()}`
    : meta.title;

  if (state.screen === "catalog") {
    dom.pageTitle.textContent = `${meta.title} / ${catalogOption.label}`;
  }

  dom.pageDescription.textContent = state.screen === "timetable" && state.data
    ? `${meta.description} ตอนนี้คุณกำลังดู${currentViewLabel()} ของ ${currentScopeLabel()}`
    : meta.description;

  if (state.screen === "catalog") {
    dom.pageDescription.textContent = `${meta.description} • ${catalogOption.label}`;
  }

  dom.userName.textContent = state.userProfile.displayName || "ผู้ใช้ TeachTable";
  dom.userEmail.textContent = state.auth.user?.email || "ผู้ใช้ที่ยืนยันตัวตนแล้ว";
  dom.userAvatar.textContent = getInitials(state.userProfile.displayName || state.auth.user?.email || "TT");
  dom.accountStatus.textContent = humanizeProvider(provider);
  renderUserMenuNote(dom.userMenuNote, {
    providerLabel: humanizeProvider(provider),
    syncLabel,
  });
  dom.livePill.textContent = collaborationStatus === "reconnecting"
    ? "กำลังเชื่อมต่อ workspace ใหม่"
    : collaborationStatus === "attention"
      ? "ต้องตรวจสอบ collaboration"
      : collaboratorCount > 0
        ? `ออนไลน์ ${collaboratorCount} คน`
        : "คุณกำลังใช้งานอยู่เพียงคนเดียว";
  dom.syncNote.textContent = collaborationStatus === "live" || !collaborationMessage
    ? syncLabel
    : collaborationMessage;
  renderSidebarNav(dom.nav, NAV_ITEMS, state.screen, iconMarkup);
  renderPageBreadcrumb(
    dom.pageBreadcrumb,
    state.screen === "catalog"
      ? [
        { label: meta.eyebrow },
        { label: catalogOption.label, current: true },
      ]
      : [],
  );
  renderPageSubnav(dom.catalogSubnav, [], state.catalogType);
}

function applyScreenVisibility(activeScreen = state.screen) {
  document.querySelectorAll(".screen[data-screen]").forEach((screen) => {
    const shouldHide = screen.dataset.screen !== activeScreen;
    screen.classList.toggle("hidden", shouldHide);
    screen.hidden = shouldHide;
    screen.setAttribute("aria-hidden", String(shouldHide));
    if ("inert" in screen) {
      screen.inert = shouldHide;
    }
  });
}

function renderWorkspaceData() {
  if (!state.data) {
    dom.workspaceState.classList.remove("hidden");
    if (state.dataState === "error") {
      renderWorkspaceState(dom.workspaceState, {
        tone: "critical",
        title: "ไม่สามารถโหลดพื้นที่ทำงานได้",
        body: state.dataError || "TeachTable ไม่สามารถโหลดข้อมูลที่จำเป็นสำหรับเซสชันนี้ได้",
      });
    } else {
      renderWorkspaceState(dom.workspaceState, {
        tone: "info",
        title: "กำลังโหลดพื้นที่ทำงานที่ปลอดภัย",
        body: "TeachTable กำลังดึงข้อมูลตารางสอนล่าสุดสำหรับบัญชีที่ยืนยันตัวตนแล้ว",
      });
    }
    applyScreenVisibility("__none__");
    return;
  }

  dom.workspaceState.classList.add("hidden");
  const lookup = getLookup();
  const dashboardSnapshot = buildDashboardSnapshot();
  const timetableSnapshot = buildTimetableSnapshot(lookup);

  renderStatusList(dom.systemStatus, state.data.validation);
  renderDashboardPage(dom, {
    dashboard: state.data.dashboard,
    alerts: state.data.dashboard.alerts,
    unresolvedCount: state.data.unresolvedGroups.length,
    activeUsers: state.data.activity?.activeUsers?.length || 0,
    filteredLabel: dashboardSnapshot.filteredLabel,
    filteredStatuses: dashboardSnapshot.filteredStatuses,
    sectionChartItems: dashboardSnapshot.sectionChartItems,
    teacherChartItems: dashboardSnapshot.teacherChartItems,
    teacherFocusItems: dashboardSnapshot.teacherFocusItems,
    filterValue: state.dashboardLevelFilter,
    validation: state.data.validation,
    syncLabel: formatSyncTime(state.lastSyncedAt),
  });

  renderCatalogPage(dom, {
    catalogType: state.catalogType,
    data: state.data,
    lookup,
    searchText: state.catalogSearch,
    filterValue: state.catalogFilter,
  });

  renderTimetablePage(dom, {
    state,
    data: state.data,
    snapshot: timetableSnapshot,
    syncLabel: formatSyncTime(state.lastSyncedAt),
  });

  renderExportsPage(dom, {
    state,
    data: state.data,
    currentViewLabel: timetableSnapshot.currentViewLabel,
    currentScopeLabel: timetableSnapshot.currentScopeLabel,
    exportScopeSummary: timetableSnapshot.exportScopeSummary,
    entities: timetableSnapshot.exportEntities,
    visibleEntities: visibleExportEntities(),
  });

  if (!state.settingsDirty || !dom.settingsForm.childElementCount) {
    renderSettingsForm(dom.settingsForm, state.data.settings);
    state.settingsDirty = false;
  }

  applyScreenVisibility();
}

function render() {
  renderAppVisibility();
  renderShellState();

  if (state.auth.status === "loading") {
    dom.bootStatus.textContent = state.auth.error || "กำลังตรวจสอบสิทธิ์และเตรียมข้อมูลล่าสุดของสถานศึกษา";
    appStore.emit();
    return;
  }

  if (state.auth.status === "signed_out") {
    renderAuthState();
    renderBusyState();
    appStore.emit();
    return;
  }

  try {
    window.__TEACHTABLE_LAST_RENDER_ERROR__ = "";
    renderWorkspaceHeader();
    renderWorkspaceData();
    renderPreviewModal();
  } catch (error) {
    window.__TEACHTABLE_LAST_RENDER_ERROR__ = error?.message || String(error);
    throw error;
  }
  renderBusyState();
  appStore.emit();
}

async function loadData(options = {}) {
  if (state.auth.status !== "signed_in") {
    return;
  }

  const shouldShowState = !options.background || !state.data;
  if (shouldShowState) {
    state.dataState = "loading";
    render();
  }

  try {
    state.data = await getBootstrap();
    state.dataError = "";
    state.dataState = "ready";
    ensureScope();
    state.lastSyncedAt = new Date().toISOString();
    if (state.auth.status === "signed_in") {
      setCollaborationState("live", "");
    }
    render();
  } catch (error) {
    state.dataState = "error";
    state.dataError = error.message || "TeachTable ไม่สามารถโหลดข้อมูลล่าสุดได้";
    setCollaborationState("reconnecting", "ไม่สามารถดึงข้อมูล workspace ล่าสุดได้");
    render();
    throw error;
  }
}

async function syncProfile() {
  if (state.auth.status !== "signed_in" || !state.data) {
    return;
  }

  try {
    await joinCollaboration({
      userId: state.userProfile.userId,
      displayName: state.userProfile.displayName,
      currentView: state.view,
      selectedSectionId: state.view === "section" ? state.scopeId : "",
      selectedTeacherId: state.view === "teacher" ? state.scopeId : "",
    });
    setCollaborationState("live", "");
  } catch (error) {
    setCollaborationState("reconnecting", "การเข้าร่วม workspace สะดุด ระบบจะลองใหม่อัตโนมัติ");
    render();
    throw error;
  }
}

async function refreshDataWithPresence(options = {}) {
  await loadData(options);
  if (state.data) {
    await syncProfile();
  }
}

async function refreshLiveActivity() {
  if (state.auth.status !== "signed_in" || !state.data || document.hidden) {
    return;
  }

  try {
    const currentVersion = state.data.timetable?.version;
    const activity = await getActivity();
    state.data.activity = activity;

    if (typeof currentVersion === "number" && activity.version !== currentVersion) {
      setCollaborationState("attention", "มีการแก้ไขจากผู้ร่วมงาน ระบบรีเฟรชข้อมูลล่าสุดให้แล้ว");
      await loadData({ background: true });
      return;
    }

    setCollaborationState("live", "");
    render();
  } catch (error) {
    setCollaborationState("reconnecting", "การซิงก์กิจกรรมล่าสุดขัดข้อง ระบบจะลองใหม่อัตโนมัติ");
    render();
    throw error;
  }
}

function currentScopeParams() {
  return currentExportParams();
}

async function claimResourcesForPatch(patch) {
  const requests = [
    { resourceType: "SECTION", resourceId: patch.sectionId },
    { resourceType: "INSTRUCTIONAL_GROUP", resourceId: patch.instructionalGroupId },
    { resourceType: "ROOM", resourceId: patch.roomId },
    ...patch.teachers.map((teacher) => ({ resourceType: "TEACHER", resourceId: teacher.teacherId })),
  ];

  const lockIds = [];
  for (const request of requests) {
    const result = await claimLock({
      ...request,
      userId: state.userProfile.userId,
      displayName: state.userProfile.displayName,
      day: patch.day,
      period: patch.period,
    });
    if (!result.ok) {
      const message = result.reason || "ไม่สามารถสร้าง lock สำหรับการแก้ไขครั้งนี้ได้";
      setCollaborationState("attention", message);
      throw createAppError(message, { code: "LOCK_FAILED" });
    }
    if (result.lock?.id) {
      lockIds.push(result.lock.id);
    }
  }
  return lockIds;
}

function buildPatchFromGroup(groupId, day, period, existingEntryId = "") {
  const lookup = getLookup();
  const group = lookup.groupMap.get(groupId);
  const enrollment = lookup.enrollmentMap.get(group.enrollmentId);
  const fallbackRoomId = group.preferredRoomId || enrollment.preferredRoomId || state.data.rooms[0]?.id;

  return {
    id: existingEntryId || undefined,
    enrollmentId: group.enrollmentId,
    instructionalGroupId: group.id,
    sectionId: enrollment.sectionId,
    subjectId: enrollment.subjectId,
    deliveryMode: group.deliveryMode,
    studentGroupKey: group.studentGroupKey,
    roomId: fallbackRoomId,
    day,
    period,
    teachers: group.teachers.map((assignment) => ({
      teacherId: assignment.teacherId,
      teachingRole: assignment.teachingRole,
      loadFactor: assignment.loadFactor,
    })),
  };
}

async function commitPatch(patch) {
  const lockIds = await claimResourcesForPatch(patch);
  try {
    const result = await applyMutation({
      actorUserId: state.userProfile.userId,
      actorDisplayName: state.userProfile.displayName,
      baseVersion: state.data.timetable.version,
      expectedLockIds: lockIds,
      patches: [patch],
    });
    if (!result.ok) {
      const message = buildMutationFailureMessage(result);
      const isVersionMismatch = typeof result.staleReason === "string" && result.staleReason.includes("เวอร์ชัน");

      if (isVersionMismatch) {
        setCollaborationState("attention", "มีผู้ใช้อื่นบันทึกก่อนหน้า ระบบรีเฟรชข้อมูลล่าสุดแล้ว");
        await refreshDataWithPresence({ background: true });
      } else {
        setCollaborationState("attention", message);
        await refreshLiveActivity().catch(() => undefined);
      }

      throw createAppError(message, {
        code: isVersionMismatch ? "STALE_VERSION" : Array.isArray(result.conflicts) && result.conflicts.length > 0 ? "BLOCKING_CONFLICTS" : "MUTATION_REJECTED",
        result,
      });
    }
    setCollaborationState("live", "");
  } finally {
    await Promise.all(lockIds.map((lockId) => releaseLock(lockId).catch(() => undefined)));
  }
}

async function scheduleGroup(groupId, day, period, existingEntryId = "") {
  const patch = buildPatchFromGroup(groupId, day, period, existingEntryId);
  await commitPatch(patch);
  state.selectedGroupId = groupId;
  await refreshDataWithPresence({ background: true });
  await loadSuggestionsForSelectedGroup(groupId, { keepExisting: true }).catch((error) => {
    console.error(error);
  });
}

async function deleteEntry(entryId) {
  const entry = state.data.timetable.entries.find((item) => item.id === entryId);
  if (!entry) {
    return;
  }
  const patch = { ...entry, remove: true };
  await commitPatch(patch);
  await refreshDataWithPresence({ background: true });
  if (state.selectedGroupId === entry.instructionalGroupId) {
    await loadSuggestionsForSelectedGroup(entry.instructionalGroupId, { keepExisting: true }).catch((error) => {
      console.error(error);
    });
  }
}

function readPositiveIntegerField(formData, fieldName, fallback, minimum = 1) {
  const parsed = Number(formData.get(fieldName));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.trunc(parsed));
}

function readFloatField(formData, fieldName, fallback, minimum = 0) {
  const parsed = Number(formData.get(fieldName));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Number(parsed.toFixed(2)));
}

function readTextField(formData, fieldName, fallback = "") {
  const value = String(formData.get(fieldName) ?? "").trim();
  return value || fallback;
}

function extractSettingsPayload() {
  const formData = new FormData(dom.settingsForm);
  const currentSettings = state.data?.settings || {};
  const currentTimeStructure = currentSettings.timeStructure || {};
  const currentDayConfigs = currentTimeStructure.dayConfigs || {};
  const currentPlcPolicy = currentSettings.plcPolicy || {};
  const activeDays = formData.getAll("activeDays")
    .map((value) => String(value))
    .filter((value) => CANONICAL_DAYS.some((day) => day.value === value));
  const defaultStartTime = readTextField(formData, "defaultStartTime", currentTimeStructure.defaultStartTime || "08:30");
  const defaultPeriodDurationMinutes = readPositiveIntegerField(
    formData,
    "defaultPeriodDurationMinutes",
    currentTimeStructure.defaultPeriodDurationMinutes || 50,
    30,
  );
  const dayConfigs = Object.fromEntries(
    CANONICAL_DAYS.map((day) => {
      const currentDayConfig = currentDayConfigs[day.value] || {};
      return [day.value, {
        ...currentDayConfig,
        enabled: activeDays.includes(day.value),
        label: currentDayConfig.label || day.label,
        shortLabel: currentDayConfig.shortLabel || day.shortLabel,
        teachingPeriods: readPositiveIntegerField(
          formData,
          `dayTeachingPeriods:${day.value}`,
          currentDayConfig.teachingPeriods || 6,
        ),
        startTime: readTextField(
          formData,
          `dayStartTime:${day.value}`,
          currentDayConfig.startTime || defaultStartTime,
        ),
        periodDurationMinutes: readPositiveIntegerField(
          formData,
          `dayDuration:${day.value}`,
          currentDayConfig.periodDurationMinutes || defaultPeriodDurationMinutes,
          30,
        ),
      }];
    }),
  );
  const plcAllowedDays = formData.getAll("plcAllowedDays")
    .map((value) => String(value))
    .filter((value) => activeDays.includes(value));

  return {
    schoolName: formData.get("schoolName"),
    schoolShortName: formData.get("schoolShortName"),
    academicYear: formData.get("academicYear"),
    term: formData.get("term"),
    logoPath: formData.get("logoPath"),
    timeStructure: {
      ...currentTimeStructure,
      allowDifferentDailySchedule: true,
      activeDays,
      defaultStartTime,
      defaultPeriodDurationMinutes,
      dayConfigs,
    },
    plcPolicy: {
      ...currentPlcPolicy,
      enabled: formData.has("plcEnabled"),
      schoolWide: true,
      allowedDays: plcAllowedDays,
      durationMinutes: readPositiveIntegerField(
        formData,
        "plcDurationMinutes",
        currentPlcPolicy.durationMinutes || 60,
        30,
      ),
      requiredHoursPerWeekDefault: readFloatField(
        formData,
        "plcRequiredHoursPerWeekDefault",
        currentPlcPolicy.requiredHoursPerWeekDefault || 1,
      ),
      showInTeacherExports: formData.has("plcShowInTeacherExports"),
      title: readTextField(formData, "plcTitle", currentPlcPolicy.title || "PLC"),
    },
    signatories: [0, 1, 2].map((index) => ({
      title: formData.get(`signatoryTitle${index}`),
      name: formData.get(`signatoryName${index}`),
      signatureImage: formData.get(`signatorySignatureImage${index}`),
    })),
  };
}

function resourceTitle(resource) {
  const labels = {
    teachers: "ครู",
    rooms: "ห้อง/สถานที่",
    subjects: "รายวิชา",
    sections: "ชั้นเรียน",
    enrollments: "แผนรายวิชา",
    instructionalGroups: "กลุ่มการสอน",
  };
  return labels[resource] || "รายการ";
}

function openModal(resource, recordId = "") {
  state.modal = { open: true, resource, recordId };
  const lookup = getLookup();
  const sourceRecord = recordId ? state.data[resource].find((item) => item.id === recordId) : {};
  const record = resource === "enrollments"
    ? buildEnrollmentModalRecord(sourceRecord || {}, lookup)
    : (sourceRecord || {});
  dom.modalCaption.textContent = resourceTitle(resource);
  dom.modalTitle.textContent = recordId ? `แก้ไข${resourceTitle(resource)}` : `เพิ่ม${resourceTitle(resource)}`;
  dom.modalForm.innerHTML = buildModalForm(resource, record || {}, lookup);
  dom.modal.classList.remove("hidden");
  syncModalHelpers(resource);

  renderBusyState();
}

function closeModal() {
  state.modal.open = false;
  dom.modal.classList.add("hidden");
  dom.modalForm.innerHTML = "";
}

function collectAssignmentRows() {
  return [...dom.modalForm.querySelectorAll(".assignment-row")]
    .map((row) => ({
      teacherId: row.querySelector('[data-assignment-field="teacherId"]')?.value || "",
      teachingRole: row.querySelector('[data-assignment-field="teachingRole"]')?.value || "LEAD",
      loadFactor: Number(row.querySelector('[data-assignment-field="loadFactor"]')?.value || 1),
    }))
    .filter((item) => item.teacherId);
}

function collectSplitGroupRows() {
  return [...dom.modalForm.querySelectorAll(".split-group-row")]
    .map((row) => ({
      groupCode: row.querySelector('[data-split-field="groupCode"]')?.value?.trim() || "",
      displayName: row.querySelector('[data-split-field="displayName"]')?.value?.trim() || "",
      studentGroupKey: row.querySelector('[data-split-field="studentGroupKey"]')?.value?.trim() || "",
      teacherId: row.querySelector('[data-split-field="teacherId"]')?.value || "",
      preferredRoomId: row.querySelector('[data-split-field="preferredRoomId"]')?.value || "",
    }))
    .filter((item) => item.groupCode || item.displayName || item.studentGroupKey || item.teacherId || item.preferredRoomId);
}

function collectModalPayload(resource) {
  const formData = new FormData(dom.modalForm);
  if (resource === "teachers") {
    return {
      teacherCode: formData.get("teacherCode"),
      fullName: formData.get("fullName"),
      maxPeriodsPerWeek: Number(formData.get("maxPeriodsPerWeek")),
      roles: [...dom.modalForm.querySelectorAll('input[name="roles"]:checked')].map((input) => input.value),
      subjectIds: [...dom.modalForm.querySelectorAll('input[name="subjectIds"]:checked')].map((input) => input.value),
    };
  }

  if (resource === "rooms") {
    return {
      roomCode: formData.get("roomCode"),
      name: formData.get("name"),
      specialType: formData.get("specialType"),
      capacity: Number(formData.get("capacity")),
    };
  }

  if (resource === "subjects") {
    return {
      subjectCode: formData.get("subjectCode"),
      name: formData.get("name"),
      subjectKind: formData.get("subjectKind"),
      subjectType: formData.get("subjectType"),
      credits: Number(formData.get("credits")),
      weeklyPeriods: Number(formData.get("weeklyPeriods")),
      learningArea: formData.get("learningArea"),
      activityCategory: formData.get("activityCategory"),
    };
  }

  if (resource === "sections") {
    return {
      educationLevel: formData.get("educationLevel"),
      grade: String(formData.get("grade") || "").trim(),
      roomName: formData.get("roomName"),
      plannedPeriodsPerWeek: Number(formData.get("plannedPeriodsPerWeek")),
      academicYear: formData.get("academicYear"),
      term: formData.get("term"),
      homeroomTeacherId: formData.get("homeroomTeacherId"),
    };
  }

  if (resource === "enrollments") {
    return {
      sectionId: formData.get("sectionId"),
      sectionScopeMode: formData.get("sectionScopeMode") || "SINGLE_SECTION",
      targetSectionIds: [...dom.modalForm.querySelectorAll('input[name="targetSectionIds"]:checked')].map((input) => input.value),
      subjectId: formData.get("subjectId"),
      leadTeacherId: formData.get("leadTeacherId"),
      requiredPeriodsPerWeek: Number(formData.get("requiredPeriodsPerWeek")),
      preferredRoomId: formData.get("preferredRoomId"),
      deliveryTemplate: formData.get("deliveryTemplate") || "WHOLE_CLASS",
      teacherAssignments: collectAssignmentRows(),
      splitGroups: collectSplitGroupRows(),
      notes: formData.get("notes"),
    };
  }

  return {
    enrollmentId: formData.get("enrollmentId"),
    groupCode: formData.get("groupCode"),
    displayName: formData.get("displayName"),
    deliveryMode: formData.get("deliveryMode"),
    studentGroupKey: formData.get("studentGroupKey"),
    requiredPeriodsPerWeek: Number(formData.get("requiredPeriodsPerWeek")),
    preferredRoomId: formData.get("preferredRoomId"),
    teachers: [...dom.modalForm.querySelectorAll(".assignment-row")]
      .map((row) => ({
        teacherId: row.querySelector('[data-assignment-field="teacherId"]').value,
        teachingRole: row.querySelector('[data-assignment-field="teachingRole"]').value,
        loadFactor: Number(row.querySelector('[data-assignment-field="loadFactor"]').value),
      }))
      .filter((item) => item.teacherId),
  };
}

async function onModalSubmit(event) {
  event.preventDefault();
  if (state.modal.resource === "enrollments") {
    const payload = collectModalPayload("enrollments");
    const result = await runAction(
      "modal-submit",
      async () => {
        const saveResult = await saveEnrollmentPlan(payload, state.modal.recordId);
        closeModal();
        await refreshDataWithPresence({ background: true });
        return saveResult;
      },
      {
        errorMessage: "ไม่สามารถบันทึกแผนรายวิชาได้",
      },
    );

    if (result) {
      const successMessage = state.modal.recordId
        ? "บันทึกแผนรายวิชาเรียบร้อยแล้ว"
        : result.count > 1
          ? `สร้างแผนรายวิชาให้ ${result.count} ห้องเรียบร้อยแล้ว`
          : "สร้างแผนรายวิชาเรียบร้อยแล้ว";
      showToast(dom.toastStack, successMessage);
    }

    return result;
  }

  const payload = collectModalPayload(state.modal.resource);
  const result = await runAction(
    "modal-submit",
    async () => {
      await saveResource(state.modal.resource, payload, state.modal.recordId);
      closeModal();
      await refreshDataWithPresence({ background: true });
    },
    {
      successMessage: `บันทึก${resourceTitle(state.modal.resource)}เรียบร้อยแล้ว`,
    },
  );

  return result;
}

function addAssignmentRow() {
  const grid = dom.modalForm.querySelector("#teacher-assignment-grid");
  if (!grid) {
    return;
  }
  grid.insertAdjacentHTML(
    "beforeend",
    buildAssignmentRowHtml(state.data.teachers, {}, grid.querySelectorAll(".assignment-row").length),
  );
}

function buildNextSplitGroupSeed(index) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const leadTeacherId = dom.modalForm.querySelector('select[name="leadTeacherId"]')?.value || "";
  const preferredRoomId = dom.modalForm.querySelector('select[name="preferredRoomId"]')?.value || "";
  const code = alphabet[index] || `G${index + 1}`;
  return {
    groupCode: code,
    displayName: `กลุ่ม ${code}`,
    studentGroupKey: `GROUP_${code}`,
    teacherId: leadTeacherId,
    preferredRoomId,
  };
}

function addSplitGroupRow() {
  const grid = dom.modalForm.querySelector("#split-group-grid");
  if (!grid) {
    return;
  }

  const index = grid.querySelectorAll(".split-group-row").length;
  grid.insertAdjacentHTML(
    "beforeend",
    buildSplitGroupRowHtml(state.data.teachers, state.data.rooms, buildNextSplitGroupSeed(index), index),
  );
}

function setPanelInteractive(panel, enabled) {
  if (!panel) {
    return;
  }

  panel.hidden = !enabled;
  panel.querySelectorAll("input, select, textarea, button").forEach((field) => {
    if (field instanceof HTMLInputElement && field.type === "hidden") {
      return;
    }
    field.disabled = !enabled;
  });
}

function syncEnrollmentScopeTargets() {
  const selectedPanel = dom.modalForm.querySelector('[data-enrollment-scope-panel="selected"]');
  const anchorId = dom.modalForm.querySelector('select[name="sectionId"]')?.value || "";
  const lookup = getLookup();
  const anchor = lookup.sectionMap.get(anchorId);
  if (!selectedPanel) {
    return;
  }

  selectedPanel.querySelectorAll('input[name="targetSectionIds"]').forEach((input) => {
    const section = lookup.sectionMap.get(input.value);
    const inSameCohort = !anchor || !section
      ? true
      : section.educationLevel === anchor.educationLevel
        && Number(section.grade) === Number(anchor.grade)
        && String(section.academicYear || "") === String(anchor.academicYear || "")
        && String(section.term || "") === String(anchor.term || "");
    input.disabled = !inSameCohort || selectedPanel.hidden;
    if (!inSameCohort) {
      input.checked = false;
    }
    const tile = input.closest(".check-tile");
    if (tile) {
      tile.hidden = !inSameCohort;
    }
  });
}

function syncEnrollmentPanels() {
  const scopeMode = dom.modalForm.querySelector('select[name="sectionScopeMode"]')?.value || "SINGLE_SECTION";
  const deliveryTemplate = dom.modalForm.querySelector('select[name="deliveryTemplate"]')?.value || "WHOLE_CLASS";
  const selectedPanel = dom.modalForm.querySelector('[data-enrollment-scope-panel="selected"]');
  const sharedPanel = dom.modalForm.querySelector('[data-enrollment-delivery-panel="shared"]');
  const splitPanel = dom.modalForm.querySelector('[data-enrollment-delivery-panel="split"]');

  setPanelInteractive(selectedPanel, scopeMode === "SELECTED_SECTIONS");
  setPanelInteractive(sharedPanel, deliveryTemplate !== "SPLIT_GROUP");
  setPanelInteractive(splitPanel, deliveryTemplate === "SPLIT_GROUP");
  syncEnrollmentScopeTargets();
}

function setSectionGradeOptions(level, selectedValue = "") {
  const gradeSelect = dom.modalForm.querySelector('select[name="grade"]');
  if (!gradeSelect) {
    return;
  }

  const options = SECTION_GRADE_OPTIONS[level] || SECTION_GRADE_OPTIONS.PRIMARY;
  const fallbackValue = String(selectedValue || gradeSelect.value || options[0]?.value || "1");
  gradeSelect.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === fallbackValue ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");

  if (!options.some((option) => option.value === gradeSelect.value)) {
    gradeSelect.value = options[0]?.value || "1";
  }
}

function updateSectionPreview() {
  const preview = dom.modalForm.querySelector("#section-preview");
  if (!preview) {
    return;
  }

  const educationLevel = dom.modalForm.querySelector('select[name="educationLevel"]')?.value || "PRIMARY";
  const grade = dom.modalForm.querySelector('select[name="grade"]')?.value || "1";
  const roomName = dom.modalForm.querySelector('input[name="roomName"]')?.value.trim() || "?";
  preview.textContent = formatSectionLabel({ educationLevel, grade, roomName });
}

function syncModalHelpers(resource = state.modal.resource) {
  if (resource === "sections") {
    const educationLevel = dom.modalForm.querySelector('select[name="educationLevel"]')?.value || "PRIMARY";
    const grade = dom.modalForm.querySelector('select[name="grade"]')?.value || "1";
    setSectionGradeOptions(educationLevel, grade);
    updateSectionPreview();
  }

  if (resource === "enrollments") {
    syncEnrollmentPanels();
  }
}

function reindexAssignmentRows() {
  dom.modalForm.querySelectorAll(".assignment-row").forEach((row, index) => {
    row.dataset.assignmentIndex = String(index);
    row.querySelector("[data-remove-assignment]").dataset.removeAssignment = String(index);
  });
}

function reindexSplitGroupRows() {
  dom.modalForm.querySelectorAll(".split-group-row").forEach((row, index) => {
    row.dataset.splitGroupIndex = String(index);
    row.querySelector("[data-remove-split-group]").dataset.removeSplitGroup = String(index);
  });
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(async () => {
    if (state.auth.status !== "signed_in" || !state.data || document.hidden) {
      return;
    }

    try {
      await heartbeat({
        userId: state.userProfile.userId,
        displayName: state.userProfile.displayName,
        currentView: state.view,
        selectedSectionId: state.view === "section" ? state.scopeId : "",
        selectedTeacherId: state.view === "teacher" ? state.scopeId : "",
      });
      await refreshLiveActivity();
    } catch (error) {
      setCollaborationState("reconnecting", "การซิงก์ผู้ร่วมงานขัดข้อง ระบบจะลองเชื่อมต่อใหม่อัตโนมัติ");
      render();
      console.error(error);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

async function handleAuthChange(user) {
  clearAuthBootstrapFallback();
  clearAuthError();
  state.auth.user = user;

  if (!user) {
    stopHeartbeat();
    state.auth.status = "signed_out";
    state.data = null;
    state.lookupCache = { data: null, value: null };
    state.dataState = "idle";
    state.dataError = "";
    state.lastSyncedAt = "";
    resetTimetableSelection();
    state.groupSortMode = "remaining_desc";
    state.validationDrawerOpen = true;
    state.dragPayload = null;
    closePreviewModal();
    setCollaborationState("idle", "");
    state.settingsDirty = false;
    render();
    return;
  }

  state.auth.status = "signed_in";
  hydrateUserProfile(user);
  render();
  await refreshDataWithPresence();
  startHeartbeat();
}

function bindEvents() {
  window.addEventListener("hashchange", async () => {
    const previousScreen = state.screen;
    const previousCatalogType = state.catalogType;
    const nextHash = window.location.hash;
    const trustedNavigation = nextHash === pendingNavigationHash;
    const nextScreen = trustedNavigation ? state.screen : resolveScreenFromHash();
    const nextCatalogType = trustedNavigation && nextScreen === "catalog"
      ? state.catalogType
      : resolveCatalogTypeFromHash(nextHash, state.catalogType);
    pendingNavigationHash = "";

    state.screen = nextScreen;
    if (nextScreen === "catalog") {
      state.catalogType = nextCatalogType;
      if (nextCatalogType !== previousCatalogType) {
        state.catalogFilter = "";
      }
    }

    closeSidebar();
    if (state.auth.status === "signed_in" && state.data) {
      renderWorkspaceHeader();
      applyScreenVisibility();
    }
    render();
    if (state.auth.status === "signed_in" && state.data && nextScreen !== previousScreen) {
      try {
        await syncProfile();
      } catch (error) {
        console.error(error);
      }
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshDataWithPresence({ background: true }).catch((error) => console.error(error));
    }
  });

  window.addEventListener("focus", () => {
    refreshDataWithPresence({ background: true }).catch((error) => console.error(error));
  });

  window.addEventListener("resize", () => {
    if (!isCompactShellViewport(window)) {
      state.sidebarOpen = false;
    }
    renderShellState();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (state.previewModal.open) {
      closePreviewModal();
      return;
    }

    if (state.modal.open) {
      closeModal();
    }
  });

  dom.sidebarToggleButton.addEventListener("click", toggleSidebar);
  dom.sidebarCloseButton.addEventListener("click", closeSidebar);
  dom.sidebarBackdrop.addEventListener("click", closeSidebar);

  dom.googleSigninButton.addEventListener("click", () =>
    runAction(
      "auth-google",
      async () => {
        clearAuthError();
        await signInWithGoogle();
      },
      {
        errorMessage: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้",
        onError: (error) => setAuthError(error.message || "ไม่สามารถเข้าสู่ระบบด้วย Google ได้"),
      },
    ));

  dom.emailLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runAction(
      "auth-email",
      async () => {
        clearAuthError();
        await signInWithEmail(dom.authEmailInput.value.trim(), dom.authPasswordInput.value);
      },
      {
        errorMessage: "ไม่สามารถเข้าสู่ระบบด้วยอีเมลได้",
        onError: (error) => setAuthError(error.message || "ไม่สามารถเข้าสู่ระบบด้วยอีเมลได้"),
      },
    );
  });

  dom.nav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-screen]");
    if (button) {
      setScreen(button.dataset.screen);
    }
  });

  dom.saveProfileButton.addEventListener("click", () =>
    runAction(
      "save-profile",
      async () => {
        const nextName = dom.displayNameInput.value.trim() || state.userProfile.displayName;
        state.userProfile.displayName = nextName;
        localStorage.setItem(getDisplayNameStorageKey(state.userProfile.userId), nextName);
        renderWorkspaceHeader();
        await syncProfile();
        await loadData({ background: true });
      },
      {
        successMessage: "อัปเดตชื่อที่แสดงแล้ว",
      },
    ));

  dom.signoutButton.addEventListener("click", () =>
    runAction(
      "sign-out",
      async () => {
        stopHeartbeat();
        await signOutUser();
      },
      {
        successMessage: "ออกจากระบบเรียบร้อยแล้ว",
      },
    ));

  dom.refreshButton.addEventListener("click", () =>
    runAction(
      "refresh",
      async () => {
        await refreshDataWithPresence({ background: true });
      },
      {
        successMessage: "โหลดข้อมูลล่าสุดเรียบร้อยแล้ว",
      },
    ));

  dom.catalogType.addEventListener("change", () => {
    setCatalogType(dom.catalogType.value);
  });

  dom.catalogNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-catalog-type]");
    if (!button) {
      return;
    }

    setCatalogType(button.dataset.catalogType);
  });

  dom.catalogSubnav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-catalog-type]");
    if (!button) {
      return;
    }

    setCatalogType(button.dataset.catalogType);
  });

  dom.catalogFilter.addEventListener("change", () => {
    state.catalogFilter = dom.catalogFilter.value;
    render();
  });

  dom.catalogSearch.addEventListener("input", () => {
    state.catalogSearch = dom.catalogSearch.value.trim();
    render();
  });

  dom.dashboardLevelFilter.addEventListener("change", () => {
    state.dashboardLevelFilter = dom.dashboardLevelFilter.value;
    render();
  });

  dom.addRecordButton.addEventListener("click", () => {
    openModal(state.catalogType);
  });

  dom.modalCloseButton.addEventListener("click", closeModal);
  dom.modal.addEventListener("click", (event) => {
    if (event.target === dom.modal) {
      closeModal();
    }
  });
  dom.previewModalCloseButton.addEventListener("click", closePreviewModal);
  dom.previewModal.addEventListener("click", (event) => {
    if (event.target === dom.previewModal) {
      closePreviewModal();
    }
  });

  dom.modalForm.addEventListener("submit", onModalSubmit);
  dom.modalForm.addEventListener("click", (event) => {
    if (event.target.closest("#add-assignment-button")) {
      addAssignmentRow();
      reindexAssignmentRows();
      return;
    }

    const removeButton = event.target.closest("[data-remove-assignment]");
    if (removeButton) {
      removeButton.closest(".assignment-row")?.remove();
      reindexAssignmentRows();
    }

    if (event.target.closest("#add-split-group-button")) {
      addSplitGroupRow();
      reindexSplitGroupRows();
      return;
    }

    const removeSplitButton = event.target.closest("[data-remove-split-group]");
    if (removeSplitButton) {
      removeSplitButton.closest(".split-group-row")?.remove();
      reindexSplitGroupRows();
    }
  });
  dom.modalForm.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (state.modal.resource === "sections" && target.matches('select[name="educationLevel"]')) {
      setSectionGradeOptions(target.value);
      updateSectionPreview();
      return;
    }

    if (state.modal.resource === "sections" && target.matches('select[name="grade"], input[name="roomName"]')) {
      updateSectionPreview();
      return;
    }

    if (state.modal.resource === "enrollments" && target.matches('select[name="sectionScopeMode"], select[name="deliveryTemplate"], select[name="sectionId"]')) {
      syncEnrollmentPanels();
    }
  });
  dom.modalForm.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (state.modal.resource === "sections" && target.matches('input[name="roomName"]')) {
      updateSectionPreview();
      return;
    }

    if (state.modal.resource === "enrollments" && target.matches('[data-split-field=\"groupCode\"]')) {
      reindexSplitGroupRows();
    }
  });

  dom.settingsForm.addEventListener("input", () => {
    state.settingsDirty = true;
  });

  dom.settingsForm.addEventListener("change", async (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === "file") {
      try {
        await applySettingsAsset(target);
      } catch (error) {
        console.error(error);
        showToast(dom.toastStack, error.message || "ไม่สามารถอัปโหลดรูปภาพได้", "error");
      }
      return;
    }

    state.settingsDirty = true;
  });

  dom.catalogBody.addEventListener("click", async (event) => {
    const editButton = event.target.closest('[data-action="edit"]');
    const deleteButton = event.target.closest('[data-action="delete"]');
    const copyNextYearButton = event.target.closest('[data-action="copy-next-year"]');

    if (editButton) {
      openModal(state.catalogType, editButton.dataset.id);
      return;
    }

    if (copyNextYearButton) {
      const result = await runAction(
        "catalog-copy-next-year",
        async () => {
          const copyResult = await copyEnrollmentToNextAcademicYear(copyNextYearButton.dataset.id);
          await refreshDataWithPresence({ background: true });
          return copyResult;
        },
        {
          errorMessage: "ไม่สามารถคัดลอกแผนรายวิชาไปปีถัดไปได้",
        },
      );

      if (result) {
        showToast(dom.toastStack, `คัดลอกแผนรายวิชาไปยัง ${result.targetSectionLabel} (${result.nextAcademicYear}) แล้ว`);
      }
      return;
    }

    if (deleteButton) {
      const confirmed = window.confirm(`ต้องการลบ${resourceTitle(state.catalogType)}นี้ใช่หรือไม่`);
      if (!confirmed) {
        return;
      }

      await runAction(
        "catalog-delete",
        async () => {
          await deleteResource(state.catalogType, deleteButton.dataset.id);
          await refreshDataWithPresence({ background: true });
        },
        {
          successMessage: `ลบ${resourceTitle(state.catalogType)}เรียบร้อยแล้ว`,
        },
      );
    }
  });

  dom.viewSwitch.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) {
      return;
    }
    await applyViewChange(button.dataset.view);
  });

  dom.scopeSelect.addEventListener("change", async () => {
    await applyScopeChange(dom.scopeSelect.value);
  });

  dom.exportsViewSwitch.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) {
      return;
    }
    await applyViewChange(button.dataset.view);
  });

  dom.exportsScopeSelect.addEventListener("change", async () => {
    await applyScopeChange(dom.exportsScopeSelect.value);
  });

  dom.groupSortSelect.addEventListener("change", () => {
    state.groupSortMode = dom.groupSortSelect.value || "remaining_desc";
    render();
  });

  dom.goToExportsButton.addEventListener("click", openExportsScreen);
  dom.toggleValidationButton.addEventListener("click", toggleValidationDrawer);

  dom.exportScopeSelect.addEventListener("change", () => {
    state.exportScope = dom.exportScopeSelect.value || "current";
    ensureExportSelection();
    render();
  });

  dom.exportSearchInput.addEventListener("input", () => {
    state.exportSearch = dom.exportSearchInput.value;
    render();
  });

  dom.selectVisibleButton.addEventListener("click", () => {
    const nextIds = new Set(state.exportSelectionIds);
    visibleExportEntities().forEach((item) => nextIds.add(item.id));
    state.exportSelectionIds = [...nextIds];
    render();
  });

  dom.clearExportSelectionButton.addEventListener("click", () => {
    state.exportSelectionIds = [];
    render();
  });

  dom.exportSelectionPanel.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-export-select]");
    if (!checkbox) {
      return;
    }

    const nextIds = new Set(state.exportSelectionIds);
    if (checkbox.checked) {
      nextIds.add(checkbox.dataset.exportSelect);
    } else {
      nextIds.delete(checkbox.dataset.exportSelect);
    }
    state.exportSelectionIds = [...nextIds];
    render();
  });

  dom.autoScheduleButton.addEventListener("click", () =>
    runAction(
      "auto-schedule",
      async () => {
        await autoSchedule({
          forceRebuild: false,
          actorUserId: state.userProfile.userId,
          actorDisplayName: state.userProfile.displayName,
        });
        await refreshDataWithPresence({ background: true });
      },
      {
        successMessage: "จัดตารางอัตโนมัติเรียบร้อยแล้ว",
      },
    ));

  dom.heroAutoButton.addEventListener("click", () =>
    runAction(
      "auto-schedule",
      async () => {
        setScreen("timetable");
        await autoSchedule({
          forceRebuild: false,
          actorUserId: state.userProfile.userId,
          actorDisplayName: state.userProfile.displayName,
        });
        await refreshDataWithPresence({ background: true });
      },
      {
        successMessage: "จัดตารางอัตโนมัติเรียบร้อยแล้ว",
      },
    ));

  dom.validateButton.addEventListener("click", () =>
    runAction(
      "validate",
      async () => {
        state.validationDrawerOpen = true;
        await validateTimetable();
        await loadData({ background: true });
      },
      {
        successMessage: "ตรวจสอบตารางเรียบร้อยแล้ว",
      },
    ));

  dom.exportCsvButton.addEventListener("click", () =>
    runAction(
      "export-csv",
      async () => {
        assertExportReady();
        await exportCsv(currentExportParams());
      },
      {
        successMessage: "ส่งออก CSV เรียบร้อยแล้ว",
      },
    ));

  dom.exportPdfButton.addEventListener("click", () =>
    runAction(
      "export-pdf",
      async () => {
        assertExportReady();
        await exportPdf(currentExportParams());
      },
      {
        successMessage: "ส่งออก PDF เรียบร้อยแล้ว",
      },
    ));

  dom.printButton.addEventListener("click", () =>
    runAction(
      "print",
      async () => {
        assertExportReady();
        await printTimetable(currentExportParams());
      },
      {
        successMessage: "เปิดเอกสารสำหรับพิมพ์เรียบร้อยแล้ว",
      },
    ));

  dom.groupPool.addEventListener("click", async (event) => {
    const previewButton = event.target.closest("[data-group-preview]");
    if (previewButton) {
      await loadSuggestionsForSelectedGroup(previewButton.dataset.groupPreview).catch(() => undefined);
      openPreviewModal("group", previewButton.dataset.groupPreview);
      return;
    }

    const card = event.target.closest("[data-group-id]");
    if (!card) {
      return;
    }
    await loadSuggestionsForSelectedGroup(card.dataset.groupId).catch(() => undefined);
  });

  dom.suggestionList.addEventListener("mouseover", (event) => {
    const item = event.target.closest("[data-suggestion-day]");
    if (!item) {
      return;
    }

    previewBoardSlot(item.dataset.suggestionDay, Number(item.dataset.suggestionPeriod), {
      mode: "soft",
      sourceElement: item,
    });
  });

  dom.suggestionList.addEventListener("mouseout", (event) => {
    const item = event.target.closest("[data-suggestion-day]");
    if (!item) {
      return;
    }

    if (event.relatedTarget instanceof Element && item.contains(event.relatedTarget)) {
      return;
    }

    clearBoardDragClasses();
    restoreBoardNote();
  });

  dom.suggestionList.addEventListener("focusin", (event) => {
    const item = event.target.closest("[data-suggestion-day]");
    if (!item) {
      return;
    }

    previewBoardSlot(item.dataset.suggestionDay, Number(item.dataset.suggestionPeriod), {
      mode: "soft",
      sourceElement: item,
      scroll: true,
    });
  });

  dom.suggestionList.addEventListener("focusout", () => {
    clearBoardDragClasses();
    restoreBoardNote();
  });

  dom.suggestionList.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-suggestion-day]");
    if (!item || !state.selectedGroupId) {
      return;
    }

    await runAction(
      "board-save",
      async () => {
        await scheduleGroup(state.selectedGroupId, item.dataset.suggestionDay, Number(item.dataset.suggestionPeriod));
      },
      {
        successMessage: "ลงคาบให้กลุ่มการสอนเรียบร้อยแล้ว",
      },
    );
  });

  dom.validationList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-validation-day]");
    if (!button) {
      return;
    }

    emphasizeBoardSlot(button.dataset.validationDay, Number(button.dataset.validationPeriod));
  });

  dom.boardGrid.addEventListener("click", async (event) => {
    const previewButton = event.target.closest("[data-entry-preview]");
    if (previewButton) {
      openPreviewModal("entry", previewButton.dataset.entryPreview);
      return;
    }

    const deleteButton = event.target.closest("[data-entry-delete]");
    if (!deleteButton) {
      const entryCard = event.target.closest("[data-entry-id]");
      if (entryCard && !event.target.closest("button")) {
        openPreviewModal("entry", entryCard.dataset.entryId);
      }
      return;
    }

    const confirmed = window.confirm("ต้องการนำคาบนี้ออกจากตารางใช่หรือไม่");
    if (!confirmed) {
      return;
    }

    await runAction(
      "board-save",
      async () => {
        await deleteEntry(deleteButton.dataset.entryDelete);
      },
      {
        successMessage: "นำคาบออกจากตารางเรียบร้อยแล้ว",
      },
    );
  });

  dom.boardGrid.addEventListener("dragstart", (event) => {
    const entryCard = event.target.closest("[data-entry-id]");
    if (entryCard) {
      state.dragPayload = { type: "entry", entryId: entryCard.dataset.entryId };
      entryCard.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", JSON.stringify(state.dragPayload));
      event.dataTransfer.effectAllowed = "move";
    }
  });

  dom.groupPool.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-group-id]");
    if (card) {
      state.dragPayload = { type: "group", groupId: card.dataset.groupId };
      card.classList.add("is-dragging");
      event.dataTransfer?.setData("text/plain", JSON.stringify(state.dragPayload));
      event.dataTransfer.effectAllowed = "move";
    }
  });

  const clearBoardDnDState = () => {
    state.dragPayload = null;
    clearBoardDragClasses();
    restoreBoardNote();
  };

  dom.boardGrid.addEventListener("dragend", clearBoardDnDState);
  dom.groupPool.addEventListener("dragend", clearBoardDnDState);

  dom.boardGrid.addEventListener("dragover", (event) => {
    event.preventDefault();
    const cell = event.target.closest(".slot-cell");
    if (!cell || !state.dragPayload) {
      return;
    }

    const schedulable = cell.dataset.schedulable === "true";
    previewBoardSlot(cell.dataset.day, Number(cell.dataset.period), {
      mode: "drop",
      allowDrop: schedulable,
    });
    event.dataTransfer.dropEffect = schedulable ? "move" : "none";
  });

  dom.boardGrid.addEventListener("dragleave", (event) => {
    const cell = event.target.closest(".slot-cell");
    if (!cell) {
      return;
    }

    if (event.relatedTarget instanceof Element && cell.contains(event.relatedTarget)) {
      return;
    }

    clearBoardDragClasses();
    restoreBoardNote();
  });

  dom.boardGrid.addEventListener("drop", async (event) => {
    event.preventDefault();
    const cell = event.target.closest(".slot-cell");
    if (!cell || !state.dragPayload) {
      return;
    }

    if (cell.dataset.schedulable !== "true") {
      clearBoardDnDState();
      showToast(dom.toastStack, "ช่องนี้ถูกปิดไว้สำหรับโครงสร้างเวลา/PLC จึงไม่สามารถวางคาบสอนได้", "error");
      return;
    }

    const day = cell.dataset.day;
    const period = Number(cell.dataset.period);
    const dragPayload = state.dragPayload;
    clearBoardDnDState();

    await runAction(
      "board-save",
      async () => {
        if (dragPayload.type === "group") {
          await scheduleGroup(dragPayload.groupId, day, period);
        } else if (dragPayload.type === "entry") {
          const entry = state.data.timetable.entries.find((item) => item.id === dragPayload.entryId);
          if (entry) {
            await scheduleGroup(entry.instructionalGroupId, day, period, entry.id);
          }
        }
        clearBoardDnDState();
      },
      {
        successMessage: "อัปเดตตารางสอนเรียบร้อยแล้ว",
      },
    );
  });

  dom.saveSettingsButton.addEventListener("click", () =>
    runAction(
      "save-settings",
      async () => {
        await saveSettings(extractSettingsPayload());
        state.settingsDirty = false;
        await loadData({ background: true });
      },
      {
        successMessage: "บันทึกการตั้งค่าเรียบร้อยแล้ว",
      },
    ));

  document.querySelectorAll("[data-screen-link]").forEach((button) => {
    button.addEventListener("click", () => setScreen(button.dataset.screenLink));
  });
}

async function init() {
  bindEvents();
  hydrateStaticButtonIcons();
  render();

  if (!state.auth.config.ready) {
    clearAuthBootstrapFallback();
    state.auth.status = "signed_out";
    render();
    return;
  }

  try {
    scheduleAuthBootstrapFallback();
    await initializeFirebaseAuth();
    authUnsubscribe = await observeAuthState(
      (user) => {
        handleAuthChange(user).catch((error) => {
          console.error(error);
          setAuthError(error.message || "ไม่สามารถกู้คืนสถานะการเข้าสู่ระบบได้");
        });
      },
      (error) => {
        console.error(error);
        clearAuthBootstrapFallback();
        state.auth.status = "signed_out";
        setAuthError(error.message || "ระบบยืนยันตัวตนไม่พร้อมใช้งานในขณะนี้");
        render();
      },
    );
  } catch (error) {
    console.error(error);
    clearAuthBootstrapFallback();
    state.auth.status = "signed_out";
    setAuthError(error.message || "ไม่สามารถเริ่มต้น Firebase Authentication ได้");
    render();
  }
}

async function createTeachTableApp() {
  window.addEventListener("beforeunload", () => {
    clearAuthBootstrapFallback();
    stopHeartbeat();
    authUnsubscribe();
  });

  try {
    await init();
  } catch (error) {
    console.error(error);
    state.auth.status = "signed_out";
    setAuthError(error.message || "TeachTable ไม่สามารถเริ่มต้นระบบได้");
    render();
  }
}

export {
  createTeachTableApp,
};

