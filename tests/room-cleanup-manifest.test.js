import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManifest, sha256 } from "../scripts/generateRoomCleanupManifest.js";

const NOW = "2026-09-29T12:00:00.000Z";
const room = (id, roomId, expiresAt, extra = {}) => ({ id, data: { roomId, expiresAt, ...extra } });
const child = (id, data) => ({ id, data });

test("expired rooms become candidates and non-expired or legacy rooms do not", () => {
  const manifest = buildManifest({
    generatedAt: NOW,
    rooms: [room("expired", "123456", "2026-09-28T00:00:00.000Z"), room("active", "654321", "2026-10-01T00:00:00.000Z"), { id: "legacy", data: {} }],
    players: [],
    answers: []
  });
  assert.deepEqual(manifest.deletionCandidates.map((entry) => entry.roomDocId), ["expired"]);
  assert.deepEqual(manifest.roomDiagnostics.activeOrNotExpired, ["active"]);
  assert.deepEqual(manifest.roomDiagnostics.legacyNoExpiresAt, ["legacy"]);
});

test("invalid expiresAt is excluded", () => {
  const manifest = buildManifest({ generatedAt: NOW, rooms: [room("bad", "123456", "not-a-date")], players: [], answers: [] });
  assert.equal(manifest.candidateRoomCount, 0);
  assert.deepEqual(manifest.roomDiagnostics.invalidExpiresAt, ["bad"]);
});

test("expired protected room is excluded", () => {
  const manifest = buildManifest({ generatedAt: NOW, protectedRoomIds: ["protected"], rooms: [room("protected", "123456", "2026-01-01T00:00:00.000Z")], players: [], answers: [] });
  assert.equal(manifest.validation.status, "VALID");
  assert.equal(manifest.candidateRoomCount, 0);
  assert.deepEqual(manifest.roomDiagnostics.expiredButProtected, ["protected"]);
});

test("children are selected only by exact roomDocId, never public roomId", () => {
  const manifest = buildManifest({
    generatedAt: NOW,
    rooms: [room("DOC_A", "123456", "2026-01-01T00:00:00.000Z"), room("123456", "654321", "2026-01-01T00:00:00.000Z")],
    players: [child("a", { roomDocId: "DOC_A", roomId: "123456" }), child("wrong", { roomId: "123456" }), child("other", { roomDocId: "123456", roomId: "654321" })],
    answers: [child("answer-a", { roomDocId: "DOC_A", roomId: "123456" }), child("answer-wrong", { roomId: "123456" })]
  });
  const entry = manifest.deletionCandidates.find((candidate) => candidate.roomDocId === "DOC_A");
  assert.deepEqual(entry.playerDocumentIds, ["a"]);
  assert.deepEqual(entry.answerDocumentIds, ["answer-a"]);
  assert.equal(manifest.legacyPlayerWithoutRoomDocIdCount, 1);
  assert.equal(manifest.legacyAnswerWithoutRoomDocIdCount, 1);
});

test("zero-candidate manifests are valid and deterministic", () => {
  const input = { generatedAt: NOW, protectedRoomIds: ["protected"], rooms: [room("protected", "123456", "2020-01-01T00:00:00.000Z")], players: [], answers: [] };
  const first = buildManifest(input);
  const second = buildManifest(input);
  assert.equal(first.validation.status, "VALID");
  assert.equal(first.candidateRoomCount, 0);
  assert.equal(first.manifestHash, second.manifestHash);
});

test("sorting and set hashes are deterministic and change when IDs change", () => {
  const input = { generatedAt: NOW, rooms: [room("room", "123456", "2020-01-01T00:00:00.000Z")], players: [child("b", { roomDocId: "room" }), child("a", { roomDocId: "room" })], answers: [] };
  const manifest = buildManifest(input);
  assert.deepEqual(manifest.deletionCandidates[0].playerDocumentIds, ["a", "b"]);
  assert.notEqual(manifest.deletionCandidates[0].playerSetHash, sha256(["a"]));
  assert.equal(manifest.manifestHash, buildManifest(input).manifestHash);
});
