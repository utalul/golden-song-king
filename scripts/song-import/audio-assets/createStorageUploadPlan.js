/* global process */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_OUTPUT_FILE = path.join(
  projectRoot,
  "scripts/song-import/output/storage-upload-plan.json"
);
const STORAGE_PREFIX = "song-previews";
const OVERWRITE_POLICY = "DO_NOT_OVERWRITE";
const READY_TO_UPLOAD = "READY_TO_UPLOAD";
const BLOCKED = "BLOCKED";
const ELIGIBLE_ASSET_STATUS = "AUTO_MATCH";
const SONG_ID_PATTERN = /^M\d{6}$/;

const MIME_TYPES = Object.freeze({
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg"
});

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function readManifest(manifestFile) {
  const manifest = JSON.parse(
    fs.readFileSync(manifestFile, "utf8")
  );

  if (!manifest || typeof manifest !== "object") {
    throw new Error("Audio asset manifest 必須是 JSON object。");
  }

  if (!Number.isInteger(manifest.schemaVersion)) {
    throw new Error("Audio asset manifest 缺少 schemaVersion。");
  }

  if (
    typeof manifest.audioRoot !== "string" ||
    !manifest.audioRoot.trim()
  ) {
    throw new Error("Audio asset manifest 缺少 audioRoot。");
  }

  if (!Array.isArray(manifest.assets)) {
    throw new Error("Audio asset manifest 缺少 assets array。");
  }

  return manifest;
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

function appendUnique(target, value) {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function validAssetShape(asset) {
  return (
    asset &&
    typeof asset === "object" &&
    typeof asset.assetId === "string" &&
    asset.match &&
    typeof asset.match === "object"
  );
}

function normalizedExtension(asset) {
  return typeof asset?.extension === "string"
    ? asset.extension.toLowerCase()
    : "";
}

function storagePathFor(songId, extension) {
  return `${STORAGE_PREFIX}/${songId}/preview${extension}`;
}

function verifySource({
  asset,
  resolvedAudioRoot,
  realAudioRoot,
  source,
  warnings,
  errors
}) {
  const relativePath = asset.relativePath;

  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    path.isAbsolute(relativePath)
  ) {
    appendUnique(errors, "SOURCE_PATH_OUTSIDE_ROOT");
    return;
  }

  const resolvedSource = path.resolve(
    resolvedAudioRoot,
    relativePath
  );
  source.absolutePath = resolvedSource;

  if (!isPathInside(resolvedAudioRoot, resolvedSource)) {
    appendUnique(errors, "SOURCE_PATH_OUTSIDE_ROOT");
    return;
  }

  if (!fs.existsSync(resolvedSource)) {
    appendUnique(errors, "SOURCE_FILE_NOT_FOUND");
    return;
  }

  if (hasSymlinkSegment(resolvedAudioRoot, resolvedSource)) {
    appendUnique(errors, "SYMLINK_NOT_ALLOWED");
    return;
  }

  const stats = fs.lstatSync(resolvedSource);

  if (!stats.isFile()) {
    appendUnique(errors, "SOURCE_NOT_A_FILE");
    return;
  }

  const realSource = fs.realpathSync(resolvedSource);

  if (!isPathInside(realAudioRoot, realSource)) {
    appendUnique(errors, "SOURCE_PATH_OUTSIDE_ROOT");
    return;
  }

  source.sizeBytes = stats.size;

  if (stats.size === 0) {
    appendUnique(errors, "EMPTY_FILE");
  }

  if (
    Number.isFinite(asset.sizeBytes) &&
    asset.sizeBytes !== stats.size
  ) {
    appendUnique(warnings, "MANIFEST_SIZE_CHANGED");
  }
}

function createPlannedUpload(asset, audioRootState) {
  const warnings = [];
  const errors = [];
  const extension = normalizedExtension(asset);
  const songId = asset?.match?.songId || null;
  const relativePath =
    typeof asset?.relativePath === "string"
      ? asset.relativePath
      : null;
  const source = {
    relativePath,
    absolutePath: null,
    extension: extension || null,
    sizeBytes: Number.isFinite(asset?.sizeBytes)
      ? asset.sizeBytes
      : null
  };
  const destination = {
    storagePath: null,
    contentType: MIME_TYPES[extension] || null
  };

  if (!validAssetShape(asset)) {
    appendUnique(errors, "INVALID_ASSET_SCHEMA");
  }

  if (asset?.match?.status !== ELIGIBLE_ASSET_STATUS) {
    appendUnique(
      errors,
      typeof asset?.match?.status === "string"
        ? asset.match.status
        : "INVALID_ASSET_STATUS"
    );
  }

  if (!SONG_ID_PATTERN.test(songId || "")) {
    appendUnique(errors, "INVALID_SONG_ID");
  }

  if (!MIME_TYPES[extension]) {
    appendUnique(errors, "UNSUPPORTED_EXTENSION");
  }

  const sourceExtension = relativePath
    ? path.extname(relativePath).toLowerCase()
    : "";

  if (
    extension &&
    sourceExtension &&
    extension !== sourceExtension
  ) {
    appendUnique(errors, "EXTENSION_MISMATCH");
  }

  if (SONG_ID_PATTERN.test(songId || "") && MIME_TYPES[extension]) {
    destination.storagePath = storagePathFor(songId, extension);
  }

  verifySource({
    asset,
    resolvedAudioRoot: audioRootState.resolved,
    realAudioRoot: audioRootState.real,
    source,
    warnings,
    errors
  });

  return {
    assetId:
      typeof asset?.assetId === "string" ? asset.assetId : null,
    songId,
    source,
    destination,
    overwritePolicy: OVERWRITE_POLICY,
    status: errors.length === 0 ? READY_TO_UPLOAD : BLOCKED,
    warnings,
    errors
  };
}

function blockCollisionGroups(uploads, keyForUpload, reason) {
  const groups = new Map();

  uploads.forEach((upload) => {
    const key = keyForUpload(upload);

    if (!key) return;
    const group = groups.get(key) || [];
    group.push(upload);
    groups.set(key, group);
  });

  groups.forEach((group) => {
    const sourcePaths = new Set(
      group.map((upload) => upload.source.absolutePath)
    );

    if (group.length > 1 && sourcePaths.size > 1) {
      group.forEach((upload) => {
        appendUnique(upload.errors, reason);
        upload.status = BLOCKED;
      });
    }
  });
}

function applyCollisionProtection(uploads) {
  const readyCandidates = uploads.filter(
    (upload) => upload.status === READY_TO_UPLOAD
  );

  blockCollisionGroups(
    readyCandidates,
    (upload) => upload.songId,
    "MULTIPLE_ASSETS_FOR_SONG"
  );
  blockCollisionGroups(
    readyCandidates,
    (upload) => upload.destination.storagePath,
    "STORAGE_PATH_COLLISION"
  );

  return uploads;
}

function blockedReasonCounts(uploads) {
  const counts = {};

  uploads
    .filter((upload) => upload.status === BLOCKED)
    .forEach((upload) => {
      upload.errors.forEach((reason) => {
        counts[reason] = (counts[reason] || 0) + 1;
      });
    });

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function buildSummary(uploads) {
  const ready = uploads.filter(
    (upload) => upload.status === READY_TO_UPLOAD
  );

  return {
    totalAssets: uploads.length,
    readyToUpload: ready.length,
    blocked: uploads.length - ready.length,
    totalBytesReady: ready.reduce(
      (total, upload) => total + upload.source.sizeBytes,
      0
    ),
    blockedReasons: blockedReasonCounts(uploads)
  };
}

export function buildStorageUploadPlan({
  manifest,
  sourceManifest
}) {
  const resolvedAudioRoot = path.resolve(manifest.audioRoot);

  if (
    !fs.existsSync(resolvedAudioRoot) ||
    !fs.statSync(resolvedAudioRoot).isDirectory()
  ) {
    throw new Error(`找不到 audioRoot：${resolvedAudioRoot}`);
  }

  if (fs.lstatSync(resolvedAudioRoot).isSymbolicLink()) {
    throw new Error("audioRoot 不可為 symlink。");
  }

  const audioRootState = {
    resolved: resolvedAudioRoot,
    real: fs.realpathSync(resolvedAudioRoot)
  };
  const uploads = applyCollisionProtection(
    manifest.assets.map((asset) =>
      createPlannedUpload(asset, audioRootState)
    )
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.resolve(sourceManifest),
    storagePrefix: STORAGE_PREFIX,
    summary: buildSummary(uploads),
    uploads
  };
}

function writePlan(plan, outputFile) {
  const resolvedOutput = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(
    resolvedOutput,
    `${JSON.stringify(plan, null, 2)}\n`,
    "utf8"
  );

  return resolvedOutput;
}

function printPlan(plan, outputFile) {
  console.log(`總資產：${plan.summary.totalAssets}`);
  console.log(`可上傳：${plan.summary.readyToUpload}`);
  console.log(`已阻擋：${plan.summary.blocked}`);
  console.log(`預計上傳 bytes：${plan.summary.totalBytesReady}`);

  plan.uploads
    .filter((upload) => upload.status === BLOCKED)
    .forEach((upload) => {
      console.log(
        `[BLOCKED] ${upload.assetId || "UNKNOWN_ASSET"} ` +
          `(${upload.errors.join(", ")})`
      );
    });

  console.log(`Upload plan：${outputFile}`);
}

export function createStorageUploadPlan({
  manifestFile,
  outputFile = DEFAULT_OUTPUT_FILE
}) {
  const resolvedManifest = path.resolve(manifestFile);
  const manifest = readManifest(resolvedManifest);
  const plan = buildStorageUploadPlan({
    manifest,
    sourceManifest: resolvedManifest
  });
  const writtenOutput = writePlan(plan, outputFile);
  printPlan(plan, writtenOutput);
  return plan;
}

function createTinyFile(root, relativePath, content = "x") {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function testAsset({
  assetId,
  relativePath,
  extension,
  sizeBytes,
  status = ELIGIBLE_ASSET_STATUS,
  songId
}) {
  return {
    assetId,
    filename: path.basename(relativePath),
    relativePath,
    extension,
    sizeBytes,
    parsed: {
      id: songId,
      songName: "測試歌曲",
      artist: "測試歌手",
      method: "ID_DOUBLE_UNDERSCORE"
    },
    match: {
      status,
      songId,
      songName: "測試歌曲",
      artist: "測試歌手",
      confidence: 1,
      titleScore: 1,
      artistScore: 1,
      reasons: []
    }
  };
}

function hasError(plan, assetId, reason) {
  return plan.uploads
    .find((upload) => upload.assetId === assetId)
    ?.errors.includes(reason);
}

function destinationMapping(plan) {
  return plan.uploads.map((upload) => ({
    assetId: upload.assetId,
    songId: upload.songId,
    storagePath: upload.destination.storagePath,
    contentType: upload.destination.contentType,
    overwritePolicy: upload.overwritePolicy,
    status: upload.status,
    errors: upload.errors
  }));
}

function runFixtureSelfTest(outputFile) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-storage-plan-fixture-")
  );
  const manifestFile = path.join(tempRoot, "manifest.json");
  const outsideFile = path.join(
    path.dirname(tempRoot),
    `${path.basename(tempRoot)}-outside.mp3`
  );
  let symlinkCreated;

  try {
    const files = [
      ["valid.mp3", "x"],
      ["review.mp3", "x"],
      ["unmatched.mp3", "x"],
      ["empty.mp3", ""],
      ["duplicate-a.mp3", "x"],
      ["duplicate-b.m4a", "x"],
      ["collision-a.mp3", "x"],
      ["collision-b.mp3", "x"],
      ["unsupported.flac", "x"],
      ["symlink-target.mp3", "x"]
    ];

    files.forEach(([filename, content]) =>
      createTinyFile(tempRoot, filename, content)
    );
    fs.writeFileSync(outsideFile, "x", "utf8");

    try {
      fs.symlinkSync(
        path.join(tempRoot, "symlink-target.mp3"),
        path.join(tempRoot, "symlink.mp3"),
        "file"
      );
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }

    const definitions = [
      ["valid", "valid.mp3", ".mp3", 1, "AUTO_MATCH", "M100001"],
      ["review", "review.mp3", ".mp3", 1, "REVIEW_REQUIRED", "M100002"],
      ["unmatched", "unmatched.mp3", ".mp3", 1, "UNMATCHED", null],
      ["empty", "empty.mp3", ".mp3", 0, "AUTO_MATCH", "M100004"],
      ["duplicate-a", "duplicate-a.mp3", ".mp3", 1, "AUTO_MATCH", "M100005"],
      ["duplicate-b", "duplicate-b.m4a", ".m4a", 1, "AUTO_MATCH", "M100005"],
      ["collision-a", "collision-a.mp3", ".mp3", 1, "AUTO_MATCH", "M100006"],
      ["collision-b", "collision-b.mp3", ".mp3", 1, "AUTO_MATCH", "M100006"],
      ["traversal", `../${path.basename(outsideFile)}`, ".mp3", 1, "AUTO_MATCH", "M100007"],
      ["unsupported", "unsupported.flac", ".flac", 1, "AUTO_MATCH", "M100008"]
    ];
    const assets = definitions.map(
      ([assetId, relativePath, extension, sizeBytes, status, songId]) =>
        testAsset({
          assetId,
          relativePath,
          extension,
          sizeBytes,
          status,
          songId
        })
    );

    if (symlinkCreated) {
      assets.push(
        testAsset({
          assetId: "symlink",
          relativePath: "symlink.mp3",
          extension: ".mp3",
          sizeBytes: 1,
          songId: "M100009"
        })
      );
    }

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      audioRoot: tempRoot,
      summary: {},
      assets
    };
    fs.writeFileSync(
      manifestFile,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    );

    const firstPlan = buildStorageUploadPlan({
      manifest,
      sourceManifest: manifestFile
    });
    const secondPlan = buildStorageUploadPlan({
      manifest,
      sourceManifest: manifestFile
    });
    writePlan(
      { ...firstPlan, testFixture: true },
      outputFile
    );

    const deterministic =
      JSON.stringify(destinationMapping(firstPlan)) ===
      JSON.stringify(destinationMapping(secondPlan));
    const passed =
      firstPlan.summary.readyToUpload === 1 &&
      hasError(firstPlan, "review", "REVIEW_REQUIRED") &&
      hasError(firstPlan, "unmatched", "UNMATCHED") &&
      hasError(firstPlan, "empty", "EMPTY_FILE") &&
      hasError(
        firstPlan,
        "duplicate-a",
        "MULTIPLE_ASSETS_FOR_SONG"
      ) &&
      hasError(
        firstPlan,
        "collision-a",
        "STORAGE_PATH_COLLISION"
      ) &&
      hasError(
        firstPlan,
        "traversal",
        "SOURCE_PATH_OUTSIDE_ROOT"
      ) &&
      hasError(firstPlan, "unsupported", "UNSUPPORTED_EXTENSION") &&
      (!symlinkCreated ||
        hasError(firstPlan, "symlink", "SYMLINK_NOT_ALLOWED")) &&
      deterministic;

    return {
      passed,
      deterministic,
      symlinkTest: symlinkCreated ? "PASS" : "SKIPPED_OS_RESTRICTION",
      summary: firstPlan.summary
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(outsideFile, { force: true });
  }
}

function runScaleSelfTest() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-storage-plan-scale-")
  );

  try {
    const assets = [];

    for (let index = 1; index <= 500; index += 1) {
      const songId = `M${String(200000 + index).padStart(6, "0")}`;
      const relativePath = `${songId}.mp3`;
      createTinyFile(tempRoot, relativePath);
      assets.push(
        testAsset({
          assetId: `scale-${index}`,
          relativePath,
          extension: ".mp3",
          sizeBytes: 1,
          songId
        })
      );
    }

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      audioRoot: tempRoot,
      summary: {},
      assets
    };
    const startedAt = Date.now();
    const plan = buildStorageUploadPlan({
      manifest,
      sourceManifest: path.join(tempRoot, "manifest.json")
    });
    const uniquePaths = new Set(
      plan.uploads.map(
        (upload) => upload.destination.storagePath
      )
    );

    return {
      passed:
        plan.summary.readyToUpload === 500 &&
        plan.summary.blocked === 0 &&
        uniquePaths.size === 500,
      durationMs: Date.now() - startedAt,
      uniqueStoragePaths: uniquePaths.size,
      summary: plan.summary
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function runSelfTest(outputFile = DEFAULT_OUTPUT_FILE) {
  const fixture = runFixtureSelfTest(outputFile);
  const scale = runScaleSelfTest();

  console.log(`Planner fixture：${fixture.passed ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(fixture));
  console.log(`Planner 500-file：${scale.passed ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(scale));
  console.log(`Fixture upload plan：${path.resolve(outputFile)}`);

  if (!fixture.passed || !scale.passed) {
    throw new Error("Storage upload planner self-test failed。");
  }

  return { fixture, scale };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    if (process.argv[2] === "--self-test") {
      runSelfTest(
        process.argv[3]
          ? resolveCliPath(process.argv[3])
          : DEFAULT_OUTPUT_FILE
      );
    } else if (!process.argv[2]) {
      console.error(
        "用法：node " +
          "scripts/song-import/audio-assets/createStorageUploadPlan.js " +
          "<manifest> [output]"
      );
      process.exitCode = 1;
    } else {
      createStorageUploadPlan({
        manifestFile: resolveCliPath(process.argv[2]),
        outputFile: process.argv[3]
          ? resolveCliPath(process.argv[3])
          : DEFAULT_OUTPUT_FILE
      });
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
