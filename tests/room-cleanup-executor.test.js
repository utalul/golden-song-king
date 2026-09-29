/* global process */

import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildManifest } from "../scripts/generateRoomCleanupManifest.js";
import { executeManifest, preflightManifest, sha256, validateManifestStructure } from "../scripts/executeRoomCleanupManifest.js";

const room = (id, roomId = "123456") => ({ id, data: { roomId, expiresAt: "2020-01-01T00:00:00.000Z", state: "WAITING" } });
const child = (id, roomDocId) => ({ id, data: { roomDocId, roomId: "123456" } });
const fixture = () => {
  const rooms = [room("DOC_A"), room("OTHER", "654321")];
  const players = [child("player-a", "DOC_A"), child("player-other", "OTHER"), child("decoy-public", "NOPE"), { id: "legacy-player", data: { roomId: "DOC_A" } }];
  const answers = [child("answer-a", "DOC_A"), child("answer-other", "OTHER"), child("decoy-answer", "NOPE"), { id: "legacy-answer", data: { roomId: "DOC_A" } }];
  const manifest = buildManifest({ rooms: [rooms[0]], players: [players[0]], answers: [answers[0]], generatedAt: "2021-01-01T00:00:00.000Z" });
  return { rooms, players, answers, manifest };
};
const fakeDb = (data) => ({ collection: (name) => ({ doc: (id) => ({ get: async () => { const item = data[name].find((value) => value.id === id); return { id, exists: Boolean(item), data: () => item?.data }; }, delete: async () => { data[name] = data[name].filter((value) => value.id !== id); } }) }) });
const refreshHash = (manifest) => ({ ...manifest, manifestHash: sha256(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifestHash"))) });

test("valid manifest dry-run performs zero deletes", async () => {
  const f = fixture(); const db = fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers });
  const report = await executeManifest({ manifest: f.manifest, db, reportPath: ".tmp-executor-report.json" });
  assert.equal(report.preflightStatus, "PASS"); assert.equal(report.expectedTotalDeletes, 3); assert.equal(report.successfulRoomDeletes, 0);
});
test("execute without emulator aborts", async () => { const f = fixture(); const report = await executeManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }), execute: true, emulatorHost: "", reportPath: ".tmp-executor-report.json" }); assert.equal(report.abortReason, "EMULATOR_REQUIRED"); });
test("empty manifest is valid no-op", async () => { const manifest = buildManifest({ rooms: [], players: [], answers: [], generatedAt: "2021-01-01T00:00:00.000Z" }); const report = await executeManifest({ manifest, db: fakeDb({ rooms: [], players: [], answers: [] }), reportPath: ".tmp-executor-report.json" }); assert.equal(report.noOp, true); assert.equal(report.expectedTotalDeletes, 0); });
const invalidManifests = [
  ["hash", (m) => ({ ...m, manifestHash: "BAD" })],
  ["schema", (m) => ({ ...m, schemaVersion: 99 })],
  ["project", (m) => ({ ...m, firebaseProjectId: "wrong" })],
  ["relationship", (m) => ({ ...m, canonicalRelationshipField: "roomId" })],
  ["status", (m) => ({ ...m, validation: { ...m.validation, status: "INVALID" } })]
];
for (const [label, change] of invalidManifests) {
  test(`manifest ${label} mismatch aborts`, () => { const f = fixture(); assert.equal(validateManifestStructure(change(f.manifest)).ok, false); });
}
test("preflight protects all-or-nothing and detects stale room", async () => { const f = fixture(); const db = fakeDb({ rooms: [{ id: "DOC_A", data: { ...f.rooms[0].data, state: "PLAYING" } }], players: f.players, answers: f.answers }); const result = await preflightManifest({ manifest: f.manifest, db }); assert.match(result.abortReason, /ROOM_HASH_MISMATCH/); });
test("exact roomDocId scope deletes only listed records", async () => { const f = fixture(); const data = { rooms: f.rooms, players: f.players, answers: f.answers }; const report = await executeManifest({ manifest: f.manifest, db: fakeDb(data), execute: true, emulatorHost: "127.0.0.1:8080", reportPath: ".tmp-executor-report.json" }); assert.equal(report.preflightStatus, "PASS"); assert.deepEqual(data.rooms.map((x) => x.id), ["OTHER"]); assert.deepEqual(data.players.map((x) => x.id).sort(), ["decoy-public", "legacy-player", "player-other"]); assert.deepEqual(data.answers.map((x) => x.id).sort(), ["answer-other", "decoy-answer", "legacy-answer"]); });

test("protected room aborts before deletion", async () => { const f = fixture(); const result = await preflightManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }), protectedRoomIds: ["DOC_A"] }); assert.equal(result.abortReason, "PROTECTED_ROOM_IN_MANIFEST"); });
test("duplicate player ID aborts", () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, deletionCandidates: [{ ...f.manifest.deletionCandidates[0], playerDocumentIds: ["player-a", "player-a"] }] }); assert.match(validateManifestStructure(manifest).abortReason, /duplicate IDs/); });
test("duplicate answer ID aborts", () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, deletionCandidates: [{ ...f.manifest.deletionCandidates[0], answerDocumentIds: ["answer-a", "answer-a"] }] }); assert.match(validateManifestStructure(manifest).abortReason, /duplicate IDs/); });
test("same child assigned to multiple rooms aborts", () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, candidateRoomCount: 2, deletionCandidates: [...f.manifest.deletionCandidates, { ...f.manifest.deletionCandidates[0], roomDocId: "OTHER" }] }); assert.equal(validateManifestStructure(manifest).abortReason, "DUPLICATE_PLAYER_ID"); });
test("operation count mismatch aborts", () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, candidatePlayerCount: 2 }); assert.equal(validateManifestStructure(manifest).abortReason, "OPERATION_COUNT_MISMATCH"); });
test("missing player aborts", async () => { const f = fixture(); const result = await preflightManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: [], answers: f.answers }) }); assert.match(result.abortReason, /PLAYER_MISSING/); });
test("player roomDocId mismatch aborts", async () => { const f = fixture(); const result = await preflightManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: [child("player-a", "OTHER")], answers: f.answers }) }); assert.match(result.abortReason, /PLAYER_ROOMDOCID_MISMATCH/); });
test("player set hash mismatch aborts", async () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, deletionCandidates: [{ ...f.manifest.deletionCandidates[0], playerSetHash: "BAD" }] }); const result = await preflightManifest({ manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }) }); assert.match(result.abortReason, /PLAYER_SET_HASH_MISMATCH/); });
test("missing answer aborts", async () => { const f = fixture(); const result = await preflightManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: [] }) }); assert.match(result.abortReason, /ANSWER_MISSING/); });
test("answer roomDocId mismatch aborts", async () => { const f = fixture(); const result = await preflightManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: [child("answer-a", "OTHER")] }) }); assert.match(result.abortReason, /ANSWER_ROOMDOCID_MISMATCH/); });
test("answer set hash mismatch aborts", async () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, deletionCandidates: [{ ...f.manifest.deletionCandidates[0], answerSetHash: "BAD" }] }); const result = await preflightManifest({ manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }) }); assert.match(result.abortReason, /ANSWER_SET_HASH_MISMATCH/); });
test("multi-room stale candidate aborts before first delete", async () => { const f = fixture(); const data = { rooms: [...f.rooms], players: f.players, answers: f.answers }; const second = buildManifest({ rooms: [f.rooms[1]], players: [f.players[1]], answers: [f.answers[1]], generatedAt: "2021-01-01T00:00:00.000Z" }).deletionCandidates[0]; const manifest = { ...f.manifest, candidateRoomCount: 2, candidatePlayerCount: 2, candidateAnswerCount: 2, deletionCandidates: [...f.manifest.deletionCandidates, second] }; const report = await executeManifest({ manifest, db: fakeDb(data), execute: true, emulatorHost: "127.0.0.1:8080", reportPath: ".tmp-executor-report.json" }); assert.equal(report.preflightStatus, "ABORT"); assert.equal(data.rooms.length, 2); });
test("public roomId decoys and legacy children survive", async () => { const f = fixture(); const data = { rooms: f.rooms, players: f.players, answers: f.answers }; await executeManifest({ manifest: f.manifest, db: fakeDb(data), execute: true, emulatorHost: "127.0.0.1:8080", reportPath: ".tmp-executor-report.json" }); assert.ok(data.players.some((item) => item.id === "decoy-public")); assert.ok(data.players.some((item) => item.id === "legacy-player")); assert.ok(data.answers.some((item) => item.id === "decoy-answer")); assert.ok(data.answers.some((item) => item.id === "legacy-answer")); });
test("no discovery queries are needed by preflight", async () => { const f = fixture(); let queried = false; const db = { collection: (name) => { if (name === "rooms" || name === "players" || name === "answers") return fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }).collection(name); queried = true; throw new Error("unexpected query"); } }; const result = await preflightManifest({ manifest: f.manifest, db }); assert.equal(result.ok, true); assert.equal(queried, false); });

test("emulator integration deletes only exact manifest paths", { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: "golden-song-king-sprint-c" });
  const db = getFirestore(app);
  const data = fixture();
  for (const item of data.rooms) await db.collection("rooms").doc(item.id).set(item.data);
  for (const item of data.players) await db.collection("players").doc(item.id).set(item.data);
  for (const item of data.answers) await db.collection("answers").doc(item.id).set(item.data);
  const report = await executeManifest({ manifest: data.manifest, db, execute: true, emulatorHost: process.env.FIRESTORE_EMULATOR_HOST, reportPath: ".tmp-executor-report.json" });
  assert.equal(report.preflightStatus, "PASS");
  assert.equal((await db.collection("rooms").doc("DOC_A").get()).exists, false);
  assert.equal((await db.collection("rooms").doc("OTHER").get()).exists, true);
  assert.equal((await db.collection("players").doc("legacy-player").get()).exists, true);
  assert.equal((await db.collection("answers").doc("legacy-answer").get()).exists, true);
});
test("dry-run report records zero successful deletes", async () => { const f = fixture(); const report = await executeManifest({ manifest: f.manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }), reportPath: ".tmp-executor-report.json" }); assert.equal(report.mode, "DRY_RUN"); assert.equal(report.successfulTotalDeletes, undefined); assert.equal(report.successfulRoomDeletes, 0); });
test("preflight failure has zero attempted deletes", async () => { const f = fixture(); const report = await executeManifest({ manifest: f.manifest, db: fakeDb({ rooms: [], players: f.players, answers: f.answers }), execute: true, emulatorHost: "127.0.0.1:8080", reportPath: ".tmp-executor-report.json" }); assert.equal(report.preflightStatus, "ABORT"); assert.equal(report.attemptedRoomDeletes, 0); });
test("manifest path is caller supplied", async () => { const f = fixture(); const report = await executeManifest({ manifest: f.manifest, manifestPath: "approved.json", db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }), reportPath: ".tmp-executor-report.json" }); assert.equal(report.manifestPath, "approved.json"); });
test("empty manifest reports no-op mode without execute", async () => { const manifest = buildManifest({ rooms: [], players: [], answers: [], generatedAt: "2021-01-01T00:00:00.000Z" }); const report = await executeManifest({ manifest, db: fakeDb({ rooms: [], players: [], answers: [] }), reportPath: ".tmp-executor-report.json" }); assert.equal(report.noOp, true); assert.equal(report.mode, "DRY_RUN"); });
test("room hash is required for every candidate", async () => { const f = fixture(); const manifest = refreshHash({ ...f.manifest, deletionCandidates: [{ ...f.manifest.deletionCandidates[0], roomSnapshotHash: "BAD" }] }); const result = await preflightManifest({ manifest, db: fakeDb({ rooms: f.rooms, players: f.players, answers: f.answers }) }); assert.match(result.abortReason, /ROOM_HASH_MISMATCH/); });
test("protected list is checked before child reads", async () => { const f = fixture(); let childRead = false; const db = { collection: (name) => ({ doc: (id) => ({ get: async () => { if (name !== "rooms") childRead = true; return { id, exists: true, data: () => f.rooms[0].data }; } }) }) }; const result = await preflightManifest({ manifest: f.manifest, db, protectedRoomIds: ["DOC_A"] }); assert.equal(result.ok, false); assert.equal(childRead, false); });
test("successful counts equal expected counts", async () => { const f = fixture(); const data = { rooms: f.rooms, players: f.players, answers: f.answers }; const report = await executeManifest({ manifest: f.manifest, db: fakeDb(data), execute: true, emulatorHost: "127.0.0.1:8080", reportPath: ".tmp-executor-report.json" }); assert.equal(report.successfulTotalDeletes, undefined); assert.equal(report.successfulRoomDeletes + report.successfulPlayerDeletes + report.successfulAnswerDeletes, report.expectedTotalDeletes); });
