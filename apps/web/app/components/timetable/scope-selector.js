import { renderScopeSelect, renderViewSwitch } from "../../../render.js";

export function renderTimetableScopeSelector(targets, options = {}) {
  const {
    viewSwitchRoot,
    scopeSelect,
    scopeNote,
  } = targets;

  const {
    state,
    data,
    currentScopeLabel = "-",
    currentViewLabel = "มุมมองห้องเรียน",
    unresolvedGroupCount = 0,
  } = options;

  renderViewSwitch(viewSwitchRoot, state.view);
  renderScopeSelect(scopeSelect, state, data);
  scopeNote.textContent = `${currentViewLabel} • ${currentScopeLabel} • เหลือกลุ่มค้างจัด ${unresolvedGroupCount} กลุ่ม`;
}
