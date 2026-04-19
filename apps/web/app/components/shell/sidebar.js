import { escapeHtml } from "../common/html.js";

export function renderSidebarNav(root, items = [], activeId = "", iconRenderer = () => "") {
  if (!root) {
    return;
  }

  root.innerHTML = items
    .map(
      (item) => `
        <button
          class="nav-item ${item.id === activeId ? "is-active" : ""}"
          type="button"
          data-screen="${escapeHtml(item.id)}"
          aria-current="${item.id === activeId ? "page" : "false"}"
          title="${escapeHtml(item.hint || item.label)}"
        >
          ${iconRenderer(item.icon)}
          <span class="nav-copy">
            <span>${escapeHtml(item.label)}</span>
            <small>${escapeHtml(item.hint || "")}</small>
          </span>
        </button>
      `,
    )
    .join("");
}
