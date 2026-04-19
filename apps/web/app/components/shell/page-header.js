import { escapeHtml } from "../common/html.js";

function buildSubnavDescription(item) {
  if (item.description) {
    return item.description;
  }

  if (Number.isFinite(item.count)) {
    return `${item.count} รายการ`;
  }

  return "";
}

export function renderPageBreadcrumb(root, items = []) {
  if (!root) {
    return;
  }

  const visibleItems = items.filter((item) => item?.label);

  root.innerHTML = visibleItems
    .map(
      (item, index) => `
        <span class="breadcrumb-item ${item.current ? "is-current" : ""}">${escapeHtml(item.label)}</span>
        ${index < visibleItems.length - 1 ? '<span class="breadcrumb-separator" aria-hidden="true">/</span>' : ""}
      `,
    )
    .join("");

  root.classList.toggle("hidden", visibleItems.length === 0);
}

export function renderPageSubnav(root, items = [], activeValue = "") {
  if (!root) {
    return;
  }

  const visibleItems = items.filter((item) => item?.value && item?.label);

  root.innerHTML = visibleItems
    .map((item) => {
      const description = buildSubnavDescription(item);

      return `
        <button
          class="page-subnav-item ${item.value === activeValue ? "is-active" : ""}"
          type="button"
          data-catalog-type="${escapeHtml(item.value)}"
          aria-pressed="${item.value === activeValue ? "true" : "false"}"
        >
          <span class="page-subnav-copy">
            <span>${escapeHtml(item.label)}</span>
            ${description ? `<small>${escapeHtml(description)}</small>` : ""}
          </span>
          ${Number.isFinite(item.count) ? `<span class="subnav-count">${item.count}</span>` : ""}
        </button>
      `;
    })
    .join("");

  root.classList.toggle("hidden", visibleItems.length === 0);
}
