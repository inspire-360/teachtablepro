import {
  escapeHtml,
  renderExportScopeSelect,
  renderExportSelectionPanel,
  renderScopeSelect,
  renderViewSwitch,
} from "../../render.js";

function resolvePreviewEntities(options = {}) {
  const {
    exportScope = "current",
    currentScopeLabel = "-",
    entities = [],
    selectedIds = [],
  } = options;

  if (exportScope === "all") {
    return entities;
  }

  if (exportScope === "selected") {
    const selectedSet = new Set(selectedIds || []);
    return entities.filter((item) => selectedSet.has(item.id));
  }

  return [{ id: "current-scope", label: currentScopeLabel }];
}

export function renderExportsPage(dom, options = {}) {
  const {
    state,
    data,
    currentViewLabel = "มุมมองห้องเรียน",
    currentScopeLabel = "-",
    exportScopeSummary = "",
    entities = [],
    visibleEntities = [],
  } = options;

  renderViewSwitch(dom.exportsViewSwitch, state.view);
  renderScopeSelect(dom.exportsScopeSelect, state, data);
  renderExportScopeSelect(dom.exportScopeSelect, state.view, state.exportScope);
  renderExportSelectionPanel(dom.exportSelectionPanel, {
    view: state.view,
    mode: state.exportScope,
    entities,
    selectedIds: state.exportSelectionIds,
    searchText: state.exportSearch,
  });

  dom.exportSearchInput.value = state.exportSearch;
  dom.exportSearchInput.hidden = state.exportScope !== "selected";
  dom.exportSearchInput.disabled = state.exportScope !== "selected";
  dom.selectVisibleButton.hidden = state.exportScope !== "selected";
  dom.selectVisibleButton.disabled = state.exportScope !== "selected";
  dom.clearExportSelectionButton.hidden = state.exportScope !== "selected";
  dom.clearExportSelectionButton.disabled = state.exportScope !== "selected";

  dom.exportPageViewNote.textContent = `${currentViewLabel} • ${currentScopeLabel}`;
  dom.exportPageNote.textContent = exportScopeSummary;
  dom.exportPageSummary.textContent = state.exportScope === "selected"
    ? `กำลังกรองจากรายการที่มองเห็น ${visibleEntities.length} รายการ`
    : "ใช้ตัวเลือกด้านซ้ายเพื่อกำหนดว่าจะส่งออกเฉพาะรายการปัจจุบัน หลายรายการ หรือทั้งหมด";

  const previewEntities = resolvePreviewEntities({
    exportScope: state.exportScope,
    currentScopeLabel,
    entities,
    selectedIds: state.exportSelectionIds,
  });

  dom.exportPreviewList.innerHTML = previewEntities.length
    ? previewEntities
        .slice(0, 6)
        .map((item) => `
          <article class="exports-preview-item">
            <strong>${escapeHtml(item.label || "-")}</strong>
            <small>${escapeHtml(state.view === "teacher" ? "ชุดตารางรายครู" : "ชุดตารางรายห้องเรียน")}</small>
          </article>
        `)
        .join("")
    : `
      <article class="exports-preview-item empty">
        <strong>${escapeHtml(state.view === "teacher" ? "ยังไม่ได้เลือกครู" : "ยังไม่ได้เลือกห้องเรียน")}</strong>
        <small>เลือกรายการอย่างน้อย 1 รายการก่อนส่งออก</small>
      </article>
    `;

  if (previewEntities.length > 6) {
    dom.exportPreviewList.insertAdjacentHTML(
      "beforeend",
      `<article class="exports-preview-item more"><strong>และอีก ${escapeHtml(previewEntities.length - 6)} รายการ</strong><small>ระบบจะรวมไว้ในชุดส่งออกเดียวกัน</small></article>`,
    );
  }
}
