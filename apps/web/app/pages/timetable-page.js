import { renderTimetableToolbar } from "../components/timetable/timetable-toolbar.js";
import { renderTimetableScopeSelector } from "../components/timetable/scope-selector.js";
import { renderTimetableBoard } from "../components/timetable/timetable-board.js";
import { renderTimetableGroupPool } from "../components/timetable/group-pool.js";
import { renderTimetableInspectorPanels } from "../components/timetable/inspector-panels.js";
import { renderTimetableValidationDrawer } from "../components/timetable/validation-drawer.js";

export function renderTimetablePage(dom, options = {}) {
  const {
    state,
    data,
    snapshot,
    syncLabel = "",
  } = options;

  renderTimetableToolbar(
    {
      scopeTitle: dom.timetableScopeTitle,
      scopeMeta: dom.timetableScopeMeta,
      boardKicker: dom.timetableBoardKicker,
      boardTitle: dom.timetableBoardTitle,
      boardNote: dom.timetableBoardNote,
    },
    {
      ...snapshot,
      suggestionCount: state.suggestions.length,
      suggestionsState: state.suggestionsState,
      suggestionsError: state.suggestionsError,
      collaborationStatus: state.collaborationStatus,
      collaborationMessage: state.collaborationMessage,
    },
  );

  renderTimetableScopeSelector(
    {
      viewSwitchRoot: dom.viewSwitch,
      scopeSelect: dom.scopeSelect,
      scopeNote: dom.timetableScopeNote,
    },
    {
      state,
      data,
      currentScopeLabel: snapshot.currentScopeLabel,
      currentViewLabel: snapshot.currentViewLabel,
      unresolvedGroupCount: snapshot.unresolvedGroupCount,
    },
  );

  renderTimetableGroupPool(
    {
      sortSelect: dom.groupSortSelect,
      summaryRoot: dom.groupPoolSummary,
      poolRoot: dom.groupPool,
    },
    {
      unresolvedGroups: snapshot.unresolvedGroups,
      selectedGroupId: state.selectedGroupId,
      sortMode: state.groupSortMode,
    },
  );

  renderTimetableBoard(
    {
      headRoot: dom.boardHead,
      gridRoot: dom.boardGrid,
    },
    {
      matrix: snapshot.matrix,
    },
  );

  renderTimetableInspectorPanels(
    {
      suggestionSummary: dom.suggestionSummary,
      suggestionList: dom.suggestionList,
      collaborationSummary: dom.collaborationSummary,
      collaborationHealth: dom.collaborationHealth,
      presenceList: dom.presenceList,
      lockList: dom.lockList,
      activitySummary: dom.activitySummary,
      activityList: dom.activityList,
    },
    {
      suggestions: state.suggestions,
      suggestionsState: state.suggestionsState,
      suggestionsError: state.suggestionsError,
      selectedGroupLabel: snapshot.selectedGroupLabel,
      activity: data.activity,
      syncLabel,
      collaborationStatus: state.collaborationStatus,
      collaborationMessage: state.collaborationMessage,
    },
  );

  renderTimetableValidationDrawer(
    {
      root: dom.validationDrawer,
      body: dom.validationDrawerBody,
      summaryRoot: dom.validationSummary,
      toggleButton: dom.toggleValidationButton,
      listRoot: dom.validationList,
    },
    {
      open: state.validationDrawerOpen,
      validation: data.validation,
    },
  );
}
