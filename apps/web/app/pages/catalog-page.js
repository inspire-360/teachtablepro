import {
  CATALOG_OPTIONS,
  renderCatalogBody,
  renderCatalogFilterOptions,
  renderCatalogHead,
  renderCatalogOptions,
} from "../../render.js";
import { renderCatalogNav } from "../components/catalog/catalog-nav.js";
import { getCatalogModuleMeta } from "../components/catalog/catalog-meta.js";
import { summarizeCatalogReadiness } from "../components/catalog/readiness-badge.js";
import { renderCatalogToolbar } from "../components/catalog/catalog-toolbar.js";

function buildCatalogNavItems(data, lookup) {
  return CATALOG_OPTIONS.map((item) => {
    const records = Array.isArray(data?.[item.value]) ? data[item.value] : [];
    const meta = getCatalogModuleMeta(item.value);
    const summary = summarizeCatalogReadiness(item.value, records, lookup);

    return {
      value: item.value,
      label: meta.label,
      description: meta.navHint,
      count: summary.totalCount,
      readyCount: summary.readyCount,
      attentionCount: summary.attentionCount,
    };
  });
}

export function renderCatalogPage(dom, options = {}) {
  const {
    catalogType = "teachers",
    data = {},
    lookup,
    searchText = "",
    filterValue = "",
  } = options;

  const moduleMeta = getCatalogModuleMeta(catalogType);
  const records = Array.isArray(data?.[catalogType]) ? data[catalogType] : [];
  const summary = summarizeCatalogReadiness(catalogType, records, lookup);

  renderCatalogNav(dom.catalogNav, buildCatalogNavItems(data, lookup), catalogType);
  renderCatalogOptions(dom.catalogType, catalogType);
  renderCatalogFilterOptions(dom.catalogFilter, catalogType, records, filterValue);
  renderCatalogHead(dom.catalogHead, catalogType);

  dom.catalogSearch.value = searchText;
  dom.catalogSearch.placeholder = moduleMeta.searchPlaceholder;
  dom.addRecordButton.dataset.idleLabel = moduleMeta.addLabel;
  dom.catalogFlowNote.textContent = moduleMeta.flowNote;

  const filteredCount = renderCatalogBody(
    dom.catalogBody,
    catalogType,
    records,
    lookup,
    searchText,
    filterValue,
  );

  renderCatalogToolbar(
    {
      moduleKicker: dom.catalogModuleKicker,
      moduleTitle: dom.catalogModuleTitle,
      moduleDescription: dom.catalogModuleDescription,
      moduleStats: dom.catalogModuleStats,
      tableKicker: dom.catalogTableKicker,
      tableTitle: dom.catalogTableTitle,
      summaryText: dom.catalogSummary,
    },
    {
      moduleMeta,
      summary,
      filteredCount,
    },
  );
}
