import test from "node:test";
import assert from "node:assert/strict";

import {
  clearActivityMode,
  getActivityMode,
  isIosBrowser,
  isStandaloneMode,
  isValidActivityRoomId,
  saveActivityMode
} from "../src/utils/activityMode.js";
import {
  exitFullscreenSafely,
  requestFullscreenSafely,
  subscribeFullscreenEvents
} from "../src/hooks/useFullscreen.js";
import {
  classifyRoomJoinStatus,
  getRoomJoinStatusMessage
} from "../src/utils/roomJoinStatus.js";

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("manual joins have no activity marker; only valid six-digit deep links qualify", () => {
  const storage = createStorage();
  assert.equal(isValidActivityRoomId("123456"), true);
  assert.equal(isValidActivityRoomId("ABC123"), false);
  assert.equal(isValidActivityRoomId("12345"), false);
  assert.equal(getActivityMode("123456", storage), false);
});

test("successful deep-link state is session-scoped and tied to its room", () => {
  const storage = createStorage();
  assert.equal(saveActivityMode("123456", storage), true);
  assert.equal(getActivityMode("123456", storage), true);
  assert.equal(getActivityMode("654321", storage), false);
  clearActivityMode(storage);
  assert.equal(getActivityMode("123456", storage), false);
});

test("invalid persisted marker is handled without throwing", () => {
  const storage = createStorage();
  storage.setItem("goldenSongKing.activityMode", "not-json");
  assert.equal(getActivityMode("123456", storage), false);
});

test("standalone mode supports display-mode and iOS standalone detection", () => {
  assert.equal(isStandaloneMode({ matchMedia: () => ({ matches: true }) }, {}), true);
  assert.equal(isStandaloneMode({ matchMedia: () => ({ matches: false }) }, { standalone: true }), true);
  assert.equal(isStandaloneMode({ matchMedia: () => ({ matches: false }) }, {}), false);
});

test("iOS detection includes iPadOS desktop user-agent mode", () => {
  assert.equal(isIosBrowser({ userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 1 }), true);
  assert.equal(isIosBrowser({ userAgent: "Mozilla", platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isIosBrowser({ userAgent: "Mozilla", platform: "Win32", maxTouchPoints: 1 }), false);
});

test("fullscreen request gracefully handles unsupported and rejected APIs", async () => {
  assert.equal(await requestFullscreenSafely({}), false);
  assert.equal(await requestFullscreenSafely({ requestFullscreen: async () => { throw new Error("denied"); } }), false);
  assert.equal(await requestFullscreenSafely({ requestFullscreen: async () => undefined }), true);
});

test("fullscreen exit gracefully handles unsupported and successful APIs", async () => {
  assert.equal(await exitFullscreenSafely({ fullscreenElement: null }), false);
  const documentMock = { fullscreenElement: {}, exitFullscreen: async () => undefined };
  assert.equal(await exitFullscreenSafely(documentMock), true);
});

test("fullscreenchange synchronizes state and listeners are cleaned up", () => {
  const listeners = new Map();
  const documentMock = {
    fullscreenElement: null,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name)
  };
  const changes = [];
  const cleanup = subscribeFullscreenEvents(documentMock, (value) => changes.push(value), () => {});
  documentMock.fullscreenElement = {};
  listeners.get("fullscreenchange")();
  documentMock.fullscreenElement = null;
  listeners.get("fullscreenchange")();
  assert.deepEqual(changes, [true, false]);
  cleanup();
  assert.equal(listeners.size, 0);
});

const now = 1_800_000_000_000;
const unexpired = { toMillis: () => now + 60_000 };

test("playing takes priority over locked and reports game already started", () => {
  assert.equal(classifyRoomJoinStatus({ status: "playing", joinStatus: "LOCKED", expiresAt: unexpired }, now), "GAME_ALREADY_STARTED");
});

test("production PLAYING room shape reports game already started before locked", () => {
  const productionRoom = {
    roomId: "654514",
    status: "playing",
    joinStatus: "LOCKED",
    gamePhase: "ANSWERING",
    currentQuestion: 2,
    phaseStartedAt: 1_790_044_558_083,
    expiresAt: { toMillis: () => 1_790_066_054_099 }
  };

  const status = classifyRoomJoinStatus(productionRoom, 1_790_044_558_083);

  assert.equal(status, "GAME_ALREADY_STARTED");
  assert.equal(getRoomJoinStatusMessage(status), "遊戲已經開始，目前無法加入這個房間。");
});

test("locked waiting room reports room locked", () => {
  const status = classifyRoomJoinStatus({ status: "waiting", joinStatus: "LOCKED", expiresAt: unexpired }, now);
  assert.equal(status, "ROOM_LOCKED");
  assert.equal(getRoomJoinStatusMessage(status), "房間已鎖定，暫時無法加入，請詢問主持人。");
});

test("ended room reports room ended", () => {
  const status = classifyRoomJoinStatus({ status: "waiting", joinStatus: "ENDED", expiresAt: unexpired }, now);
  assert.equal(status, "ROOM_ENDED");
  assert.equal(getRoomJoinStatusMessage(status), "這個活動房間已結束，請向主持人索取新的 QR Code。");
});

test("expired room reports room expired", () => {
  const status = classifyRoomJoinStatus({ status: "waiting", joinStatus: "OPEN", expiresAt: { toMillis: () => now } }, now);
  assert.equal(status, "ROOM_EXPIRED");
  assert.equal(getRoomJoinStatusMessage(status), "這個活動連結已逾期，請向主持人索取新的 QR Code。");
});

test("open, waiting, unexpired room permits join", () => {
  assert.equal(classifyRoomJoinStatus({ status: "waiting", joinStatus: "OPEN", expiresAt: unexpired }, now), "JOIN_ALLOWED");
});
