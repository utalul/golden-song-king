/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_OUTPUT_FILE = path.join(
  projectRoot,
  "scripts/song-import/output/storage-upload-report.json"
);
const EXPECTED_PLAN_STATUS = "READY_TO_UPLOAD";
const EXPECTED_OVERWRITE_POLICY = "DO_NOT_OVERWRITE";
const STORAGE_PREFIX = "song-previews";
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 5;
const MAX_UPLOAD_ATTEMPTS = 3;

const MIME_TYPES = Object.freeze({
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg"
});

const UPLOAD_STATUSES = Object.freeze({
  DRY_RUN_READY: "DRY_RUN_READY",
  UPLOADED: "UPLOADED",
  SKIPPED_BLOCKED: "SKIPPED_BLOCKED",
  SKIPPED_EXISTS: "SKIPPED_EXISTS",
  SOURCE_CHANGED: "SOURCE_CHANGED",
  UPLOAD_FAILED: "UPLOAD_FAILED"
});

class GlobalUploadError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GlobalUploadError";
    this.code = code;
  }
}

class ObjectAlreadyExistsError extends Error {
  constructor() {
    super("Storage object 已存在。");
    this.name = "ObjectAlreadyExistsError";
    this.code = "OBJECT_ALREADY_EXISTS";
  }
}

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendUnique(target, value) {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function hasSymlinkSegment(root, sourcePath) {
  const relative = path.relative(root, sourcePath);

  if (!relative || path.isAbsolute(relative)) {
    return false;
  }

  let current = root;

  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);

    if (!fs.existsSync(current)) {
      return false;
    }

    if (fs.lstatSync(current).isSymbolicLink()) {
      return true;
    }
  }

  return false;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new GlobalUploadError(
      "INVALID_JSON",
      `${label} 無法讀取：${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") {
    throw new GlobalUploadError(
      "INVALID_PLAN",
      "Upload plan 必須是 JSON object。"
    );
  }

  if (!Number.isInteger(plan.schemaVersion)) {
    throw new GlobalUploadError(
      "INVALID_PLAN",
      "Upload plan 缺少 schemaVersion。"
    );
  }

  if (!Array.isArray(plan.uploads)) {
    throw new GlobalUploadError(
      "INVALID_PLAN",
      "Upload plan 缺少 uploads array。"
    );
  }

  if (
    typeof plan.sourceManifest !== "string" ||
    !plan.sourceManifest.trim()
  ) {
    throw new GlobalUploadError(
      "INVALID_PLAN",
      "Upload plan 缺少 sourceManifest。"
    );
  }
}

function loadAudioRoot(plan) {
  const manifestFile = path.resolve(plan.sourceManifest);

  if (!fs.existsSync(manifestFile)) {
    throw new GlobalUploadError(
      "SOURCE_MANIFEST_NOT_FOUND",
      "找不到 upload plan 對應的 source manifest。"
    );
  }

  const manifest = readJson(manifestFile, "Source manifest");

  if (
    typeof manifest.audioRoot !== "string" ||
    !manifest.audioRoot.trim()
  ) {
    throw new GlobalUploadError(
      "INVALID_SOURCE_MANIFEST",
      "Source manifest 缺少 audioRoot。"
    );
  }

  const resolved = path.resolve(manifest.audioRoot);

  if (
    !fs.existsSync(resolved) ||
    !fs.statSync(resolved).isDirectory()
  ) {
    throw new GlobalUploadError(
      "AUDIO_ROOT_NOT_FOUND",
      "Source manifest 的 audioRoot 不存在。"
    );
  }

  if (fs.lstatSync(resolved).isSymbolicLink()) {
    throw new GlobalUploadError(
      "AUDIO_ROOT_SYMLINK_NOT_ALLOWED",
      "audioRoot 不可為 symlink。"
    );
  }

  return {
    resolved,
    real: fs.realpathSync(resolved)
  };
}

function destinationPathIsSafe(upload) {
  const extension = upload?.source?.extension?.toLowerCase();
  const expectedPath =
    upload?.songId && MIME_TYPES[extension]
      ? `${STORAGE_PREFIX}/${upload.songId}/preview${extension}`
      : null;
  const storagePath = upload?.destination?.storagePath;

  return (
    typeof storagePath === "string" &&
    storagePath === expectedPath &&
    !storagePath.includes("\\") &&
    !storagePath.split("/").includes("..")
  );
}

function revalidateSource(upload, audioRoot) {
  const errors = [];
  const relativePath = upload?.source?.relativePath;
  const plannedAbsolutePath = upload?.source?.absolutePath;
  const extension = upload?.source?.extension?.toLowerCase();
  const plannedContentType = upload?.destination?.contentType;

  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    path.isAbsolute(relativePath)
  ) {
    appendUnique(errors, "SOURCE_PATH_OUTSIDE_ROOT");
    return { errors, sourcePath: null, sizeBytes: null };
  }

  const sourcePath = path.resolve(audioRoot.resolved, relativePath);

  if (
    !isPathInside(audioRoot.resolved, sourcePath) ||
    typeof plannedAbsolutePath !== "string" ||
    path.resolve(plannedAbsolutePath) !== sourcePath
  ) {
    appendUnique(errors, "SOURCE_PATH_OUTSIDE_ROOT");
    return { errors, sourcePath, sizeBytes: null };
  }

  if (!fs.existsSync(sourcePath)) {
    appendUnique(errors, "SOURCE_FILE_NOT_FOUND");
    return { errors, sourcePath, sizeBytes: null };
  }

  if (hasSymlinkSegment(audioRoot.resolved, sourcePath)) {
    appendUnique(errors, "SYMLINK_NOT_ALLOWED");
    return { errors, sourcePath, sizeBytes: null };
  }

  const stats = fs.lstatSync(sourcePath);

  if (!stats.isFile()) {
    appendUnique(errors, "SOURCE_NOT_A_FILE");
    return { errors, sourcePath, sizeBytes: stats.size };
  }

  if (!isPathInside(audioRoot.real, fs.realpathSync(sourcePath))) {
    appendUnique(errors, "SOURCE_PATH_OUTSIDE_ROOT");
  }

  if (stats.size === 0) {
    appendUnique(errors, "EMPTY_FILE");
  }

  if (upload.source.sizeBytes !== stats.size) {
    appendUnique(errors, "SOURCE_SIZE_CHANGED");
  }

  if (
    !MIME_TYPES[extension] ||
    path.extname(sourcePath).toLowerCase() !== extension
  ) {
    appendUnique(errors, "SOURCE_EXTENSION_CHANGED");
  }

  if (MIME_TYPES[extension] !== plannedContentType) {
    appendUnique(errors, "CONTENT_TYPE_MISMATCH");
  }

  if (!destinationPathIsSafe(upload)) {
    appendUnique(errors, "INVALID_STORAGE_PATH");
  }

  if (upload.overwritePolicy !== EXPECTED_OVERWRITE_POLICY) {
    appendUnique(errors, "INVALID_OVERWRITE_POLICY");
  }

  return { errors, sourcePath, sizeBytes: stats.size };
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function isAlreadyExistsError(error) {
  return (
    error?.code === "OBJECT_ALREADY_EXISTS" ||
    Number(error?.code) === 409 ||
    Number(error?.code) === 412
  );
}

function isTransientError(error) {
  const code = Number(error?.code);
  const textCode = String(error?.code || "").toUpperCase();

  return (
    [408, 429, 500, 502, 503, 504].includes(code) ||
    [
      "ETIMEDOUT",
      "ECONNRESET",
      "EAI_AGAIN",
      "ENETDOWN",
      "ENETUNREACH"
    ].includes(textCode)
  );
}

async function withTransientRetry(operation) {
  let attempt = 1;

  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (
        isAlreadyExistsError(error) ||
        !isTransientError(error) ||
        attempt >= MAX_UPLOAD_ATTEMPTS
      ) {
        throw error;
      }

      await sleep(250 * 2 ** (attempt - 1));
      attempt += 1;
    }
  }
}

function storageMetadata(metadata) {
  if (!metadata) {
    return {
      path: null,
      generation: null,
      sizeBytes: null,
      contentType: null,
      downloadUrl: null
    };
  }

  return {
    path: metadata.name || null,
    generation: metadata.generation || null,
    sizeBytes: Number.isFinite(Number(metadata.size))
      ? Number(metadata.size)
      : null,
    contentType: metadata.contentType || null,
    downloadUrl: null
  };
}

function baseUploadResult(upload) {
  return {
    assetId: upload?.assetId || null,
    songId: upload?.songId || null,
    source: upload?.source || null,
    destination: upload?.destination || null,
    status: null,
    sha256: null,
    storage: storageMetadata(null),
    warnings: [],
    errors: []
  };
}

async function processUpload({
  upload,
  execute,
  adapter,
  audioRoot
}) {
  const result = baseUploadResult(upload);

  if (upload?.status !== EXPECTED_PLAN_STATUS) {
    result.status = UPLOAD_STATUSES.SKIPPED_BLOCKED;
    result.errors = Array.isArray(upload?.errors)
      ? [...upload.errors]
      : ["PLAN_ASSET_BLOCKED"];
    return result;
  }

  let validation;

  try {
    validation = revalidateSource(upload, audioRoot);
  } catch {
    result.status = UPLOAD_STATUSES.SOURCE_CHANGED;
    result.errors.push("SOURCE_REVALIDATION_FAILED");
    return result;
  }

  if (validation.errors.length > 0) {
    result.status = UPLOAD_STATUSES.SOURCE_CHANGED;
    result.errors = validation.errors;
    return result;
  }

  try {
    result.sha256 = await sha256File(validation.sourcePath);
  } catch {
    result.status = UPLOAD_STATUSES.SOURCE_CHANGED;
    result.errors.push("SOURCE_HASH_READ_FAILED");
    return result;
  }

  if (!execute) {
    result.status = UPLOAD_STATUSES.DRY_RUN_READY;
    return result;
  }

  try {
    const existing = await withTransientRetry(() =>
      adapter.getObjectMetadata(upload.destination.storagePath)
    );

    if (existing.exists) {
      result.status = UPLOAD_STATUSES.SKIPPED_EXISTS;
      result.storage = storageMetadata(existing.metadata);
      result.errors.push("OBJECT_ALREADY_EXISTS");
      return result;
    }

    let uploaded;

    try {
      uploaded = await withTransientRetry(() =>
        adapter.uploadCreateOnly({
          assetId: upload.assetId,
          songId: upload.songId,
          sourcePath: validation.sourcePath,
          storagePath: upload.destination.storagePath,
          contentType: upload.destination.contentType,
          sha256: result.sha256
        })
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }

      const racedObject = await adapter.getObjectMetadata(
        upload.destination.storagePath
      );
      const storedHash = racedObject.metadata?.metadata?.sha256;

      if (storedHash === result.sha256) {
        uploaded = racedObject;
        result.warnings.push(
          "UPLOAD_CONFIRMED_AFTER_CREATE_CONFLICT"
        );
      } else {
        result.status = UPLOAD_STATUSES.SKIPPED_EXISTS;
        result.storage = storageMetadata(racedObject.metadata);
        result.errors.push("OBJECT_ALREADY_EXISTS");
        return result;
      }
    }

    result.status = UPLOAD_STATUSES.UPLOADED;
    result.storage = storageMetadata(uploaded.metadata);

    try {
      result.storage.downloadUrl = await adapter.getDownloadUrl(
        upload.destination.storagePath
      );
    } catch {
      result.warnings.push("DOWNLOAD_URL_UNAVAILABLE");
    }

    return result;
  } catch (error) {
    result.status = UPLOAD_STATUSES.UPLOAD_FAILED;
    result.errors.push(
      isAlreadyExistsError(error)
        ? "OBJECT_ALREADY_EXISTS"
        : "UPLOAD_OPERATION_FAILED"
    );
    return result;
  }
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

function buildSummary(results) {
  const count = (status) =>
    results.filter((result) => result.status === status).length;

  return {
    total: results.length,
    eligible: results.filter(
      (result) =>
        result.status !== UPLOAD_STATUSES.SKIPPED_BLOCKED
    ).length,
    uploaded: count(UPLOAD_STATUSES.UPLOADED),
    dryRunReady: count(UPLOAD_STATUSES.DRY_RUN_READY),
    skippedBlocked: count(UPLOAD_STATUSES.SKIPPED_BLOCKED),
    skippedExists: count(UPLOAD_STATUSES.SKIPPED_EXISTS),
    sourceChanged: count(UPLOAD_STATUSES.SOURCE_CHANGED),
    failed: count(UPLOAD_STATUSES.UPLOAD_FAILED),
    totalBytesUploaded: results
      .filter((result) => result.status === UPLOAD_STATUSES.UPLOADED)
      .reduce(
        (total, result) => total + (result.source?.sizeBytes || 0),
        0
      )
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
      ? "EXECUTE MODE - CREATE-ONLY UPLOADS ENABLED"
      : "DRY RUN - NO FILES WILL BE UPLOADED"
  );
  console.log(`總筆數：${report.summary.total}`);
  console.log(`可處理：${report.summary.eligible}`);
  console.log(`已上傳：${report.summary.uploaded}`);
  console.log(`Dry-run ready：${report.summary.dryRunReady}`);
  console.log(`Blocked：${report.summary.skippedBlocked}`);
  console.log(`Already exists：${report.summary.skippedExists}`);
  console.log(`Source changed：${report.summary.sourceChanged}`);
  console.log(`Failed：${report.summary.failed}`);
  console.log(`上傳 bytes：${report.summary.totalBytesUploaded}`);

  report.uploads
    .filter(
      (upload) =>
        ![
          UPLOAD_STATUSES.DRY_RUN_READY,
          UPLOAD_STATUSES.UPLOADED
        ].includes(upload.status)
    )
    .forEach((upload) => {
      console.log(
        `[${upload.status}] ${upload.songId || upload.assetId || "UNKNOWN"}`
      );
    });

  console.log(`Upload report：${outputFile}`);
}

async function createFirebaseStorageAdapter({
  expectedProjectId,
  expectedBucket
}) {
  if (!expectedProjectId) {
    throw new GlobalUploadError(
      "PROJECT_ALLOWLIST_MISSING",
      "缺少 FIREBASE_PROJECT_ID。"
    );
  }

  if (!expectedBucket) {
    throw new GlobalUploadError(
      "BUCKET_ALLOWLIST_MISSING",
      "缺少 FIREBASE_STORAGE_BUCKET。"
    );
  }

  let appModule;
  let storageModule;

  try {
    [appModule, storageModule] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/storage")
    ]);
  } catch {
    throw new GlobalUploadError(
      "STORAGE_INITIALIZATION_FAILED",
      "Firebase Admin Storage 無法載入。"
    );
  }

  const credential = appModule.applicationDefault();
  let credentialProjectId;

  try {
    credentialProjectId = await credential.getProjectId();
  } catch {
    throw new GlobalUploadError(
      "CREDENTIAL_UNAVAILABLE",
      "Application Default Credentials 不可用。"
    );
  }

  if (credentialProjectId !== expectedProjectId) {
    throw new GlobalUploadError(
      "PROJECT_MISMATCH",
      "Credential project 與 FIREBASE_PROJECT_ID 不一致。"
    );
  }

  const appName = `song-audio-upload-${crypto.randomUUID()}`;
  let app;
  let bucket;

  try {
    app = appModule.initializeApp(
      {
        credential,
        projectId: credentialProjectId,
        storageBucket: expectedBucket
      },
      appName
    );
    bucket = storageModule.getStorage(app).bucket(expectedBucket);
  } catch {
    throw new GlobalUploadError(
      "STORAGE_INITIALIZATION_FAILED",
      "Firebase Storage 初始化失敗。"
    );
  }

  if (app.options.projectId !== expectedProjectId) {
    throw new GlobalUploadError(
      "PROJECT_MISMATCH",
      "Firebase app project 與 allowlist 不一致。"
    );
  }

  if (bucket.name !== expectedBucket) {
    throw new GlobalUploadError(
      "BUCKET_MISMATCH",
      "Firebase Storage bucket 與 allowlist 不一致。"
    );
  }

  return {
    identity: {
      projectId: credentialProjectId,
      bucket: bucket.name
    },

    async connectivityCheck() {
      try {
        const [metadata] = await bucket.getMetadata();

        if (metadata.name !== expectedBucket) {
          throw new GlobalUploadError(
            "BUCKET_MISMATCH",
            "Remote bucket 與 allowlist 不一致。"
          );
        }
      } catch (error) {
        if (error instanceof GlobalUploadError) throw error;
        throw new GlobalUploadError(
          "STORAGE_INITIALIZATION_FAILED",
          "無法驗證 Firebase Storage bucket。"
        );
      }
    },

    async getObjectMetadata(storagePath) {
      const file = bucket.file(storagePath);

      try {
        const [metadata] = await file.getMetadata();
        return { exists: true, metadata };
      } catch (error) {
        if (Number(error?.code) === 404) {
          return { exists: false, metadata: null };
        }
        throw error;
      }
    },

    async uploadCreateOnly({
      assetId,
      songId,
      sourcePath,
      storagePath,
      contentType,
      sha256
    }) {
      const file = bucket.file(storagePath);
      const downloadToken = crypto.randomUUID();
      const writeStream = file.createWriteStream({
        resumable: false,
        validation: "crc32c",
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          metadata: {
            songId,
            assetId,
            sha256,
            uploadedBy: "song-import-pipeline",
            firebaseStorageDownloadTokens: downloadToken
          }
        }
      });

      try {
        await pipeline(fs.createReadStream(sourcePath), writeStream);
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          throw new ObjectAlreadyExistsError();
        }
        throw error;
      }

      const [metadata] = await file.getMetadata();
      return { exists: true, metadata };
    },

    async getDownloadUrl(storagePath) {
      return storageModule.getDownloadURL(bucket.file(storagePath));
    }
  };
}

export async function runUploadPipeline({
  plan,
  sourcePlan,
  outputFile,
  execute = false,
  integration = false,
  concurrency = DEFAULT_CONCURRENCY,
  adapter = null
}) {
  validatePlan(plan);

  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) {
    throw new GlobalUploadError(
      "INVALID_CONCURRENCY",
      `Concurrency 必須介於 1 與 ${MAX_CONCURRENCY}。`
    );
  }

  if (execute && integration) {
    throw new GlobalUploadError(
      "INVALID_MODE",
      "--execute 與 --integration 不可同時使用。"
    );
  }

  const audioRoot = loadAudioRoot(plan);
  const shouldConnect = execute || integration;
  let activeAdapter = adapter;
  let projectId = process.env.FIREBASE_PROJECT_ID || null;
  let bucket = process.env.FIREBASE_STORAGE_BUCKET || null;
  let connectivity = "NOT_ATTEMPTED_LOCAL_DRY_RUN";

  if (shouldConnect) {
    activeAdapter =
      activeAdapter ||
      (await createFirebaseStorageAdapter({
        expectedProjectId: process.env.FIREBASE_PROJECT_ID,
        expectedBucket: process.env.FIREBASE_STORAGE_BUCKET
      }));
    await activeAdapter.connectivityCheck();
    projectId = activeAdapter.identity.projectId;
    bucket = activeAdapter.identity.bucket;
    connectivity = "CONNECTED_AND_ALLOWLIST_VERIFIED";
  }

  const mapped = await mapWithConcurrency(
    plan.uploads,
    concurrency,
    (upload) =>
      processUpload({
        upload,
        execute,
        adapter: activeAdapter,
        audioRoot
      })
  );
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    execute,
    mode: execute
      ? "EXECUTE"
      : integration
        ? "REMOTE_DRY_RUN"
        : "LOCAL_DRY_RUN",
    projectId,
    bucket,
    connectivity,
    sourcePlan: path.resolve(sourcePlan),
    concurrency,
    maxObservedConcurrency: mapped.maxActive,
    summary: buildSummary(mapped.results),
    uploads: mapped.results
  };
  const writtenOutput = writeReport(report, outputFile);
  printReport(report, writtenOutput);
  return report;
}

export async function uploadAudioAssets({
  planFile,
  outputFile = DEFAULT_OUTPUT_FILE,
  execute = false,
  integration = false,
  concurrency = DEFAULT_CONCURRENCY
}) {
  const resolvedPlan = path.resolve(planFile);
  const plan = readJson(resolvedPlan, "Upload plan");

  return runUploadPipeline({
    plan,
    sourcePlan: resolvedPlan,
    outputFile,
    execute,
    integration,
    concurrency
  });
}

function createTinyFile(root, relativePath, content = "x") {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function readyUpload({
  assetId,
  songId,
  root,
  relativePath,
  contentType = "audio/mpeg",
  plannedSize = null
}) {
  const absolutePath = path.join(root, relativePath);
  const sizeBytes = plannedSize ?? fs.statSync(absolutePath).size;
  const extension = path.extname(relativePath).toLowerCase();

  return {
    assetId,
    songId,
    source: {
      relativePath,
      absolutePath,
      extension,
      sizeBytes
    },
    destination: {
      storagePath: `${STORAGE_PREFIX}/${songId}/preview${extension}`,
      contentType
    },
    overwritePolicy: EXPECTED_OVERWRITE_POLICY,
    status: EXPECTED_PLAN_STATUS,
    warnings: [],
    errors: []
  };
}

function mockMetadata(storagePath, source, metadata = {}) {
  return {
    name: storagePath,
    generation: "1",
    size: String(source?.sizeBytes || 1),
    contentType: source?.contentType || "audio/mpeg",
    metadata
  };
}

function createMockAdapter({
  existingPaths = [],
  transientFailures = {},
  permanentFailures = [],
  createConflicts = []
} = {}) {
  const objects = new Map();
  const uploadAttempts = new Map();
  let activeUploads = 0;
  let maxActiveUploads = 0;

  existingPaths.forEach((storagePath) => {
    objects.set(
      storagePath,
      mockMetadata(storagePath, null, { sha256: "existing" })
    );
  });

  return {
    identity: {
      projectId: "mock-project",
      bucket: "mock-bucket"
    },
    stats: {
      uploadAttempts,
      get maxActiveUploads() {
        return maxActiveUploads;
      }
    },
    async connectivityCheck() {},
    async getObjectMetadata(storagePath) {
      return {
        exists: objects.has(storagePath),
        metadata: objects.get(storagePath) || null
      };
    },
    async uploadCreateOnly(request) {
      const attempts = (uploadAttempts.get(request.assetId) || 0) + 1;
      uploadAttempts.set(request.assetId, attempts);
      activeUploads += 1;
      maxActiveUploads = Math.max(maxActiveUploads, activeUploads);

      try {
        await sleep(2);

        if (createConflicts.includes(request.assetId)) {
          objects.set(
            request.storagePath,
            mockMetadata(request.storagePath, {
              sizeBytes: 1,
              contentType: request.contentType
            })
          );
          throw new ObjectAlreadyExistsError();
        }

        if (permanentFailures.includes(request.assetId)) {
          const error = new Error("Mock permanent failure");
          error.code = 403;
          throw error;
        }

        if (attempts <= (transientFailures[request.assetId] || 0)) {
          const error = new Error("Mock transient failure");
          error.code = 503;
          throw error;
        }

        const metadata = mockMetadata(
          request.storagePath,
          {
            sizeBytes: fs.statSync(request.sourcePath).size,
            contentType: request.contentType
          },
          { sha256: request.sha256 }
        );
        objects.set(request.storagePath, metadata);
        return { exists: true, metadata };
      } finally {
        activeUploads -= 1;
      }
    },
    async getDownloadUrl(storagePath) {
      return `https://example.invalid/${encodeURIComponent(storagePath)}`;
    }
  };
}

function createTestPlan(root, manifestFile) {
  const fileDefinitions = [
    ["dry-ready.mp3", "x"],
    ["existing.mp3", "x"],
    ["changed.mp3", "xx"],
    ["conflict.mp3", "x"],
    ["transient.mp3", "x"],
    ["permanent.mp3", "x"],
    ["continues.mp3", "x"]
  ];

  fileDefinitions.forEach(([filename, content]) =>
    createTinyFile(root, filename, content)
  );

  fs.writeFileSync(
    manifestFile,
    `${JSON.stringify({
      schemaVersion: 1,
      audioRoot: root,
      assets: []
    })}\n`,
    "utf8"
  );

  const uploads = [
    readyUpload({
      assetId: "ready",
      songId: "M300001",
      root,
      relativePath: "dry-ready.mp3"
    }),
    {
      ...readyUpload({
        assetId: "blocked",
        songId: "M300002",
        root,
        relativePath: "dry-ready.mp3"
      }),
      status: "BLOCKED",
      errors: ["REVIEW_REQUIRED"]
    },
    readyUpload({
      assetId: "existing",
      songId: "M300003",
      root,
      relativePath: "existing.mp3"
    }),
    readyUpload({
      assetId: "changed",
      songId: "M300004",
      root,
      relativePath: "changed.mp3",
      plannedSize: 1
    }),
    readyUpload({
      assetId: "conflict",
      songId: "M300005",
      root,
      relativePath: "conflict.mp3"
    }),
    readyUpload({
      assetId: "transient",
      songId: "M300006",
      root,
      relativePath: "transient.mp3"
    }),
    readyUpload({
      assetId: "permanent",
      songId: "M300007",
      root,
      relativePath: "permanent.mp3"
    }),
    readyUpload({
      assetId: "continues",
      songId: "M300008",
      root,
      relativePath: "continues.mp3"
    })
  ];

  return {
    schemaVersion: 1,
    sourceManifest: manifestFile,
    storagePrefix: STORAGE_PREFIX,
    uploads
  };
}

function statusFor(report, assetId) {
  return report.uploads.find((upload) => upload.assetId === assetId)
    ?.status;
}

async function runWorkflowSelfTest(outputFile) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-storage-upload-fixture-")
  );
  const manifestFile = path.join(tempRoot, "manifest.json");

  try {
    const plan = createTestPlan(tempRoot, manifestFile);
    const dryAdapter = createMockAdapter();
    const dryReport = await runUploadPipeline({
      plan,
      sourcePlan: path.join(tempRoot, "plan.json"),
      outputFile,
      execute: false,
      concurrency: 3,
      adapter: dryAdapter
    });
    const existingPath = plan.uploads.find(
      (upload) => upload.assetId === "existing"
    ).destination.storagePath;
    const executeAdapter = createMockAdapter({
      existingPaths: [existingPath],
      transientFailures: { transient: 2 },
      permanentFailures: ["permanent"],
      createConflicts: ["conflict"]
    });
    const executeReport = await runUploadPipeline({
      plan,
      sourcePlan: path.join(tempRoot, "plan.json"),
      outputFile,
      execute: true,
      concurrency: 3,
      adapter: executeAdapter
    });
    const passed =
      statusFor(dryReport, "ready") ===
        UPLOAD_STATUSES.DRY_RUN_READY &&
      executeAdapter.stats.uploadAttempts.size > 0 &&
      dryAdapter.stats.uploadAttempts.size === 0 &&
      statusFor(executeReport, "blocked") ===
        UPLOAD_STATUSES.SKIPPED_BLOCKED &&
      statusFor(executeReport, "existing") ===
        UPLOAD_STATUSES.SKIPPED_EXISTS &&
      statusFor(executeReport, "changed") ===
        UPLOAD_STATUSES.SOURCE_CHANGED &&
      statusFor(executeReport, "conflict") ===
        UPLOAD_STATUSES.SKIPPED_EXISTS &&
      statusFor(executeReport, "transient") ===
        UPLOAD_STATUSES.UPLOADED &&
      executeAdapter.stats.uploadAttempts.get("transient") === 3 &&
      statusFor(executeReport, "permanent") ===
        UPLOAD_STATUSES.UPLOAD_FAILED &&
      executeAdapter.stats.uploadAttempts.get("permanent") === 1 &&
      statusFor(executeReport, "continues") ===
        UPLOAD_STATUSES.UPLOADED &&
      executeAdapter.stats.maxActiveUploads <= 3;

    writeReport(
      { ...executeReport, testFixture: true },
      outputFile
    );

    return {
      passed,
      dryRunUploadCalls: dryAdapter.stats.uploadAttempts.size,
      transientAttempts:
        executeAdapter.stats.uploadAttempts.get("transient"),
      permanentAttempts:
        executeAdapter.stats.uploadAttempts.get("permanent"),
      maxActiveUploads: executeAdapter.stats.maxActiveUploads,
      summary: executeReport.summary
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function runScaleSelfTest() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-storage-upload-scale-")
  );
  const manifestFile = path.join(tempRoot, "manifest.json");

  try {
    fs.writeFileSync(
      manifestFile,
      `${JSON.stringify({
        schemaVersion: 1,
        audioRoot: tempRoot,
        assets: []
      })}\n`,
      "utf8"
    );
    const uploads = [];

    for (let index = 1; index <= 500; index += 1) {
      const songId = `M${String(400000 + index).padStart(6, "0")}`;
      const relativePath = `${songId}.mp3`;
      createTinyFile(tempRoot, relativePath);
      uploads.push(
        readyUpload({
          assetId: `scale-${index}`,
          songId,
          root: tempRoot,
          relativePath
        })
      );
    }

    const plan = {
      schemaVersion: 1,
      sourceManifest: manifestFile,
      storagePrefix: STORAGE_PREFIX,
      uploads
    };
    const adapter = createMockAdapter();
    const startedAt = Date.now();
    const report = await runUploadPipeline({
      plan,
      sourcePlan: path.join(tempRoot, "plan.json"),
      outputFile: path.join(tempRoot, "report.json"),
      execute: false,
      concurrency: 5,
      adapter
    });

    return {
      passed:
        report.summary.total === 500 &&
        report.summary.dryRunReady === 500 &&
        adapter.stats.uploadAttempts.size === 0 &&
        report.maxObservedConcurrency <= 5 &&
        report.uploads.length === 500,
      durationMs: Date.now() - startedAt,
      uploadCalls: adapter.stats.uploadAttempts.size,
      maxObservedConcurrency: report.maxObservedConcurrency,
      summary: report.summary
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export async function runSelfTest(outputFile = DEFAULT_OUTPUT_FILE) {
  const workflow = await runWorkflowSelfTest(outputFile);
  const scale = await runScaleSelfTest();

  console.log(
    `Uploader workflow：${workflow.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(workflow));
  console.log(
    `Uploader 500-record：${scale.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(scale));
  console.log(`Fixture upload report：${path.resolve(outputFile)}`);

  if (!workflow.passed || !scale.passed) {
    throw new Error("Storage uploader self-test failed。");
  }

  return { workflow, scale };
}

function parseCliArguments(argv) {
  const options = {
    execute: false,
    integration: false,
    selfTest: false,
    concurrency: DEFAULT_CONCURRENCY,
    positional: []
  };

  argv.forEach((argument) => {
    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--integration") {
      options.integration = true;
    } else if (argument === "--self-test") {
      options.selfTest = true;
    } else if (argument.startsWith("--concurrency=")) {
      options.concurrency = Number(argument.split("=")[1]);
    } else {
      options.positional.push(argument);
    }
  });

  return options;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
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
      "用法：node scripts/song-import/audio-assets/uploadAudioAssets.js " +
        "<upload-plan> [output] [--execute|--integration] " +
        "[--concurrency=1..5]"
    );
    process.exitCode = 1;
  } else {
    uploadAudioAssets({
      planFile: resolveCliPath(options.positional[0]),
      outputFile: options.positional[1]
        ? resolveCliPath(options.positional[1])
        : DEFAULT_OUTPUT_FILE,
      execute: options.execute,
      integration: options.integration,
      concurrency: options.concurrency
    }).catch((error) => {
      const code = error?.code || "UPLOAD_PIPELINE_FAILED";
      console.error(code);
      console.error(
        error instanceof Error ? error.message : "Unknown uploader error"
      );
      process.exitCode = 1;
    });
  }
}
