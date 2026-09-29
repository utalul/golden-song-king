/* global process */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const EXECUTOR_VERSION = "sprint-c-roomdocid-executor-v1";
const PROJECT_ID = "golden-song-king";

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex").toUpperCase();
}

function abort(reason) {
  return { ok: false, abortReason: reason };
}

function exactIds(ids, label) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) throw new Error(`${label} must be an array of non-empty IDs`);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate IDs`);
}

export function validateManifestStructure(manifest) {
  if (!manifest || manifest.schemaVersion !== 1) return abort("UNSUPPORTED_SCHEMA_VERSION");
  if (manifest.firebaseProjectId !== PROJECT_ID) return abort("WRONG_FIREBASE_PROJECT_ID");
  if (manifest.canonicalRelationshipField !== "roomDocId") return abort("WRONG_CANONICAL_RELATIONSHIP_FIELD");
  if (manifest.validation?.status !== "VALID") return abort("MANIFEST_STATUS_NOT_VALID");
  if (typeof manifest.manifestHash !== "string" || manifest.manifestHash !== sha256(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "manifestHash")))) return abort("MANIFEST_HASH_MISMATCH");
  if (!Array.isArray(manifest.deletionCandidates)) return abort("INVALID_CANDIDATE_LIST");
  const roomIds = new Set();
  const playerIds = new Set();
  const answerIds = new Set();
  try {
    for (const entry of manifest.deletionCandidates) {
      if (!entry || typeof entry.roomDocId !== "string" || roomIds.has(entry.roomDocId)) return abort("DUPLICATE_ROOM_ID");
      roomIds.add(entry.roomDocId);
      exactIds(entry.playerDocumentIds, "playerDocumentIds");
      exactIds(entry.answerDocumentIds, "answerDocumentIds");
      for (const id of entry.playerDocumentIds) {
        if (playerIds.has(id)) return abort("DUPLICATE_PLAYER_ID");
        playerIds.add(id);
      }
      for (const id of entry.answerDocumentIds) {
        if (answerIds.has(id)) return abort("DUPLICATE_ANSWER_ID");
        answerIds.add(id);
      }
    }
    if (manifest.candidateRoomCount !== roomIds.size || manifest.candidatePlayerCount !== playerIds.size || manifest.candidateAnswerCount !== answerIds.size) return abort("OPERATION_COUNT_MISMATCH");
  } catch (error) {
    return abort(error.message);
  }
  return { ok: true, roomIds, playerIds, answerIds };
}

async function getExact(db, collection, id) {
  return db.collection(collection).doc(id).get();
}

export async function preflightManifest({ manifest, db, protectedRoomIds = [] }) {
  const structure = validateManifestStructure(manifest);
  if (!structure.ok) return structure;
  const protectedSet = new Set(protectedRoomIds);
  for (const entry of manifest.deletionCandidates) {
    if (protectedSet.has(entry.roomDocId)) return abort("PROTECTED_ROOM_IN_MANIFEST");
    const roomSnapshot = await getExact(db, "rooms", entry.roomDocId);
    if (!roomSnapshot.exists) return abort(`ROOM_MISSING:${entry.roomDocId}`);
    if (sha256({ id: roomSnapshot.id, data: roomSnapshot.data() }) !== entry.roomSnapshotHash) return abort(`ROOM_HASH_MISMATCH:${entry.roomDocId}`);
    const playerIds = [];
    for (const id of entry.playerDocumentIds) {
      const snapshot = await getExact(db, "players", id);
      if (!snapshot.exists) return abort(`PLAYER_MISSING:${id}`);
      if (snapshot.data().roomDocId !== entry.roomDocId) return abort(`PLAYER_ROOMDOCID_MISMATCH:${id}`);
      playerIds.push(snapshot.id);
    }
    if (sha256(playerIds) !== entry.playerSetHash) return abort(`PLAYER_SET_HASH_MISMATCH:${entry.roomDocId}`);
    const answerIds = [];
    for (const id of entry.answerDocumentIds) {
      const snapshot = await getExact(db, "answers", id);
      if (!snapshot.exists) return abort(`ANSWER_MISSING:${id}`);
      if (snapshot.data().roomDocId !== entry.roomDocId) return abort(`ANSWER_ROOMDOCID_MISMATCH:${id}`);
      answerIds.push(snapshot.id);
    }
    if (sha256(answerIds) !== entry.answerSetHash) return abort(`ANSWER_SET_HASH_MISMATCH:${entry.roomDocId}`);
  }
  return { ok: true, expectedRoomDeletes: manifest.candidateRoomCount, expectedPlayerDeletes: manifest.candidatePlayerCount, expectedAnswerDeletes: manifest.candidateAnswerCount, expectedTotalDeletes: manifest.candidateRoomCount + manifest.candidatePlayerCount + manifest.candidateAnswerCount };
}

export async function executeManifest({ manifest, manifestPath = null, db, execute = false, protectedRoomIds = [], emulatorHost = process.env.FIRESTORE_EMULATOR_HOST, reportPath = "dist/room-cleanup/execution-report.json" }) {
  const startedAt = new Date().toISOString();
  const report = { executorVersion: EXECUTOR_VERSION, startedAt, manifestPath, manifestHash: manifest?.manifestHash ?? null, mode: execute ? "EMULATOR_EXECUTE" : "DRY_RUN", preflightStatus: "NOT_RUN", expectedRoomDeletes: 0, expectedPlayerDeletes: 0, expectedAnswerDeletes: 0, expectedTotalDeletes: 0, attemptedRoomDeletes: 0, attemptedPlayerDeletes: 0, attemptedAnswerDeletes: 0, successfulRoomDeletes: 0, successfulPlayerDeletes: 0, successfulAnswerDeletes: 0, abortReason: null, noOp: false };
  if (execute && (!emulatorHost || process.env.GCLOUD_PROJECT === PROJECT_ID)) report.abortReason = "EMULATOR_REQUIRED";
  if (!report.abortReason) {
    const preflight = await preflightManifest({ manifest, db, protectedRoomIds });
    report.preflightStatus = preflight.ok ? "PASS" : "ABORT";
    if (!preflight.ok) report.abortReason = preflight.abortReason;
    else Object.assign(report, preflight);
    if (preflight.ok && report.expectedTotalDeletes === 0) report.noOp = true;
    if (preflight.ok && execute && report.expectedTotalDeletes > 0) {
      for (const entry of manifest.deletionCandidates) {
        for (const id of entry.answerDocumentIds) { report.attemptedAnswerDeletes++; await db.collection("answers").doc(id).delete(); report.successfulAnswerDeletes++; }
        for (const id of entry.playerDocumentIds) { report.attemptedPlayerDeletes++; await db.collection("players").doc(id).delete(); report.successfulPlayerDeletes++; }
        report.attemptedRoomDeletes++; await db.collection("rooms").doc(entry.roomDocId).delete(); report.successfulRoomDeletes++;
      }
    }
  } else report.preflightStatus = "ABORT";
  report.finishedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function loadManifest(manifestPath) {
  if (!manifestPath) throw new Error("Manifest path is required");
  return JSON.parse(await fs.readFile(manifestPath, "utf8"));
}

if (process.argv[1]?.endsWith("executeRoomCleanupManifest.js")) {
  const manifestPath = process.argv[2];
  const execute = process.argv.includes("--execute");
  loadManifest(manifestPath).then(async (manifest) => {
    const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
    const report = await executeManifest({ manifest, manifestPath, db: getFirestore(app), execute, protectedRoomIds: ["OXACgdOfCG7cndG2ry3T"] });
    console.log(JSON.stringify(report, null, 2));
    if (report.abortReason) process.exitCode = 1;
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
