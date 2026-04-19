import { escapeHtml } from "../common/html.js";

export function renderCatalogNav(root, items = [], activeValue = "") {
  if (!root) {
    return;
  }

  root.innerHTML = items
    .map((item, index) => {
      const readyLabel = item.count > 0
        ? `พร้อม ${item.readyCount}/${item.count}`
        : "ยังไม่มีข้อมูล";

      return `
        <button
          class="catalog-nav-item ${item.value === activeValue ? "is-active" : ""}"
          type="button"
          data-catalog-type="${escapeHtml(item.value)}"
          aria-pressed="${item.value === activeValue ? "true" : "false"}"
        >
          <span class="catalog-nav-step">${index + 1}</span>
          <span class="catalog-nav-copy">
            <strong>${escapeHtml(item.label)}</strong>
            <small>${escapeHtml(item.description || "")}</small>
          </span>
          <span class="catalog-nav-meta">
            <span class="catalog-nav-count">${item.count} รายการ</span>
            <span class="catalog-nav-ready ${item.attentionCount > 0 ? "has-issues" : "is-clean"}">${escapeHtml(readyLabel)}</span>
          </span>
        </button>
      `;
    })
    .join("");
}
