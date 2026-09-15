/* global process */

import assert from "assert/strict";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSongIdentityKey } from "../normalizeSongs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_PLAN_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/firestore-import-dry-run.json"
);
const DEFAULT_OUTPUT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/firestore-import-execute-report.json"
);
const EXPECTED_PROJECT_ID = "golden-song-king";
const PRODUCTION_ORIGIN = "https://golden-song-audio.pages.dev";
const SONG_COLLECTION = "songs";
const EXPECTED_FIRST_ID = 51;
const EXPECTED_LAST_ID = 145;
const EXPECTED_COUNT = 95;
const FINAL_FIRST_ID = 146;
const FINAL_LAST_ID = 159;
const FINAL_COUNT = 14;
const FINAL_IMPORT_PROFILE = "FINAL_14";
const HTTP_CONCURRENCY = 8;
const CREATE_CONCURRENCY = 5;
const MAX_CREATE_ATTEMPTS = 3;
const REQUIRED_DOCUMENT_FIELDS = Object.freeze([
  "id",
  "songName",
  "artist",
  "previewUrl"
]);
const FORBIDDEN_DOCUMENT_FIELDS = Object.freeze([
  "category",
  "decade",
  "difficulty",
  "spotifyId"
]);
const TRANSIENT_ERROR_CODES = new Set([
  "4",
  "8",
  "10",
  "13",
  "14",
  "deadline-exceeded",
  "resource-exhausted",
  "aborted",
  "internal",
  "unavailable"
]);

class ImportExecutionError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ImportExecutionError";
    this.code = code;
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ImportExecutionError(
      "INPUT_READ_FAILED",
      `${label} 無法讀取：${error.message}`
    );
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function expectedSongId(index) {
  return `M${String(index).padStart(6, "0")}`;
}

function expectedPreviewUrl(songId) {
  return `${PRODUCTION_ORIGIN}/${songId}/preview.mp3`;
}

function getProductionProfile(plan) {
  if (plan?.importProfile === FINAL_IMPORT_PROFILE) {
    return {
      firstId: FINAL_FIRST_ID,
      lastId: FINAL_LAST_ID,
      count: FINAL_COUNT,
      protectedLastId: EXPECTED_LAST_ID
    };
  }

  if (!plan?.importProfile) {
    return {
      firstId: EXPECTED_FIRST_ID,
      lastId: EXPECTED_LAST_ID,
      count: EXPECTED_COUNT,
      protectedLastId: EXPECTED_FIRST_ID - 1
    };
  }

  throw new ImportExecutionError(
    "IMPORT_PROFILE_INVALID",
    `不支援的 production import profile：${plan.importProfile}`
  );
}

function sortedKeys(value) {
  return Object.keys(value).sort((left, right) => left.localeCompare(right));
}

function validateCanonicalDocument(songId, document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new ImportExecutionError(
      "INVALID_PLANNED_DOCUMENT",
      `${songId} plannedDocument 格式錯誤。`
    );
  }

  const actualKeys = sortedKeys(document);
  const expectedKeys = [...REQUIRED_DOCUMENT_FIELDS].sort();

  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ImportExecutionError(
      "INVALID_PLANNED_DOCUMENT_FIELDS",
      `${songId} plannedDocument 必須且只能包含正式四欄。`
    );
  }

  if (
    FORBIDDEN_DOCUMENT_FIELDS.some((field) =>
      Object.hasOwn(document, field)
    )
  ) {
    throw new ImportExecutionError(
      "FORBIDDEN_METADATA_FIELD",
      `${songId} plannedDocument 含有未驗證 metadata。`
    );
  }

  if (
    document.id !== songId ||
    !nonEmptyString(document.songName) ||
    !nonEmptyString(document.artist) ||
    document.previewUrl !== expectedPreviewUrl(songId)
  ) {
    throw new ImportExecutionError(
      "INVALID_PLANNED_DOCUMENT_VALUE",
      `${songId} plannedDocument 值不符合 execute allowlist。`
    );
  }
}

function validateDryRunPlan(plan, { enforceProductionCount = true } = {}) {
  const summary = plan?.summary;
  const productionProfile = enforceProductionCount
    ? getProductionProfile(plan)
    : null;

  if (
    plan?.mode !== "READ_ONLY_DRY_RUN" ||
    plan?.firestore?.projectId !== EXPECTED_PROJECT_ID ||
    !summary ||
    summary.previewFailed !== 0 ||
    summary.idConflicts !== 0 ||
    summary.identityConflicts !== 0 ||
    summary.metadataRequired !== 0 ||
    summary.readyToImport !== summary.candidateCount ||
    plan?.safety?.firestoreWrites !== 0
  ) {
    throw new ImportExecutionError(
      "DRY_RUN_NOT_READY",
      "Dry-run report 未通過 execute preconditions。"
    );
  }

  if (!Array.isArray(plan.songs) || plan.songs.length !== summary.candidateCount) {
    throw new ImportExecutionError(
      "DRY_RUN_SONG_COUNT_MISMATCH",
      "Dry-run songs 與 summary 數量不一致。"
    );
  }

  const songs = [...plan.songs].sort((left, right) =>
    left.songId.localeCompare(right.songId, "en")
  );

  if (
    enforceProductionCount &&
    (summary.candidateCount !== productionProfile.count ||
      songs[0]?.songId !== expectedSongId(productionProfile.firstId) ||
      songs.at(-1)?.songId !== expectedSongId(productionProfile.lastId))
  ) {
    throw new ImportExecutionError(
      "DRY_RUN_EXPECTED_RANGE_MISMATCH",
      `Dry-run 必須完整包含 ${expectedSongId(
        productionProfile.firstId
      )}–${expectedSongId(productionProfile.lastId)} 共 ${
        productionProfile.count
      } 首。`
    );
  }

  const ids = new Set();
  const identities = new Set();

  songs.forEach((song, index) => {
    if (
      enforceProductionCount &&
      song.songId !== expectedSongId(productionProfile.firstId + index)
    ) {
      throw new ImportExecutionError(
        "DRY_RUN_ID_GAP",
        "Dry-run proposed IDs 不連續。"
      );
    }

    if (
      ids.has(song.songId) ||
      song.status !== "READY_TO_IMPORT" ||
      song.previewVerified !== true ||
      song.firestoreIdAvailable !== true ||
      song.identityAvailable !== true ||
      song.previewUrl !== expectedPreviewUrl(song.songId)
    ) {
      throw new ImportExecutionError(
        "DRY_RUN_SONG_NOT_READY",
        `${song.songId || "unknown"} 不符合 execute preconditions。`
      );
    }
    ids.add(song.songId);

    validateCanonicalDocument(song.songId, song.plannedDocument);
    const identity = getSongIdentityKey(song.plannedDocument);

    if (!identity || identities.has(identity)) {
      throw new ImportExecutionError(
        "DRY_RUN_DUPLICATE_IDENTITY",
        `${song.songId} identity 無效或重複。`
      );
    }
    identities.add(identity);
  });

  return songs.map((song) => ({
    songId: song.songId,
    songName: song.plannedDocument.songName,
    artist: song.plannedDocument.artist,
    previewUrl: song.plannedDocument.previewUrl,
    plannedDocument: { ...song.plannedDocument },
    identityKey: getSongIdentityKey(song.plannedDocument)
  }));
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker()
    )
  );

  return results;
}

async function probePreview(song, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(song.previewUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { Accept: "audio/mpeg" }
    });
    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();

    return {
      songId: song.songId,
      verified: response.status === 200 && contentType === "audio/mpeg",
      statusCode: response.status,
      contentType: contentType || null
    };
  } catch (error) {
    return {
      songId: song.songId,
      verified: false,
      statusCode: null,
      contentType: null,
      error: sanitizeError(error)
    };
  }
}

function normalizedErrorCode(error) {
  const raw = error?.code ?? error?.status ?? error?.name ?? "UNKNOWN";
  return String(raw)
    .replace(/^\d+\s+/u, "")
    .replace(/^firestore\//u, "")
    .toLowerCase();
}

function isTransientError(error) {
  const rawCode = String(error?.code ?? "").toLowerCase();
  const normalized = normalizedErrorCode(error);
  return TRANSIENT_ERROR_CODES.has(rawCode) || TRANSIENT_ERROR_CODES.has(normalized);
}

function sanitizeError(error) {
  if (!error) return null;

  return {
    code: normalizedErrorCode(error),
    message:
      typeof error.message === "string"
        ? error.message.replace(/[\r\n]+/gu, " ").slice(0, 300)
        : "Unknown error"
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function createWithRetry(adapter, song) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt += 1) {
    try {
      await adapter.createSong(song.songId, song.plannedDocument);
      return {
        songId: song.songId,
        createStatus: "CREATED",
        attempts: attempt,
        error: null
      };
    } catch (error) {
      lastError = error;

      if (!isTransientError(error) || attempt === MAX_CREATE_ATTEMPTS) {
        break;
      }

      await delay(250 * 2 ** (attempt - 1));
    }
  }

  return {
    songId: song.songId,
    createStatus: "FAILED",
    attempts: MAX_CREATE_ATTEMPTS,
    error: sanitizeError(lastError)
  };
}

function canonicalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toMillis === "function") {
    return { __timestampMillis: value.toMillis() };
  }
  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalize(value[key])])
  );
}

function hashDocuments(documents) {
  const canonical = [...documents]
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((document) => ({
      id: document.id,
      exists: document.exists,
      data: document.exists ? canonicalize(document.data) : null
    }));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function protectedSongIds(lastId = EXPECTED_FIRST_ID - 1) {
  return Array.from(
    { length: lastId },
    (_, index) => expectedSongId(index + 1)
  );
}

function extractProtectedSnapshot(existingSongs, lastId) {
  const byId = new Map(existingSongs.map((song) => [song.id, song]));
  const snapshot = protectedSongIds(lastId).map((id) => byId.get(id) || {
    id,
    exists: false,
    data: null
  });

  if (snapshot.some((song) => !song.exists)) {
    throw new ImportExecutionError(
      "PROTECTED_LIBRARY_INCOMPLETE",
      `M000001–${expectedSongId(lastId)} protected snapshot 不完整。`
    );
  }

  return snapshot;
}

function findIdentityConflicts(existingSongs, plannedSongs) {
  const existingByIdentity = new Map();

  for (const song of existingSongs) {
    if (!song.exists) continue;
    const identity = getSongIdentityKey(song.data);
    if (!identity) continue;
    const ids = existingByIdentity.get(identity) || [];
    ids.push(song.id);
    existingByIdentity.set(identity, ids);
  }

  return plannedSongs
    .map((song) => ({
      songId: song.songId,
      conflictingIds: existingByIdentity.get(song.identityKey) || []
    }))
    .filter((item) => item.conflictingIds.length > 0);
}

function exactDocumentMatch(actual, expected) {
  if (!actual || typeof actual !== "object") return false;
  const actualKeys = sortedKeys(actual);
  const expectedKeys = sortedKeys(expected);

  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    REQUIRED_DOCUMENT_FIELDS.every((field) => actual[field] === expected[field])
  );
}

async function createFirestoreAdapter(expectedProjectId) {
  let appModule;
  let firestoreModule;

  try {
    [appModule, firestoreModule] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore")
    ]);
  } catch {
    throw new ImportExecutionError(
      "FIRESTORE_INITIALIZATION_FAILED",
      "Firebase Admin Firestore 無法載入。"
    );
  }

  const credential = appModule.applicationDefault();
  let credentialProjectId;

  try {
    credentialProjectId = await credential.getProjectId();
  } catch {
    throw new ImportExecutionError(
      "CREDENTIAL_UNAVAILABLE",
      "Application Default Credentials 不可用。"
    );
  }

  if (credentialProjectId !== expectedProjectId) {
    throw new ImportExecutionError(
      "PROJECT_MISMATCH",
      `ADC projectId 必須為 ${expectedProjectId}。`
    );
  }

  const app = appModule.initializeApp(
    { credential, projectId: credentialProjectId },
    `firestore-song-import-execute-${crypto.randomUUID()}`
  );
  const firestore = firestoreModule.getFirestore(app);
  let reads = 0;
  let createAttempts = 0;
  let successfulCreates = 0;

  return {
    projectId: credentialProjectId,

    async readDocuments(songIds) {
      const references = songIds.map((songId) =>
        firestore.doc(`${SONG_COLLECTION}/${songId}`)
      );
      const snapshots = await firestore.getAll(...references);
      reads += snapshots.length;

      return snapshots.map((snapshot) => ({
        id: snapshot.id,
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : null
      }));
    },

    async readAllSongs() {
      const snapshot = await firestore.collection(SONG_COLLECTION).get();
      reads += snapshot.size;

      return snapshot.docs.map((document) => ({
        id: document.id,
        exists: true,
        data: document.data()
      }));
    },

    async createSong(songId, data) {
      createAttempts += 1;
      await firestore.doc(`${SONG_COLLECTION}/${songId}`).create(data);
      successfulCreates += 1;
    },

    getStats() {
      return { reads, createAttempts, successfulCreates };
    },

    async close() {
      await appModule.deleteApp(app);
    }
  };
}

export async function executeFirestoreSongImport({
  plan,
  adapter,
  fetchImpl = fetch,
  execute = false,
  enforceProductionCount = true
}) {
  if (!execute) {
    throw new ImportExecutionError(
      "EXECUTE_FLAG_REQUIRED",
      "缺少 --execute；未執行任何 Firestore write。"
    );
  }

  if (adapter.projectId !== EXPECTED_PROJECT_ID) {
    throw new ImportExecutionError(
      "PROJECT_MISMATCH",
      `Firestore project 必須為 ${EXPECTED_PROJECT_ID}。`
    );
  }

  const startedAt = new Date().toISOString();
  const productionProfile = enforceProductionCount
    ? getProductionProfile(plan)
    : getProductionProfile({});
  const plannedSongs = validateDryRunPlan(plan, { enforceProductionCount });
  const previewChecks = await mapWithConcurrency(
    plannedSongs,
    HTTP_CONCURRENCY,
    (song) => probePreview(song, fetchImpl)
  );
  const previewFailures = previewChecks.filter((result) => !result.verified);

  if (previewFailures.length > 0) {
    throw new ImportExecutionError(
      "PREVIEW_REVALIDATION_FAILED",
      `Preview revalidation 失敗：${previewFailures
        .map((item) => item.songId)
        .join(", ")}`
    );
  }

  const plannedIds = plannedSongs.map((song) => song.songId);
  const proposedBefore = await adapter.readDocuments(plannedIds);
  const idConflicts = proposedBefore
    .filter((document) => document.exists)
    .map((document) => document.id);

  if (idConflicts.length > 0) {
    throw new ImportExecutionError(
      "ID_CONFLICT",
      `Proposed IDs 已存在：${idConflicts.join(", ")}`
    );
  }

  const existingBefore = await adapter.readAllSongs();
  const identityConflicts = findIdentityConflicts(existingBefore, plannedSongs);

  if (identityConflicts.length > 0) {
    throw new ImportExecutionError(
      "SONG_IDENTITY_CONFLICT",
      `歌曲 identity 已存在：${identityConflicts
        .map((item) => item.songId)
        .join(", ")}`
    );
  }

  const protectedBefore = extractProtectedSnapshot(
    existingBefore,
    productionProfile.protectedLastId
  );
  const protectedBeforeHash = hashDocuments(protectedBefore);
  const createResults = await mapWithConcurrency(
    plannedSongs,
    CREATE_CONCURRENCY,
    (song) => createWithRetry(adapter, song)
  );
  const readBack = await adapter.readDocuments(plannedIds);
  const readBackById = new Map(readBack.map((document) => [document.id, document]));
  const existingAfter = await adapter.readAllSongs();
  const protectedAfter = extractProtectedSnapshot(
    existingAfter,
    productionProfile.protectedLastId
  );
  const protectedAfterHash = hashDocuments(protectedAfter);
  const protectedExistingUnchanged = protectedBeforeHash === protectedAfterHash;

  const songs = plannedSongs.map((song) => {
    const createResult = createResults.find(
      (result) => result.songId === song.songId
    );
    const actual = readBackById.get(song.songId);
    const readBackVerified =
      actual?.exists === true &&
      exactDocumentMatch(actual.data, song.plannedDocument);

    return {
      songId: song.songId,
      songName: song.songName,
      artist: song.artist,
      previewUrl: song.previewUrl,
      createStatus: createResult.createStatus,
      createAttempts: createResult.attempts,
      readBackVerified,
      error: createResult.error
    };
  });
  const createdCount = songs.filter(
    (song) => song.createStatus === "CREATED"
  ).length;
  const failedCount = songs.length - createdCount;
  const verifiedCount = songs.filter((song) => song.readBackVerified).length;
  const fullySuccessful =
    createdCount === plannedSongs.length &&
    failedCount === 0 &&
    verifiedCount === plannedSongs.length &&
    protectedExistingUnchanged;
  let status = fullySuccessful ? "IMPORT_SUCCESS" : "PARTIAL_IMPORT";

  if (!protectedExistingUnchanged) {
    status = "CRITICAL_FAILURE";
  } else if (createdCount === 0) {
    status = "IMPORT_FAILED";
  }

  const stats = adapter.getStats();

  return {
    mode: "EXECUTE",
    projectId: adapter.projectId,
    startedAt,
    completedAt: new Date().toISOString(),
    plannedCount: plannedSongs.length,
    preWriteCollectionCount: existingBefore.length,
    collectionCountAfter: existingAfter.length,
    previewRevalidated: previewChecks.length,
    preWriteIdConflicts: 0,
    preWriteIdentityConflicts: 0,
    createdCount,
    failedCount,
    verifiedCount,
    status,
    protectedExistingLibrary: {
      range: `M000001-${expectedSongId(
        productionProfile.protectedLastId
      )}`,
      beforeHash: protectedBeforeHash,
      afterHash: protectedAfterHash,
      unchanged: protectedExistingUnchanged
    },
    safety: {
      firestoreCreateAttempts: stats.createAttempts,
      firestoreSuccessfulCreates: stats.successfulCreates,
      cloudflareWrites: 0,
      firebaseStorageWrites: 0,
      sourceAudioWrites: 0
    },
    createdIds: songs
      .filter((song) => song.createStatus === "CREATED")
      .map((song) => song.songId),
    failedIds: songs
      .filter((song) => song.createStatus === "FAILED")
      .map((song) => song.songId),
    readBackMismatches: songs
      .filter((song) => !song.readBackVerified)
      .map((song) => song.songId),
    songs
  };
}

function fixturePlan(overrides = {}) {
  const songs = ["M900001", "M900002"].map((songId, index) => {
    const plannedDocument = {
      id: songId,
      songName: `測試歌曲${index + 1}`,
      artist: `測試歌手${index + 1}`,
      previewUrl: expectedPreviewUrl(songId)
    };

    return {
      songId,
      songName: plannedDocument.songName,
      artist: plannedDocument.artist,
      previewUrl: plannedDocument.previewUrl,
      previewVerified: true,
      firestoreIdAvailable: true,
      identityAvailable: true,
      plannedDocument,
      status: "READY_TO_IMPORT"
    };
  });

  return {
    mode: "READ_ONLY_DRY_RUN",
    firestore: { projectId: EXPECTED_PROJECT_ID, writes: 0 },
    summary: {
      candidateCount: 2,
      previewFailed: 0,
      idConflicts: 0,
      identityConflicts: 0,
      metadataRequired: 0,
      readyToImport: 2
    },
    safety: { firestoreWrites: 0 },
    songs,
    ...overrides
  };
}

function fixtureProtectedSongs() {
  return protectedSongIds().map((id) => ({
    id,
    exists: true,
    data: {
      id,
      songName: `既有歌曲 ${id}`,
      artist: `既有歌手 ${id}`
    }
  }));
}

function createFakeAdapter({
  projectId = EXPECTED_PROJECT_ID,
  existingProposed = [],
  identityConflict = false,
  failCreateIds = [],
  readBackMismatchIds = [],
  tamperProtected = false
} = {}) {
  const store = new Map(
    fixtureProtectedSongs().map((document) => [document.id, document.data])
  );
  const createOnlyPayloads = [];
  let createAttempts = 0;
  let successfulCreates = 0;
  let hasCreated = false;

  for (const id of existingProposed) {
    store.set(id, { id, songName: "已存在", artist: "已存在" });
  }

  if (identityConflict) {
    store.set("M000010", {
      id: "M000010",
      songName: "測試歌曲1",
      artist: "測試歌手1"
    });
  }

  return {
    projectId,
    createOnlyPayloads,
    async readDocuments(ids) {
      return ids.map((id) => {
        const data = store.get(id);
        let returnedData = data ? { ...data } : null;

        if (data && hasCreated && readBackMismatchIds.includes(id)) {
          returnedData = { ...returnedData, songName: "讀回不一致" };
        }
        if (data && hasCreated && tamperProtected && id === "M000001") {
          returnedData = { ...returnedData, songName: "保護資料遭變更" };
        }

        return { id, exists: Boolean(data), data: returnedData };
      });
    },
    async readAllSongs() {
      return [...store.entries()].map(([id, data]) => {
        const returnedData =
          hasCreated && tamperProtected && id === "M000001"
            ? { ...data, songName: "保護資料遭變更" }
            : { ...data };

        return {
          id,
          exists: true,
          data: returnedData
        };
      });
    },
    async createSong(songId, data) {
      createAttempts += 1;
      hasCreated = true;
      createOnlyPayloads.push({ songId, data: { ...data }, operation: "create" });

      if (store.has(songId)) {
        const error = new Error("Document already exists");
        error.code = "already-exists";
        throw error;
      }
      if (failCreateIds.includes(songId)) {
        const error = new Error("Injected failure");
        error.code = "permission-denied";
        throw error;
      }

      store.set(songId, { ...data });
      successfulCreates += 1;
    },
    getStats() {
      return { reads: 0, createAttempts, successfulCreates };
    }
  };
}

function successfulFetch() {
  return Promise.resolve({
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "audio/mpeg" : null;
      }
    }
  });
}

export async function runSelfTest() {
  const plan = fixturePlan();
  const finalProfile = getProductionProfile({
    importProfile: FINAL_IMPORT_PROFILE
  });

  assert.deepEqual(finalProfile, {
    firstId: FINAL_FIRST_ID,
    lastId: FINAL_LAST_ID,
    count: FINAL_COUNT,
    protectedLastId: EXPECTED_LAST_ID
  });
  assert.equal(protectedSongIds(finalProfile.protectedLastId).length, 145);

  await assert.rejects(
    executeFirestoreSongImport({
      plan,
      adapter: createFakeAdapter(),
      fetchImpl: successfulFetch,
      enforceProductionCount: false
    }),
    (error) => error.code === "EXECUTE_FLAG_REQUIRED"
  );

  await assert.rejects(
    executeFirestoreSongImport({
      plan,
      adapter: createFakeAdapter({ projectId: "wrong-project" }),
      fetchImpl: successfulFetch,
      execute: true,
      enforceProductionCount: false
    }),
    (error) => error.code === "PROJECT_MISMATCH"
  );

  await assert.rejects(
    executeFirestoreSongImport({
      plan: fixturePlan({
        summary: { ...plan.summary, readyToImport: 1 }
      }),
      adapter: createFakeAdapter(),
      fetchImpl: successfulFetch,
      execute: true,
      enforceProductionCount: false
    }),
    (error) => error.code === "DRY_RUN_NOT_READY"
  );

  const idConflictAdapter = createFakeAdapter({
    existingProposed: ["M900001"]
  });
  await assert.rejects(
    executeFirestoreSongImport({
      plan,
      adapter: idConflictAdapter,
      fetchImpl: successfulFetch,
      execute: true,
      enforceProductionCount: false
    }),
    (error) => error.code === "ID_CONFLICT"
  );
  assert.equal(idConflictAdapter.createOnlyPayloads.length, 0);

  const identityConflictAdapter = createFakeAdapter({ identityConflict: true });
  await assert.rejects(
    executeFirestoreSongImport({
      plan,
      adapter: identityConflictAdapter,
      fetchImpl: successfulFetch,
      execute: true,
      enforceProductionCount: false
    }),
    (error) => error.code === "SONG_IDENTITY_CONFLICT"
  );
  assert.equal(identityConflictAdapter.createOnlyPayloads.length, 0);

  const successfulAdapter = createFakeAdapter();
  const successful = await executeFirestoreSongImport({
    plan,
    adapter: successfulAdapter,
    fetchImpl: successfulFetch,
    execute: true,
    enforceProductionCount: false
  });
  assert.equal(successful.status, "IMPORT_SUCCESS");
  assert.equal(successful.createdCount, 2);
  assert.equal(successful.verifiedCount, 2);
  assert.equal(successful.protectedExistingLibrary.unchanged, true);
  assert.equal(
    successfulAdapter.createOnlyPayloads.every(
      (operation) =>
        operation.operation === "create" &&
        sortedKeys(operation.data).join(",") ===
          [...REQUIRED_DOCUMENT_FIELDS].sort().join(",")
    ),
    true
  );

  const partial = await executeFirestoreSongImport({
    plan,
    adapter: createFakeAdapter({ failCreateIds: ["M900002"] }),
    fetchImpl: successfulFetch,
    execute: true,
    enforceProductionCount: false
  });
  assert.equal(partial.status, "PARTIAL_IMPORT");
  assert.deepEqual(partial.failedIds, ["M900002"]);

  const mismatch = await executeFirestoreSongImport({
    plan,
    adapter: createFakeAdapter({ readBackMismatchIds: ["M900002"] }),
    fetchImpl: successfulFetch,
    execute: true,
    enforceProductionCount: false
  });
  assert.deepEqual(mismatch.readBackMismatches, ["M900002"]);

  const protectedChange = await executeFirestoreSongImport({
    plan,
    adapter: createFakeAdapter({ tamperProtected: true }),
    fetchImpl: successfulFetch,
    execute: true,
    enforceProductionCount: false
  });
  assert.equal(protectedChange.status, "CRITICAL_FAILURE");
  assert.equal(protectedChange.protectedExistingLibrary.unchanged, false);

  return {
    passed: true,
    checks: {
      missingExecuteFlag: true,
      wrongProject: true,
      dryRunNotReady: true,
      existingIdConflict: true,
      identityConflict: true,
      createOnlyBehavior: true,
      partialFailureReport: true,
      readBackMismatch: true,
      protectedExistingDocumentsUnchanged: true,
      final14Profile: true,
      final14ProtectedRange: true
    }
  };
}

function parseArguments(argv) {
  const options = {
    planFile: DEFAULT_PLAN_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    execute: false,
    selfTest: false,
    help: false
  };
  let positionalPlan;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--self-test") {
      options.selfTest = true;
    } else if (argument === "--help") {
      options.help = true;
    } else if (argument === "--output") {
      options.outputFile = path.resolve(argv[++index]);
    } else if (!argument.startsWith("-") && !positionalPlan) {
      positionalPlan = path.resolve(argument);
    } else {
      throw new ImportExecutionError(
        "UNKNOWN_ARGUMENT",
        `不支援的參數：${argument}`
      );
    }
  }

  if (positionalPlan) options.planFile = positionalPlan;
  return options;
}

function printHelp() {
  console.log(`Firestore song create-only importer

Usage:
  node scripts/song-import/audio-assets/executeFirestoreSongImport.js --self-test
  node scripts/song-import/audio-assets/executeFirestoreSongImport.js <plan.json> --execute

Without --execute, this tool refuses all Firestore writes.`);
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.selfTest) {
    const result = await runSelfTest();
    console.log("Firestore create-only importer self-test：PASS");
    console.log(JSON.stringify(result));
    return;
  }

  if (!options.execute) {
    throw new ImportExecutionError(
      "EXECUTE_FLAG_REQUIRED",
      "缺少 --execute；未執行任何 Firestore write。"
    );
  }

  const configuredProjectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

  if (configuredProjectId !== EXPECTED_PROJECT_ID) {
    throw new ImportExecutionError(
      "PROJECT_ALLOWLIST_MISMATCH",
      `FIREBASE_PROJECT_ID 或 GOOGLE_CLOUD_PROJECT 必須為 ${EXPECTED_PROJECT_ID}。`
    );
  }

  const plan = readJson(options.planFile, "Firestore dry-run report");
  validateDryRunPlan(plan);
  const adapter = await createFirestoreAdapter(EXPECTED_PROJECT_ID);

  try {
    const report = await executeFirestoreSongImport({
      plan,
      adapter,
      execute: true
    });
    writeJson(options.outputFile, report);

    console.log("EXECUTE MODE - CREATE ONLY");
    console.log(`Project：${report.projectId}`);
    console.log(`Planned：${report.plannedCount}`);
    console.log(`Preview revalidated：${report.previewRevalidated}`);
    console.log(`Created：${report.createdCount}`);
    console.log(`Failed：${report.failedCount}`);
    console.log(`Read-back verified：${report.verifiedCount}`);
    console.log(
      `Protected ${report.protectedExistingLibrary.range} unchanged：${report.protectedExistingLibrary.unchanged}`
    );
    console.log(`Collection count after：${report.collectionCountAfter}`);
    console.log(`Status：${report.status}`);
    console.log(`Report：${path.resolve(options.outputFile)}`);

    if (report.status !== "IMPORT_SUCCESS") {
      process.exitCode = 1;
    }
  } finally {
    await adapter.close();
  }
}

if (path.resolve(process.argv[1] || "") === __filename) {
  runCli().catch((error) => {
    console.error(`${error.code || error.name}：${error.message}`);
    process.exitCode = 1;
  });
}
