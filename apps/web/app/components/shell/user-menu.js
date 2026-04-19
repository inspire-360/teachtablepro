export function renderUserMenuNote(root, { providerLabel = "", syncLabel = "" } = {}) {
  if (!root) {
    return;
  }

  const parts = [providerLabel, syncLabel].filter(Boolean);
  root.textContent = parts.join(" • ");
}
