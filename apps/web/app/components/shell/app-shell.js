const COMPACT_SHELL_MEDIA = "(max-width: 1100px)";

export function isCompactShellViewport(targetWindow = globalThis.window) {
  return Boolean(targetWindow?.matchMedia?.(COMPACT_SHELL_MEDIA).matches);
}

export function renderAppShellState(root, backdrop, toggleButton, closeButton, { compact = false, sidebarOpen = false } = {}) {
  if (!root) {
    return;
  }

  const isOpen = compact && sidebarOpen;

  root.classList.toggle("is-sidebar-open", isOpen);
  backdrop?.classList.toggle("hidden", !isOpen);
  toggleButton?.setAttribute("aria-expanded", compact ? String(isOpen) : "false");
  closeButton?.classList.toggle("hidden", !compact);
}
