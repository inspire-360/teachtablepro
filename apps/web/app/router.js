const HASH_PREFIX = "#/";

export function normalizeScreenHash(hashValue = "") {
  return String(hashValue || "").replace(/^#\/?/, "").trim();
}

function normalizeSegments(hashValue = "") {
  return normalizeScreenHash(hashValue)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function createRouter({ screens = [], defaultScreen = "" } = {}) {
  const screenSet = new Set(screens);

  function resolve(hashValue = globalThis.window?.location?.hash || "") {
    const [screen] = normalizeSegments(hashValue);
    return screenSet.has(screen) ? screen : defaultScreen;
  }

  function resolveSubpath(screen, hashValue = globalThis.window?.location?.hash || "", options = {}) {
    const {
      allowedValues = [],
      fallback = "",
    } = options;

    const segments = normalizeSegments(hashValue);
    if (segments[0] !== screen) {
      return fallback;
    }

    const candidate = segments[1] || fallback;
    if (allowedValues.length === 0) {
      return candidate;
    }

    return allowedValues.includes(candidate) ? candidate : fallback;
  }

  function build(screen, subpath = "") {
    const nextScreen = screenSet.has(screen) ? screen : defaultScreen;
    const parts = [nextScreen];

    if (subpath) {
      parts.push(String(subpath).replace(/^\/+/, ""));
    }

    return `${HASH_PREFIX}${parts.join("/")}`;
  }

  function navigate(screen, targetWindow = globalThis.window, subpath = "") {
    const nextHash = build(screen, subpath);
    if (targetWindow?.location && targetWindow.location.hash !== nextHash) {
      targetWindow.location.hash = nextHash;
      return false;
    }
    return true;
  }

  return {
    screens: screenSet,
    defaultScreen,
    resolve,
    resolveSubpath,
    build,
    navigate,
  };
}
