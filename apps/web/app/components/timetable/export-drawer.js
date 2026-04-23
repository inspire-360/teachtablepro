import { renderExportScopeSelect, renderExportSelectionPanel } from "../../../render.js";

export function renderTimetableExportDrawer(targets, options = {}) {
  const {
    drawer,
    backdrop,
    noteRoot,
    scopeSelect,
    searchInput,
    selectVisibleButton,
    clearSelectionButton,
    selectionPanel,
  } = targets;

  const {
    open = false,
    view = "section",
    exportScope = "current",
    exportSearch = "",
    exportSelectionIds = [],
    entities = [],
    scopeSummary = "",
  } = options;

  const selectionMode = exportScope === "selected";

  drawer.classList.toggle("hidden", !open);
  backdrop.classList.toggle("hidden", !open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");

  noteRoot.textContent = selectionMode
    ? `${scopeSummary} • ใช้ตัวค้นหาและปุ่มเลือกที่เห็นเพื่อจัดชุดส่งออก`
    : scopeSummary;

  renderExportScopeSelect(scopeSelect, view, exportScope);
  searchInput.value = exportSearch;
  searchInput.hidden = !selectionMode;
  searchInput.disabled = !selectionMode;
  selectVisibleButton.hidden = !selectionMode;
  selectVisibleButton.disabled = !selectionMode;
  clearSelectionButton.hidden = !selectionMode;
  clearSelectionButton.disabled = !selectionMode;

  renderExportSelectionPanel(selectionPanel, {
    view,
    mode: exportScope,
    entities,
    selectedIds: exportSelectionIds,
    searchText: exportSearch,
  });
}
