const ACTIVITY_MODE_KEY = "goldenSongKing.activityMode";

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isValidActivityRoomId(roomId) {
  return /^\d{6}$/.test(roomId);
}

export function saveActivityMode(roomId, storage) {
  if (!isValidActivityRoomId(roomId)) return false;
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    target.setItem(ACTIVITY_MODE_KEY, JSON.stringify({ roomId }));
    return true;
  } catch {
    return false;
  }
}

export function getActivityMode(roomId, storage) {
  try {
    const target = resolveStorage(storage);
    if (!target) return false;
    const value = JSON.parse(target.getItem(ACTIVITY_MODE_KEY) || "null");
    return Boolean(value?.roomId && value.roomId === roomId);
  } catch {
    return false;
  }
}

export function clearActivityMode(storage) {
  try {
    resolveStorage(storage)?.removeItem(ACTIVITY_MODE_KEY);
  } catch {
    // Session storage is optional UI state.
  }
}

export function isStandaloneMode(browserWindow = window, browserNavigator = navigator) {
  return Boolean(
    browserWindow.matchMedia?.("(display-mode: standalone)").matches ||
      browserNavigator.standalone === true
  );
}

export function isIosBrowser(browserNavigator = navigator) {
  return /iPad|iPhone|iPod/.test(browserNavigator.userAgent || "") ||
    (browserNavigator.platform === "MacIntel" && browserNavigator.maxTouchPoints > 1);
}
