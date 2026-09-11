/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const OUTPUT_DIRECTORY = path.join(
  projectRoot,
  "scripts/song-import/output"
);
const DEFAULT_OUTPUT_FILE = path.join(
  OUTPUT_DIRECTORY,
  "firestore-preview-sync-report.json"
);
const TRUSTED_SOURCE_PLAN = path.join(
  OUTPUT_DIRECTORY,
  "storage-upload-plan.json"
);
const SONG_COLLECTION = "songs";
const STORAGE_PREFIX = "song-previews";
const SONG_ID_PATTERN = /^M\d{6}$/;
const SUPPORTED_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg"
]);
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;
const MAX_FIRESTORE_ATTEMPTS = 3;
const PROTECTED_SONG_FIELDS = Object.freeze([
  "songName",
  "artist",
  "spotifyId",
  "category",
  "decade",
  "difficulty",
  "id"
]);

const SYNC_STATUSES = Object.freeze({
  DRY_RUN_READY: "DRY_RUN_READY",
  UPDATED: "UPDATED",
  ALREADY_SYNCED: "ALREADY_SYNCED",
  SKIPPED_NOT_UPLOADED: "SKIPPED_NOT_UPLOADED",
  SONG_NOT_FOUND: "SONG_NOT_FOUND",
  SONG_ID_MISMATCH: "SONG_ID_MISMATCH",
  PREVIEW_URL_CONFLICT: "PREVIEW_URL_CONFLICT",
  INVALID_DOWNLOAD_URL: "INVALID_DOWNLOAD_URL",
  STORAGE_PATH_SONG_MISMATCH: "STORAGE_PATH_SONG_MISMATCH",
  UPDATE_FAILED: "UPDATE_FAILED",
  VERIFY_FAILED: "VERIFY_FAILED"
});

class GlobalSyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GlobalSyncError";
    this.code = code;
  }
}

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new GlobalSyncError(
      "INVALID_REPORT_SCHEMA",
      `${label} 無法讀取：${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAllowlist(expectedProjectId, expectedBucket) {
  if (!nonEmptyString(expectedProjectId)) {
    throw new GlobalSyncError(
      "PROJECT_ALLOWLIST_MISSING",
      "缺少 FIREBASE_PROJECT_ID。"
    );
  }

  if (!nonEmptyString(expectedBucket)) {
    throw new GlobalSyncError(
      "BUCKET_ALLOWLIST_MISSING",
      "缺少 FIREBASE_STORAGE_BUCKET。"
    );
  }
}

function hasTestMarker(report) {
  const directFlags = [
    report.selfTest,
    report.self_test,
    report.fixture,
    report.mock,
    report.test
  ];
  const adapterLabel = [
    report.adapter,
    report.adapterType,
    report.provider
  ]
    .filter((value) => typeof value === "string")
    .join(" ");

  return (
    directFlags.some((value) => value === true) ||
    /(?:mock|fixture|self[-_ ]?test)/i.test(adapterLabel)
  );
}

function validateInputReport(
  report,
  { expectedProjectId, expectedBucket }
) {
  validateAllowlist(expectedProjectId, expectedBucket);

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new GlobalSyncError(
      "INVALID_REPORT_SCHEMA",
      "Storage upload report 必須是 JSON object。"
    );
  }

  if (report.execute !== true) {
    throw new GlobalSyncError(
      "REPORT_NOT_EXECUTED",
      "只接受 execute=true 的真實 Storage upload report。"
    );
  }

  if (
    !Number.isInteger(report.schemaVersion) ||
    report.mode !== "EXECUTE" ||
    report.connectivity !== "CONNECTED_AND_ALLOWLIST_VERIFIED" ||
    !Array.isArray(report.uploads) ||
    !nonEmptyString(report.projectId) ||
    !nonEmptyString(report.bucket) ||
    !nonEmptyString(report.sourcePlan)
  ) {
    throw new GlobalSyncError(
      "INVALID_REPORT_SCHEMA",
      "Storage upload report 缺少可信任的 execute metadata。"
    );
  }

  if (hasTestMarker(report)) {
    throw new GlobalSyncError(
      "UNTRUSTED_UPLOAD_REPORT",
      "拒絕 self-test、fixture 或 mock adapter report。"
    );
  }

  if (report.projectId !== expectedProjectId) {
    throw new GlobalSyncError(
      "PROJECT_MISMATCH",
      "Upload report projectId 與 FIREBASE_PROJECT_ID 不一致。"
    );
  }

  if (report.bucket !== expectedBucket) {
    throw new GlobalSyncError(
      "BUCKET_MISMATCH",
      "Upload report bucket 與 FIREBASE_STORAGE_BUCKET 不一致。"
    );
  }

  if (path.resolve(report.sourcePlan) !== TRUSTED_SOURCE_PLAN) {
    throw new GlobalSyncError(
      "UNTRUSTED_UPLOAD_REPORT",
      "Upload report 不是由正式 storage-upload-plan.json 產生。"
    );
  }

  const eligibleSongIds = report.uploads
    .filter(
      (upload) =>
        upload?.status === "UPLOADED" &&
        nonEmptyString(upload?.songId)
    )
    .map((upload) => upload.songId);

  if (new Set(eligibleSongIds).size !== eligibleSongIds.length) {
    throw new GlobalSyncError(
      "INVALID_REPORT_SCHEMA",
      "Upload report 含重複的 UPLOADED songId。"
    );
  }
}

function validateStoragePath(songId, storagePath) {
  if (!SONG_ID_PATTERN.test(songId) || !nonEmptyString(storagePath)) {
    return false;
  }

  const extension = path.posix.extname(storagePath).toLowerCase();
  return (
    SUPPORTED_EXTENSIONS.has(extension) &&
    storagePath === `${STORAGE_PREFIX}/${songId}/preview${extension}`
  );
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function firebaseStorageUrlMatches(url, bucket, storagePath) {
  const parts = url.pathname.split("/");

  if (url.hostname === "firebasestorage.googleapis.com") {
    return (
      parts.length >= 6 &&
      parts[1] === "v0" &&
      parts[2] === "b" &&
      decodeUrlPart(parts[3]) === bucket &&
      parts[4] === "o" &&
      decodeUrlPart(parts.slice(5).join("/")) === storagePath
    );
  }

  if (url.hostname === "storage.googleapis.com") {
    return (
      decodeUrlPart(parts[1]) === bucket &&
      decodeUrlPart(parts.slice(2).join("/")) === storagePath
    );
  }

  if (url.hostname === `${bucket.toLowerCase()}.storage.googleapis.com`) {
    return decodeUrlPart(parts.slice(1).join("/")) === storagePath;
  }

  return false;
}

function validateDownloadUrl(downloadUrl, bucket, storagePath) {
  if (!nonEmptyString(downloadUrl)) return false;

  try {
    const parsed = new URL(downloadUrl);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      (!parsed.port || parsed.port === "443") &&
      firebaseStorageUrlMatches(parsed, bucket, storagePath)
    );
  } catch {
    return false;
  }
}

function normalizeErrorCode(error) {
  const rawCode = String(error?.code || "").toLowerCase();
  return rawCode.includes("/")
    ? rawCode.split("/").at(-1)
    : rawCode;
}

function isTransientFirestoreError(error) {
  const code = normalizeErrorCode(error);
  return [
    "4",
    "8",
    "10",
    "13",
    "14",
    "aborted",
    "deadline-exceeded",
    "internal",
    "resource-exhausted",
    "unavailable"
  ].includes(code);
}

async function withTransientRetry(operation) {
  let attempt = 1;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (
        !isTransientFirestoreError(error) ||
        attempt >= MAX_FIRESTORE_ATTEMPTS
      ) {
        throw error;
      }

      await sleep(100 * 2 ** (attempt - 1));
      attempt += 1;
    }
  }
}

function cloneValue(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function protectedFieldsSnapshot(song) {
  return Object.fromEntries(
    PROTECTED_SONG_FIELDS.map((field) => [
      field,
      cloneValue(song?.[field])
    ])
  );
}

function protectedFieldsMatch(before, after) {
  return PROTECTED_SONG_FIELDS.every(
    (field) =>
      JSON.stringify(before[field]) ===
      JSON.stringify(cloneValue(after?.[field]))
  );
}

function baseSyncRecord(upload) {
  const songId = nonEmptyString(upload?.songId)
    ? upload.songId
    : null;
  const storagePath = nonEmptyString(upload?.storage?.path)
    ? upload.storage.path
    : null;
  const downloadUrl = nonEmptyString(upload?.storage?.downloadUrl)
    ? upload.storage.downloadUrl
    : null;

  return {
    songId,
    storagePath,
    downloadUrl,
    status: null,
    firestore: {
      documentPath: songId ? `${SONG_COLLECTION}/${songId}` : null,
      previousPreviewUrl: null,
      newPreviewUrl: downloadUrl
    },
    warnings: [],
    errors: []
  };
}

function isEligibleUpload(upload) {
  return (
    upload?.status === "UPLOADED" &&
    nonEmptyString(upload?.songId) &&
    nonEmptyString(upload?.storage?.path) &&
    nonEmptyString(upload?.storage?.downloadUrl)
  );
}

async function processSyncRecord({
  upload,
  execute,
  bucket,
  adapter
}) {
  const result = baseSyncRecord(upload);

  if (!isEligibleUpload(upload)) {
    result.status = SYNC_STATUSES.SKIPPED_NOT_UPLOADED;
    if (upload?.status === "UPLOADED") {
      result.errors.push("MISSING_REQUIRED_UPLOAD_FIELDS");
    }
    return result;
  }

  if (!validateStoragePath(result.songId, result.storagePath)) {
    result.status = SYNC_STATUSES.STORAGE_PATH_SONG_MISMATCH;
    result.errors.push("STORAGE_PATH_SONG_MISMATCH");
    return result;
  }

  if (
    !validateDownloadUrl(
      result.downloadUrl,
      bucket,
      result.storagePath
    )
  ) {
    result.status = SYNC_STATUSES.INVALID_DOWNLOAD_URL;
    result.errors.push("INVALID_DOWNLOAD_URL");
    return result;
  }

  let document;

  try {
    document = await withTransientRetry(() =>
      adapter.getSong(result.songId)
    );
  } catch (error) {
    result.status = SYNC_STATUSES.UPDATE_FAILED;
    result.errors.push(
      isTransientFirestoreError(error)
        ? "FIRESTORE_READ_RETRY_EXHAUSTED"
        : "FIRESTORE_READ_FAILED"
    );
    return result;
  }

  if (!document.exists) {
    result.status = SYNC_STATUSES.SONG_NOT_FOUND;
    result.errors.push("SONG_NOT_FOUND");
    return result;
  }

  const song = document.data || {};
  const hasIdField = Object.prototype.hasOwnProperty.call(song, "id");

  if (hasIdField && song.id !== result.songId) {
    result.status = SYNC_STATUSES.SONG_ID_MISMATCH;
    result.errors.push("SONG_ID_MISMATCH");
    return result;
  }

  const previousPreviewUrl = nonEmptyString(song.previewUrl)
    ? song.previewUrl
    : null;
  result.firestore.documentPath = document.path;
  result.firestore.previousPreviewUrl = previousPreviewUrl;

  if (previousPreviewUrl === result.downloadUrl) {
    result.status = SYNC_STATUSES.ALREADY_SYNCED;
    return result;
  }

  if (previousPreviewUrl) {
    result.status = SYNC_STATUSES.PREVIEW_URL_CONFLICT;
    result.errors.push("PREVIEW_URL_CONFLICT");
    return result;
  }

  if (!execute) {
    result.status = SYNC_STATUSES.DRY_RUN_READY;
    return result;
  }

  const protectedBefore = protectedFieldsSnapshot(song);

  try {
    await withTransientRetry(() =>
      adapter.updatePreviewUrl(result.songId, result.downloadUrl)
    );
  } catch (error) {
    result.status = SYNC_STATUSES.UPDATE_FAILED;
    result.errors.push(
      isTransientFirestoreError(error)
        ? "FIRESTORE_WRITE_RETRY_EXHAUSTED"
        : "FIRESTORE_WRITE_FAILED"
    );
    return result;
  }

  let verified;

  try {
    verified = await withTransientRetry(() =>
      adapter.getSong(result.songId)
    );
  } catch (error) {
    result.status = SYNC_STATUSES.VERIFY_FAILED;
    result.errors.push(
      isTransientFirestoreError(error)
        ? "FIRESTORE_VERIFY_RETRY_EXHAUSTED"
        : "FIRESTORE_VERIFY_READ_FAILED"
    );
    return result;
  }

  if (
    !verified.exists ||
    verified.data?.previewUrl !== result.downloadUrl
  ) {
    result.status = SYNC_STATUSES.VERIFY_FAILED;
    result.errors.push("PREVIEW_URL_VERIFY_FAILED");
    return result;
  }

  if (!protectedFieldsMatch(protectedBefore, verified.data)) {
    result.status = SYNC_STATUSES.VERIFY_FAILED;
    result.errors.push("UNRELATED_FIELDS_CHANGED");
    return result;
  }

  result.status = SYNC_STATUSES.UPDATED;
  return result;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let active = 0;
  let maxActive = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);

      try {
        results[index] = await mapper(items[index], index);
      } finally {
        active -= 1;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length || 1) },
      () => worker()
    )
  );

  return { results, maxActive };
}

function buildSummary(records) {
  const count = (status) =>
    records.filter((record) => record.status === status).length;

  return {
    total: records.length,
    eligible: records.filter(
      (record) =>
        record.status !== SYNC_STATUSES.SKIPPED_NOT_UPLOADED
    ).length,
    dryRunReady: count(SYNC_STATUSES.DRY_RUN_READY),
    updated: count(SYNC_STATUSES.UPDATED),
    alreadySynced: count(SYNC_STATUSES.ALREADY_SYNCED),
    skippedNotUploaded: count(
      SYNC_STATUSES.SKIPPED_NOT_UPLOADED
    ),
    notFound: count(SYNC_STATUSES.SONG_NOT_FOUND),
    idMismatch: count(SYNC_STATUSES.SONG_ID_MISMATCH),
    conflicts: count(SYNC_STATUSES.PREVIEW_URL_CONFLICT),
    invalidUrls: count(SYNC_STATUSES.INVALID_DOWNLOAD_URL),
    pathMismatch: count(
      SYNC_STATUSES.STORAGE_PATH_SONG_MISMATCH
    ),
    failed:
      count(SYNC_STATUSES.UPDATE_FAILED) +
      count(SYNC_STATUSES.VERIFY_FAILED)
  };
}

function writeReport(report, outputFile) {
  const resolvedOutput = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(
    resolvedOutput,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  return resolvedOutput;
}

function printReport(report, outputFile) {
  console.log(
    report.execute
      ? "EXECUTE MODE - FIRESTORE previewUrl UPDATES ENABLED"
      : "DRY RUN - NO FIRESTORE DOCUMENTS WILL BE MODIFIED"
  );
  console.log(`總筆數：${report.summary.total}`);
  console.log(`可處理：${report.summary.eligible}`);
  console.log(`Dry-run ready：${report.summary.dryRunReady}`);
  console.log(`已更新：${report.summary.updated}`);
  console.log(`已同步：${report.summary.alreadySynced}`);
  console.log(`略過未上傳：${report.summary.skippedNotUploaded}`);
  console.log(`找不到歌曲：${report.summary.notFound}`);
  console.log(`ID 不一致：${report.summary.idMismatch}`);
  console.log(`既有 URL 衝突：${report.summary.conflicts}`);
  console.log(`無效 URL：${report.summary.invalidUrls}`);
  console.log(`Storage path 不一致：${report.summary.pathMismatch}`);
  console.log(`失敗：${report.summary.failed}`);

  report.records
    .filter(
      (record) =>
        ![
          SYNC_STATUSES.DRY_RUN_READY,
          SYNC_STATUSES.UPDATED,
          SYNC_STATUSES.ALREADY_SYNCED,
          SYNC_STATUSES.SKIPPED_NOT_UPLOADED
        ].includes(record.status)
    )
    .forEach((record) => {
      console.log(`[${record.status}] ${record.songId || "UNKNOWN"}`);
    });

  console.log(`Sync report：${outputFile}`);
}

async function verifyAdapterIdentity(
  adapter,
  expectedProjectId,
  expectedBucket
) {
  if (
    adapter?.identity?.projectId !== expectedProjectId ||
    adapter?.identity?.bucket !== expectedBucket
  ) {
    throw new GlobalSyncError(
      "PROJECT_OR_BUCKET_MISMATCH",
      "Firestore adapter identity 與 allowlist 不一致。"
    );
  }

  try {
    await withTransientRetry(() => adapter.connectivityCheck());
  } catch {
    throw new GlobalSyncError(
      "FIRESTORE_UNAVAILABLE",
      "Firestore read-only connectivity check 失敗。"
    );
  }
}

export async function runPreviewUrlSync({
  uploadReport,
  sourceUploadReport,
  outputFile,
  execute = false,
  concurrency = DEFAULT_CONCURRENCY,
  expectedProjectId,
  expectedBucket,
  adapter
}) {
  validateInputReport(uploadReport, {
    expectedProjectId,
    expectedBucket
  });

  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_CONCURRENCY
  ) {
    throw new GlobalSyncError(
      "INVALID_CONCURRENCY",
      `Concurrency 必須介於 1 與 ${MAX_CONCURRENCY}。`
    );
  }

  if (!adapter) {
    throw new GlobalSyncError(
      "FIRESTORE_INITIALIZATION_FAILED",
      "缺少 Firestore adapter。"
    );
  }

  await verifyAdapterIdentity(
    adapter,
    expectedProjectId,
    expectedBucket
  );

  const mapped = await mapWithConcurrency(
    uploadReport.uploads,
    concurrency,
    (upload) =>
      processSyncRecord({
        upload,
        execute,
        bucket: expectedBucket,
        adapter
      })
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    execute,
    projectId: expectedProjectId,
    bucket: expectedBucket,
    sourceUploadReport: path.resolve(sourceUploadReport),
    concurrency,
    maxObservedConcurrency: mapped.maxActive,
    summary: buildSummary(mapped.results),
    records: mapped.results
  };
  const writtenOutput = writeReport(report, outputFile);
  printReport(report, writtenOutput);
  return report;
}

async function createFirebaseFirestoreAdapter({
  expectedProjectId,
  expectedBucket
}) {
  validateAllowlist(expectedProjectId, expectedBucket);

  let appModule;
  let firestoreModule;

  try {
    [appModule, firestoreModule] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore")
    ]);
  } catch {
    throw new GlobalSyncError(
      "FIRESTORE_INITIALIZATION_FAILED",
      "Firebase Admin Firestore 無法載入。"
    );
  }

  const credential = appModule.applicationDefault();
  let credentialProjectId;

  try {
    credentialProjectId = await credential.getProjectId();
  } catch {
    throw new GlobalSyncError(
      "CREDENTIAL_UNAVAILABLE",
      "Application Default Credentials 不可用。"
    );
  }

  if (credentialProjectId !== expectedProjectId) {
    throw new GlobalSyncError(
      "PROJECT_MISMATCH",
      "Credential project 與 FIREBASE_PROJECT_ID 不一致。"
    );
  }

  const appName = `song-preview-sync-${crypto.randomUUID()}`;
  let app;
  let firestore;

  try {
    app = appModule.initializeApp(
      {
        credential,
        projectId: credentialProjectId,
        storageBucket: expectedBucket
      },
      appName
    );
    firestore = firestoreModule.getFirestore(app);
  } catch {
    throw new GlobalSyncError(
      "FIRESTORE_INITIALIZATION_FAILED",
      "Firebase Admin Firestore 初始化失敗。"
    );
  }

  if (app.options.projectId !== expectedProjectId) {
    throw new GlobalSyncError(
      "PROJECT_MISMATCH",
      "Firebase app project 與 allowlist 不一致。"
    );
  }

  return {
    identity: {
      projectId: credentialProjectId,
      bucket: expectedBucket
    },

    async connectivityCheck() {
      await firestore.collection(SONG_COLLECTION).limit(1).get();
    },

    async getSong(songId) {
      const documentPath = `${SONG_COLLECTION}/${songId}`;
      const snapshot = await firestore.doc(documentPath).get();
      return {
        exists: snapshot.exists,
        path: documentPath,
        data: snapshot.exists ? snapshot.data() : null
      };
    },

    async updatePreviewUrl(songId, downloadUrl) {
      await firestore
        .doc(`${SONG_COLLECTION}/${songId}`)
        .update({ previewUrl: downloadUrl });
    },

    async close() {
      await appModule.deleteApp(app);
    }
  };
}

export async function syncPreviewUrls({
  uploadReportFile,
  outputFile = DEFAULT_OUTPUT_FILE,
  execute = false,
  concurrency = DEFAULT_CONCURRENCY
}) {
  const expectedProjectId = process.env.FIREBASE_PROJECT_ID;
  const expectedBucket = process.env.FIREBASE_STORAGE_BUCKET;
  validateAllowlist(expectedProjectId, expectedBucket);

  const resolvedUploadReport = path.resolve(uploadReportFile);
  const uploadReport = readJson(
    resolvedUploadReport,
    "Storage upload report"
  );
  validateInputReport(uploadReport, {
    expectedProjectId,
    expectedBucket
  });

  const adapter = await createFirebaseFirestoreAdapter({
    expectedProjectId,
    expectedBucket
  });

  try {
    return await runPreviewUrlSync({
      uploadReport,
      sourceUploadReport: resolvedUploadReport,
      outputFile,
      execute,
      concurrency,
      expectedProjectId,
      expectedBucket,
      adapter
    });
  } finally {
    await adapter.close();
  }
}

function createDownloadUrl(bucket, storagePath) {
  return (
    `https://firebasestorage.googleapis.com/v0/b/` +
    `${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}` +
    "?alt=media&token=self-test"
  );
}

function testUpload({
  songId,
  bucket,
  status = "UPLOADED",
  storagePath = `${STORAGE_PREFIX}/${songId}/preview.mp3`,
  downloadUrl = createDownloadUrl(bucket, storagePath)
}) {
  return {
    songId,
    status,
    storage: {
      path: storagePath,
      downloadUrl
    }
  };
}

function testSong(songId, overrides = {}) {
  return {
    id: songId,
    songName: `歌曲 ${songId}`,
    artist: `歌手 ${songId}`,
    spotifyId: `spotify-${songId}`,
    category: "華語",
    decade: "2020",
    difficulty: "normal",
    previewUrl: "",
    ...overrides
  };
}

function firestoreError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createMemoryAdapter({
  projectId,
  bucket,
  documents,
  updateFailures = new Map(),
  tamperReadBack = new Set()
}) {
  const store = new Map(
    [...documents.entries()].map(([songId, song]) => [
      songId,
      cloneValue(song)
    ])
  );
  const stats = {
    activeOperations: 0,
    maxActiveOperations: 0,
    updateAttempts: new Map(),
    updatePayloads: []
  };
  const updatedSongs = new Set();

  async function operation(callback) {
    stats.activeOperations += 1;
    stats.maxActiveOperations = Math.max(
      stats.maxActiveOperations,
      stats.activeOperations
    );
    await sleep(1);

    try {
      return callback();
    } finally {
      stats.activeOperations -= 1;
    }
  }

  return {
    identity: { projectId, bucket },
    stats,
    store,

    async connectivityCheck() {
      return operation(() => true);
    },

    async getSong(songId) {
      return operation(() => {
        const song = store.get(songId);

        if (!song) {
          return {
            exists: false,
            path: `${SONG_COLLECTION}/${songId}`,
            data: null
          };
        }

        const data = cloneValue(song);
        if (updatedSongs.has(songId) && tamperReadBack.has(songId)) {
          data.previewUrl = "https://invalid.example/read-back";
        }

        return {
          exists: true,
          path: `${SONG_COLLECTION}/${songId}`,
          data
        };
      });
    },

    async updatePreviewUrl(songId, downloadUrl) {
      return operation(() => {
        const attempts = (stats.updateAttempts.get(songId) || 0) + 1;
        stats.updateAttempts.set(songId, attempts);
        const failures = updateFailures.get(songId) || [];

        if (failures.length > 0) {
          throw failures.shift();
        }

        if (!store.has(songId)) {
          throw firestoreError("not-found");
        }

        const payload = { previewUrl: downloadUrl };
        stats.updatePayloads.push({ songId, payload });
        store.set(songId, {
          ...store.get(songId),
          ...payload
        });
        updatedSongs.add(songId);
      });
    }
  };
}

function testReport({ projectId, bucket, uploads }) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    execute: true,
    mode: "EXECUTE",
    projectId,
    bucket,
    connectivity: "CONNECTED_AND_ALLOWLIST_VERIFIED",
    sourcePlan: TRUSTED_SOURCE_PLAN,
    summary: {},
    uploads
  };
}

function resultFor(report, songId) {
  return report.records.find((record) => record.songId === songId);
}

async function runFixtureSelfTest(outputFile) {
  const projectId = "golden-song-king";
  const bucket = "golden-song-king.firebasestorage.app";
  const oldUrl = createDownloadUrl(
    bucket,
    `${STORAGE_PREFIX}/M100003/preview.mp3`
  );
  const uploads = [
    testUpload({ songId: "M100001", bucket }),
    testUpload({ songId: "M100002", bucket }),
    testUpload({ songId: "M100003", bucket }),
    testUpload({ songId: "M100004", bucket }),
    testUpload({ songId: "M100005", bucket }),
    testUpload({
      songId: "M100006",
      bucket,
      downloadUrl: "https://example.invalid/not-storage"
    }),
    testUpload({
      songId: "M100007",
      bucket,
      storagePath: `${STORAGE_PREFIX}/M999999/preview.mp3`
    }),
    testUpload({
      songId: "M100008",
      bucket,
      status: "DRY_RUN_READY"
    }),
    testUpload({ songId: "M100009", bucket }),
    testUpload({ songId: "M100010", bucket }),
    testUpload({ songId: "M100011", bucket }),
    testUpload({ songId: "M100012", bucket })
  ];
  const uploadReport = testReport({ projectId, bucket, uploads });
  const documents = new Map([
    ["M100001", testSong("M100001")],
    [
      "M100002",
      testSong("M100002", {
        previewUrl: uploads[1].storage.downloadUrl
      })
    ],
    [
      "M100003",
      testSong("M100003", {
        previewUrl: `${oldUrl}&existing=different`
      })
    ],
    ["M100005", testSong("M999999")],
    ["M100006", testSong("M100006")],
    ["M100007", testSong("M100007")],
    ["M100008", testSong("M100008")],
    ["M100009", testSong("M100009")],
    ["M100010", testSong("M100010")],
    ["M100011", testSong("M100011")],
    ["M100012", testSong("M100012")]
  ]);
  const protectedBefore = protectedFieldsSnapshot(
    documents.get("M100001")
  );
  const dryAdapter = createMemoryAdapter({
    projectId,
    bucket,
    documents
  });
  const dryRun = await runPreviewUrlSync({
    uploadReport,
    sourceUploadReport: path.join(
      OUTPUT_DIRECTORY,
      "storage-upload-report.json"
    ),
    outputFile,
    execute: false,
    concurrency: 5,
    expectedProjectId: projectId,
    expectedBucket: bucket,
    adapter: dryAdapter
  });
  const updateFailures = new Map([
    [
      "M100009",
      [firestoreError("unavailable"), firestoreError("aborted")]
    ],
    ["M100010", [firestoreError("permission-denied")]]
  ]);
  const executeAdapter = createMemoryAdapter({
    projectId,
    bucket,
    documents,
    updateFailures,
    tamperReadBack: new Set(["M100012"])
  });
  const executed = await runPreviewUrlSync({
    uploadReport,
    sourceUploadReport: path.join(
      OUTPUT_DIRECTORY,
      "storage-upload-report.json"
    ),
    outputFile,
    execute: true,
    concurrency: 5,
    expectedProjectId: projectId,
    expectedBucket: bucket,
    adapter: executeAdapter
  });
  let rejectedMockReport = false;
  let rejectedDryUploadReport = false;

  try {
    validateInputReport(
      { ...uploadReport, adapter: "mock-adapter" },
      { expectedProjectId: projectId, expectedBucket: bucket }
    );
  } catch (error) {
    rejectedMockReport = error?.code === "UNTRUSTED_UPLOAD_REPORT";
  }

  try {
    validateInputReport(
      { ...uploadReport, execute: false, mode: "LOCAL_DRY_RUN" },
      { expectedProjectId: projectId, expectedBucket: bucket }
    );
  } catch (error) {
    rejectedDryUploadReport = error?.code === "REPORT_NOT_EXECUTED";
  }

  const dryRunDidNotWrite =
    dryAdapter.stats.updatePayloads.length === 0 &&
    resultFor(dryRun, "M100001")?.status ===
      SYNC_STATUSES.DRY_RUN_READY;
  const unrelatedFieldsUnchanged = protectedFieldsMatch(
    protectedBefore,
    executeAdapter.store.get("M100001")
  );
  const onlyPreviewUrlWasWritten = executeAdapter.stats.updatePayloads.every(
    ({ payload }) =>
      Object.keys(payload).length === 1 &&
      Object.hasOwn(payload, "previewUrl")
  );
  const passed =
    dryRunDidNotWrite &&
    resultFor(executed, "M100001")?.status === SYNC_STATUSES.UPDATED &&
    resultFor(executed, "M100002")?.status ===
      SYNC_STATUSES.ALREADY_SYNCED &&
    resultFor(executed, "M100003")?.status ===
      SYNC_STATUSES.PREVIEW_URL_CONFLICT &&
    resultFor(executed, "M100004")?.status ===
      SYNC_STATUSES.SONG_NOT_FOUND &&
    resultFor(executed, "M100005")?.status ===
      SYNC_STATUSES.SONG_ID_MISMATCH &&
    resultFor(executed, "M100006")?.status ===
      SYNC_STATUSES.INVALID_DOWNLOAD_URL &&
    resultFor(executed, "M100007")?.status ===
      SYNC_STATUSES.STORAGE_PATH_SONG_MISMATCH &&
    resultFor(executed, "M100008")?.status ===
      SYNC_STATUSES.SKIPPED_NOT_UPLOADED &&
    resultFor(executed, "M100009")?.status === SYNC_STATUSES.UPDATED &&
    executeAdapter.stats.updateAttempts.get("M100009") === 3 &&
    resultFor(executed, "M100010")?.status ===
      SYNC_STATUSES.UPDATE_FAILED &&
    executeAdapter.stats.updateAttempts.get("M100010") === 1 &&
    resultFor(executed, "M100011")?.status === SYNC_STATUSES.UPDATED &&
    resultFor(executed, "M100012")?.status ===
      SYNC_STATUSES.VERIFY_FAILED &&
    unrelatedFieldsUnchanged &&
    onlyPreviewUrlWasWritten &&
    rejectedMockReport &&
    rejectedDryUploadReport;

  return {
    passed,
    dryRunDidNotWrite,
    rejectedMockReport,
    rejectedDryUploadReport,
    transientAttempts:
      executeAdapter.stats.updateAttempts.get("M100009"),
    permanentAttempts:
      executeAdapter.stats.updateAttempts.get("M100010"),
    unrelatedFieldsUnchanged,
    onlyPreviewUrlWasWritten,
    maxObservedAdapterConcurrency:
      executeAdapter.stats.maxActiveOperations,
    summary: executed.summary
  };
}

async function runScaleSelfTest(outputFile) {
  const projectId = "golden-song-king";
  const bucket = "golden-song-king.firebasestorage.app";
  const uploads = [];
  const documents = new Map();

  for (let index = 1; index <= 500; index += 1) {
    const songId = `M${String(200000 + index).padStart(6, "0")}`;
    uploads.push(testUpload({ songId, bucket }));
    documents.set(songId, testSong(songId));
  }

  const uploadReport = testReport({ projectId, bucket, uploads });
  const dryAdapter = createMemoryAdapter({
    projectId,
    bucket,
    documents
  });
  const startedAt = Date.now();
  const dryRun = await runPreviewUrlSync({
    uploadReport,
    sourceUploadReport: path.join(
      OUTPUT_DIRECTORY,
      "storage-upload-report.json"
    ),
    outputFile,
    execute: false,
    concurrency: 5,
    expectedProjectId: projectId,
    expectedBucket: bucket,
    adapter: dryAdapter
  });
  const executeAdapter = createMemoryAdapter({
    projectId,
    bucket,
    documents
  });
  const executed = await runPreviewUrlSync({
    uploadReport,
    sourceUploadReport: path.join(
      OUTPUT_DIRECTORY,
      "storage-upload-report.json"
    ),
    outputFile,
    execute: true,
    concurrency: 5,
    expectedProjectId: projectId,
    expectedBucket: bucket,
    adapter: executeAdapter
  });
  const unrelatedFieldsUnchanged = [...documents.keys()].every(
    (songId) =>
      protectedFieldsMatch(
        protectedFieldsSnapshot(documents.get(songId)),
        executeAdapter.store.get(songId)
      )
  );
  const passed =
    dryRun.summary.dryRunReady === 500 &&
    dryRun.summary.updated === 0 &&
    dryAdapter.stats.updatePayloads.length === 0 &&
    executed.summary.updated === 500 &&
    executed.summary.failed === 0 &&
    executeAdapter.stats.updatePayloads.length === 500 &&
    executeAdapter.stats.maxActiveOperations <= 5 &&
    unrelatedFieldsUnchanged;

  return {
    passed,
    durationMs: Date.now() - startedAt,
    dryRunReady: dryRun.summary.dryRunReady,
    updated: executed.summary.updated,
    maxObservedConcurrency:
      executeAdapter.stats.maxActiveOperations,
    unrelatedFieldsUnchanged
  };
}

export async function runSelfTest(outputFile = DEFAULT_OUTPUT_FILE) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-firestore-sync-test-")
  );

  try {
    const testOutput = outputFile || path.join(tempRoot, "sync-report.json");
    const fixture = await runFixtureSelfTest(testOutput);
    const scale = await runScaleSelfTest(testOutput);

    console.log(
      `Firestore sync fixture：${fixture.passed ? "PASS" : "FAIL"}`
    );
    console.log(JSON.stringify(fixture));
    console.log(
      `Firestore sync 500-record：${scale.passed ? "PASS" : "FAIL"}`
    );
    console.log(JSON.stringify(scale));
    console.log(`Fixture sync report：${path.resolve(testOutput)}`);

    if (!fixture.passed || !scale.passed) {
      throw new Error("Firestore previewUrl sync self-test failed。 ");
    }

    return { fixture, scale };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseCliArguments(argv) {
  const options = {
    execute: false,
    selfTest: false,
    concurrency: DEFAULT_CONCURRENCY,
    positional: []
  };

  argv.forEach((argument) => {
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--self-test") {
      options.selfTest = true;
    } else if (argument.startsWith("--concurrency=")) {
      options.concurrency = Number(argument.split("=")[1]);
    } else if (argument.startsWith("--")) {
      throw new GlobalSyncError(
        "INVALID_ARGUMENT",
        `不支援的參數：${argument}`
      );
    } else {
      options.positional.push(argument);
    }
  });

  return options;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    const options = parseCliArguments(process.argv.slice(2));

    if (options.selfTest) {
      runSelfTest(
        options.positional[0]
          ? resolveCliPath(options.positional[0])
          : DEFAULT_OUTPUT_FILE
      ).catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    } else if (!options.positional[0]) {
      console.error(
        "用法：node scripts/song-import/audio-assets/syncPreviewUrls.js " +
          "<upload-report> [output] [--execute] [--concurrency=1..10]"
      );
      process.exitCode = 1;
    } else {
      syncPreviewUrls({
        uploadReportFile: resolveCliPath(options.positional[0]),
        outputFile: options.positional[1]
          ? resolveCliPath(options.positional[1])
          : DEFAULT_OUTPUT_FILE,
        execute: options.execute,
        concurrency: options.concurrency
      }).catch((error) => {
        const code = error?.code || "PREVIEW_SYNC_FAILED";
        console.error(code);
        console.error(
          error instanceof Error ? error.message : "Unknown sync error"
        );
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(error?.code || "INVALID_ARGUMENT");
    console.error(
      error instanceof Error ? error.message : "Unknown argument error"
    );
    process.exitCode = 1;
  }
}
