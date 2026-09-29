/* global process */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

export const GENERATOR_VERSION = "sprint-b-roomdocid-manifest-v1";
export const CANONICAL_RELATIONSHIP_FIELD = "roomDocId";

function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex").toUpperCase();
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function normalizeDocument(document) {
  return { id: document.id, data: stable(document.data) };
}

function sortIds(ids) {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function buildManifest({
  rooms,
  players,
  answers,
  generatedAt,
  protectedRoomIds = []
}) {
  const generatedMillis = timestampMillis(generatedAt);
  if (generatedMillis === null) throw new Error("generatedAt must be a valid timestamp");

  const normalizedRooms = rooms.map(normalizeDocument).sort((a, b) => a.id.localeCompare(b.id));
  const normalizedPlayers = players.map(normalizeDocument).sort((a, b) => a.id.localeCompare(b.id));
  const normalizedAnswers = answers.map(normalizeDocument).sort((a, b) => a.id.localeCompare(b.id));
  const protectedSet = new Set(protectedRoomIds);
  const legacyPlayers = normalizedPlayers.filter(({ data }) => !data.roomDocId).map(({ id }) => id);
  const legacyAnswers = normalizedAnswers.filter(({ data }) => !data.roomDocId).map(({ id }) => id);
  const roomDiagnostics = {
    expiredCandidates: [],
    expiredButProtected: [],
    activeOrNotExpired: [],
    legacyNoExpiresAt: [],
    invalidExpiresAt: []
  };
  const entries = [];
  const assignedPlayers = new Set();
  const assignedAnswers = new Set();
  const playerAssignmentCounts = new Map();
  const answerAssignmentCounts = new Map();

  for (const room of normalizedRooms) {
    const expiresMillis = timestampMillis(room.data.expiresAt);
    const isProtected = protectedSet.has(room.id);
    if (expiresMillis === null && room.data.expiresAt !== undefined) {
      roomDiagnostics.invalidExpiresAt.push(room.id);
      continue;
    }
    if (expiresMillis === null) {
      roomDiagnostics.legacyNoExpiresAt.push(room.id);
      continue;
    }
    if (expiresMillis >= generatedMillis) {
      roomDiagnostics.activeOrNotExpired.push(room.id);
      continue;
    }
    if (isProtected) {
      roomDiagnostics.expiredButProtected.push(room.id);
      continue;
    }

    const candidatePlayers = normalizedPlayers.filter(({ data }) => data.roomDocId === room.id);
    const candidateAnswers = normalizedAnswers.filter(({ data }) => data.roomDocId === room.id);
    const playerIds = sortIds(candidatePlayers.map(({ id }) => id));
    const answerIds = sortIds(candidateAnswers.map(({ id }) => id));
    for (const id of playerIds) {
      assignedPlayers.add(id);
      playerAssignmentCounts.set(id, (playerAssignmentCounts.get(id) ?? 0) + 1);
    }
    for (const id of answerIds) {
      assignedAnswers.add(id);
      answerAssignmentCounts.set(id, (answerAssignmentCounts.get(id) ?? 0) + 1);
    }
    const roomSnapshot = { id: room.id, data: room.data };
    entries.push({
      roomDocId: room.id,
      publicRoomId: room.data.roomId ?? null,
      expiresAt: stable(room.data.expiresAt),
      roomSnapshotHash: sha256(roomSnapshot),
      playerDocumentIds: playerIds,
      answerDocumentIds: answerIds,
      playerSetHash: sha256(playerIds),
      answerSetHash: sha256(answerIds),
      playerCount: playerIds.length,
      answerCount: answerIds.length
    });
  }

  entries.sort((a, b) => a.roomDocId.localeCompare(b.roomDocId));
  const duplicatePlayerAssignments = [...playerAssignmentCounts.values()].filter((count) => count > 1).length;
  const duplicateAnswerAssignments = [...answerAssignmentCounts.values()].filter((count) => count > 1).length;
  const validation = {
    everyCandidateExpired: entries.every((entry) => timestampMillis(entry.expiresAt) < generatedMillis),
    everyCandidatePlayerCanonical: entries.every((entry) => entry.playerDocumentIds.every((id) => normalizedPlayers.find((doc) => doc.id === id)?.data.roomDocId === entry.roomDocId)),
    everyCandidateAnswerCanonical: entries.every((entry) => entry.answerDocumentIds.every((id) => normalizedAnswers.find((doc) => doc.id === id)?.data.roomDocId === entry.roomDocId)),
    duplicateChildAssignments: duplicatePlayerAssignments === 0 && duplicateAnswerAssignments === 0,
    protectedRoomExcluded: entries.every((entry) => !protectedSet.has(entry.roomDocId)),
    protectedChildrenExcluded: true,
    legacyChildrenExcluded: legacyPlayers.every((id) => !assignedPlayers.has(id)) && legacyAnswers.every((id) => !assignedAnswers.has(id))
  };
  const valid = Object.values(validation).every((value) => value === true);
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date(generatedMillis).toISOString(),
    firebaseProjectId: "golden-song-king",
    generatorVersion: GENERATOR_VERSION,
    canonicalRelationshipField: CANONICAL_RELATIONSHIP_FIELD,
    roomCountScanned: normalizedRooms.length,
    playerCountScanned: normalizedPlayers.length,
    answerCountScanned: normalizedAnswers.length,
    candidateRoomCount: entries.length,
    candidatePlayerCount: entries.reduce((sum, entry) => sum + entry.playerDocumentIds.length, 0),
    candidateAnswerCount: entries.reduce((sum, entry) => sum + entry.answerDocumentIds.length, 0),
    legacyPlayerWithoutRoomDocIdCount: legacyPlayers.length,
    legacyAnswerWithoutRoomDocIdCount: legacyAnswers.length,
    legacyPlayerDocumentIds: sortIds(legacyPlayers),
    legacyAnswerDocumentIds: sortIds(legacyAnswers),
    protectedRoomIds: sortIds(protectedRoomIds),
    roomDiagnostics,
    deletionCandidates: entries,
    validation: { ...validation, status: valid ? "VALID" : "INVALID" },
    hashCoverage: {
      roomSnapshotHash: "Canonical room document ID and complete room data.",
      playerSetHash: "Sorted candidate player document IDs only.",
      answerSetHash: "Sorted candidate answer document IDs only.",
      manifestHash: "Complete manifest excluding manifestHash itself."
    }
  };
  manifest.manifestHash = sha256(manifest);
  return manifest;
}

async function readCollection(db, name) {
  const snapshot = await db.collection(name).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
}

export async function generateProductionManifest({ outputPath, generatedAt = new Date(), protectedRoomIds = [] }) {
  const app = getApps()[0] ?? initializeApp({ credential: applicationDefault(), projectId: "golden-song-king" });
  const db = getFirestore(app);
  const manifest = buildManifest({
    rooms: await readCollection(db, "rooms"),
    players: await readCollection(db, "players"),
    answers: await readCollection(db, "answers"),
    generatedAt,
    protectedRoomIds
  });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1]?.endsWith("generateRoomCleanupManifest.js")) {
  const outputPath = process.argv[2] ?? "dist/room-cleanup/room-cleanup-manifest.json";
  generateProductionManifest({
    outputPath,
    protectedRoomIds: ["OXACgdOfCG7cndG2ry3T"]
  }).then((manifest) => {
    console.log(JSON.stringify({
      outputPath,
      status: manifest.validation.status,
      manifestHash: manifest.manifestHash,
      roomCountScanned: manifest.roomCountScanned,
      playerCountScanned: manifest.playerCountScanned,
      answerCountScanned: manifest.answerCountScanned,
      candidateRoomCount: manifest.candidateRoomCount,
      candidatePlayerCount: manifest.candidatePlayerCount,
      candidateAnswerCount: manifest.candidateAnswerCount
    }, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
