import { getAuthSetupStatus } from "../services/auth-service.js";

export function createInitialAppState(initialScreen = "dashboard", initialCatalogType = "teachers") {
  return {
    screen: initialScreen,
    catalogType: initialCatalogType,
    catalogFilter: "",
    catalogSearch: "",
    dashboardLevelFilter: "",
    view: "section",
    scopeId: "",
    exportScope: "current",
    exportSearch: "",
    exportSelectionIds: [],
    selectedGroupId: "",
    suggestions: [],
    dragPayload: null,
    data: null,
    dataState: "idle",
    dataError: "",
    lastSyncedAt: "",
    modal: {
      open: false,
      resource: "teachers",
      recordId: "",
    },
    sidebarOpen: false,
    auth: {
      status: "loading",
      user: null,
      error: "",
      config: getAuthSetupStatus(),
    },
    userProfile: {
      userId: "",
      displayName: "",
    },
    lookupCache: {
      data: null,
      value: null,
    },
    settingsDirty: false,
    busy: new Set(),
  };
}

export function createAppStore(initialState) {
  const listeners = new Set();
  const state = initialState;

  return {
    state,
    getState() {
      return state;
    },
    patch(partialState = {}) {
      Object.assign(state, partialState);
      listeners.forEach((listener) => listener(state));
      return state;
    },
    emit() {
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
