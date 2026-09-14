/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_REPORT_FILE = path.join(
  projectRoot,
  "scripts/song-import/output/pages-staging-report.json"
);
const PROVIDER = "cloudflare-pages";
const PROJECT_NAME = "golden-song-audio";
const PRODUCTION_ORIGIN = "https://golden-song-audio.pages.dev";
const READY_FOR_PAGES = "READY_FOR_PAGES";
const STAGED = "STAGED";
const STAGE_FAILED = "STAGE_FAILED";
const SKIPPED = "SKIPPED";
const SONG_ID_PATTERN = /^M\d{6}$/;
const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024;
const OWNER_MARKER_SUFFIX = ".gsk-pages-staging-owner";
const OWNER_MARKER_CONTENT = "golden-song-king:pages-staging:v1\n";
const SUPPORTED_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg"
]);

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizePathKey(filePath) {
  const normalized = path.resolve(filePath);
  return process.platform === "win32"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized;
}

function pathsEqual(left, right) {
  return normalizePathKey(left) === normalizePathKey(right);
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

function hasSymlinkSegment(root, candidate) {
  const relative = path.relative(root, candidate);

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

class StageError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "StageError";
    this.code = code;
  }
}

function failureCode(error) {
  return error instanceof StageError ? error.code : "STAGING_ERROR";
}

function readJsonObject(filePath, label) {
  let value;

  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new StageError(
      `${label}_UNREADABLE`,
      `${label} 無法讀取：${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageError(`${label}_INVALID`, `${label} 必須是 JSON object。`);
  }

  return value;
}

function validateTarget(target) {
  if (
    !target ||
    target.provider !== PROVIDER ||
    target.projectName !== PROJECT_NAME ||
    target.productionOrigin !== PRODUCTION_ORIGIN
  ) {
    throw new StageError(
      "TARGET_MISMATCH",
      "Cloudflare Pages target 與允許清單不符。"
    );
  }
}

function validatePlan(plan) {
  if (!Number.isInteger(plan.schemaVersion)) {
    throw new StageError("PLAN_SCHEMA_INVALID");
  }

  validateTarget(plan.target);

  if (
    typeof plan.sourceManifest !== "string" ||
    !plan.sourceManifest.trim()
  ) {
    throw new StageError("SOURCE_MANIFEST_MISSING");
  }

  if (!Array.isArray(plan.assets)) {
    throw new StageError("PLAN_ASSETS_INVALID");
  }
}

function resolveAudioContext(plan) {
  const sourceManifest = path.resolve(plan.sourceManifest);
  const manifest = readJsonObject(sourceManifest, "SOURCE_MANIFEST");

  if (
    typeof manifest.audioRoot !== "string" ||
    !manifest.audioRoot.trim() ||
    !Array.isArray(manifest.assets)
  ) {
    throw new StageError("SOURCE_MANIFEST_INVALID");
  }

  const audioRoot = path.resolve(manifest.audioRoot);

  if (!fs.existsSync(audioRoot) || !fs.statSync(audioRoot).isDirectory()) {
    throw new StageError("AUDIO_ROOT_MISSING");
  }

  if (fs.lstatSync(audioRoot).isSymbolicLink()) {
    throw new StageError("AUDIO_ROOT_SYMLINK_NOT_ALLOWED");
  }

  const assetsById = new Map();

  manifest.assets.forEach((asset) => {
    if (typeof asset?.assetId !== "string" || assetsById.has(asset.assetId)) {
      throw new StageError("SOURCE_MANIFEST_ASSET_ID_INVALID");
    }
    assetsById.set(asset.assetId, asset);
  });

  return {
    sourceManifest,
    audioRoot,
    realAudioRoot: fs.realpathSync(audioRoot),
    assetsById
  };
}

function isAllowedIgnoredRepoRoot(stagingRoot) {
  return [path.join(projectRoot, "dist"), path.join(projectRoot, "node_modules")]
    .some((ignoredRoot) => isPathInside(ignoredRoot, stagingRoot));
}

function validateStagingRoot(stagingDirectory, audioRoot) {
  const stagingRoot = path.resolve(stagingDirectory);
  const driveRoot = path.parse(stagingRoot).root;
  const protectedRoots = [
    path.join(projectRoot, "src"),
    path.join(projectRoot, "scripts"),
    path.join(projectRoot, "public")
  ];

  if (pathsEqual(stagingRoot, driveRoot)) {
    throw new StageError("UNSAFE_STAGING_DISK_ROOT");
  }

  if (pathsEqual(stagingRoot, projectRoot)) {
    throw new StageError("UNSAFE_STAGING_REPO_ROOT");
  }

  if (protectedRoots.some((root) => isPathInside(root, stagingRoot))) {
    throw new StageError("UNSAFE_STAGING_PROTECTED_ROOT");
  }

  if (
    isPathInside(audioRoot, stagingRoot) ||
    isPathInside(stagingRoot, audioRoot)
  ) {
    throw new StageError("UNSAFE_STAGING_AUDIO_ROOT");
  }

  if (
    isPathInside(projectRoot, stagingRoot) &&
    !isAllowedIgnoredRepoRoot(stagingRoot)
  ) {
    throw new StageError("STAGING_ROOT_NOT_GIT_IGNORED");
  }

  if (fs.existsSync(stagingRoot)) {
    const stats = fs.lstatSync(stagingRoot);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new StageError("UNSAFE_STAGING_ROOT_TYPE");
    }
  }

  return stagingRoot;
}

function markerPathFor(stagingRoot) {
  return `${stagingRoot}${OWNER_MARKER_SUFFIX}`;
}

function prepareStagingRoot(stagingRoot) {
  const markerPath = markerPathFor(stagingRoot);

  if (!fs.existsSync(stagingRoot)) {
    fs.mkdirSync(stagingRoot, { recursive: true });
    fs.writeFileSync(markerPath, OWNER_MARKER_CONTENT, "utf8");
    return;
  }

  const entries = fs.readdirSync(stagingRoot);
  const markerValid =
    fs.existsSync(markerPath) &&
    fs.statSync(markerPath).isFile() &&
    fs.readFileSync(markerPath, "utf8") === OWNER_MARKER_CONTENT;

  if (entries.length > 0 && !markerValid) {
    throw new StageError("UNOWNED_STAGING_DIRECTORY");
  }

  if (!markerValid) {
    fs.writeFileSync(markerPath, OWNER_MARKER_CONTENT, "utf8");
  }

  entries.forEach((entry) => {
    const target = path.resolve(stagingRoot, entry);
    if (!isPathInside(stagingRoot, target) || pathsEqual(target, stagingRoot)) {
      throw new StageError("STAGING_CLEANUP_ESCAPE_BLOCKED");
    }
    fs.rmSync(target, { recursive: true, force: true });
  });
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = new Uint8Array(64 * 1024);

  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }

  return hash.digest("hex");
}

function statFingerprint(stats) {
  return `${stats.size}:${new Date(stats.mtimeMs).toISOString()}`;
}

function expectedDestination(asset) {
  const extension =
    typeof asset.extension === "string"
      ? asset.extension.toLocaleLowerCase("en-US")
      : "";
  const relativePath = `${asset.songId}/preview${extension}`;

  return {
    extension,
    relativePath,
    publicUrl: `${PRODUCTION_ORIGIN}/${relativePath}`
  };
}

function assertPlanAssetContract(asset) {
  if (!SONG_ID_PATTERN.test(asset?.songId || "")) {
    throw new StageError("INVALID_SONG_ID");
  }

  const expected = expectedDestination(asset);

  if (!SUPPORTED_EXTENSIONS.has(expected.extension)) {
    throw new StageError("INVALID_EXTENSION");
  }

  if (
    asset.stagingRelativePath !== expected.relativePath ||
    asset.publicUrl !== expected.publicUrl
  ) {
    throw new StageError("PLAN_DESTINATION_MISMATCH");
  }

  return expected;
}

function resolveAndValidateSource(asset, context) {
  const manifestAsset = context.assetsById.get(asset.assetId);

  if (!manifestAsset) {
    throw new StageError("SOURCE_MANIFEST_ASSET_MISSING");
  }

  if (
    typeof manifestAsset.relativePath !== "string" ||
    !manifestAsset.relativePath.trim() ||
    path.isAbsolute(manifestAsset.relativePath)
  ) {
    throw new StageError("SOURCE_PATH_OUTSIDE_ROOT");
  }

  const expectedSource = path.resolve(
    context.audioRoot,
    manifestAsset.relativePath
  );
  const planSource = path.resolve(asset.sourcePath || "");

  if (
    !isPathInside(context.audioRoot, expectedSource) ||
    !pathsEqual(expectedSource, planSource)
  ) {
    throw new StageError("SOURCE_PLAN_MISMATCH");
  }

  if (hasSymlinkSegment(context.audioRoot, expectedSource)) {
    throw new StageError("SOURCE_SYMLINK_NOT_ALLOWED");
  }

  if (!fs.existsSync(expectedSource)) {
    throw new StageError("SOURCE_FILE_MISSING");
  }

  const linkStats = fs.lstatSync(expectedSource);
  if (linkStats.isSymbolicLink() || !linkStats.isFile()) {
    throw new StageError("SOURCE_NOT_REGULAR_FILE");
  }

  const realSource = fs.realpathSync(expectedSource);
  if (!isPathInside(context.realAudioRoot, realSource)) {
    throw new StageError("SOURCE_REAL_PATH_OUTSIDE_ROOT");
  }

  const stats = fs.statSync(realSource);
  const actualExtension = path.extname(realSource).toLocaleLowerCase("en-US");
  const plannedExtension = String(asset.extension || "").toLocaleLowerCase("en-US");
  const manifestExtension = String(manifestAsset.extension || "").toLocaleLowerCase("en-US");

  if (
    actualExtension !== plannedExtension ||
    actualExtension !== manifestExtension
  ) {
    throw new StageError("EXTENSION_MISMATCH");
  }

  if (stats.size > MAX_ASSET_SIZE_BYTES) {
    throw new StageError("ASSET_TOO_LARGE");
  }

  if (
    stats.size !== Number(asset.sizeBytes) ||
    stats.size !== Number(manifestAsset.sizeBytes)
  ) {
    throw new StageError("SOURCE_CHANGED_AFTER_PLAN");
  }

  const actualModifiedTime = new Date(stats.mtimeMs).toISOString();
  if (
    typeof manifestAsset.modifiedTime !== "string" ||
    manifestAsset.modifiedTime !== actualModifiedTime
  ) {
    throw new StageError("SOURCE_CHANGED_AFTER_PLAN");
  }

  return { sourcePath: realSource, stats };
}

function stageAsset(asset, context, stagingRoot) {
  const expected = assertPlanAssetContract(asset);
  const destination = path.resolve(stagingRoot, expected.relativePath);

  if (!isPathInside(stagingRoot, destination) || pathsEqual(stagingRoot, destination)) {
    throw new StageError("STAGING_PATH_ESCAPE_BLOCKED");
  }

  const source = resolveAndValidateSource(asset, context);
  const fingerprintBefore = statFingerprint(source.stats);
  const sourceSha256 = hashFile(source.sourcePath);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source.sourcePath, destination);

  const sourceAfter = fs.statSync(source.sourcePath);
  if (statFingerprint(sourceAfter) !== fingerprintBefore) {
    fs.rmSync(destination, { force: true });
    throw new StageError("SOURCE_CHANGED_DURING_COPY");
  }

  const stagedSha256 = hashFile(destination);
  if (sourceSha256 !== stagedSha256) {
    fs.rmSync(destination, { force: true });
    throw new StageError("COPY_INTEGRITY_FAILURE");
  }

  return {
    songId: asset.songId,
    sourcePath: source.sourcePath,
    stagingPath: destination,
    publicUrl: expected.publicUrl,
    sha256: sourceSha256,
    status: STAGED,
    reason: null,
    sizeBytes: sourceAfter.size
  };
}

function skippedAsset(asset, stagingRoot) {
  const relativePath =
    typeof asset?.stagingRelativePath === "string"
      ? asset.stagingRelativePath
      : null;

  return {
    songId: asset?.songId || null,
    sourcePath: asset?.sourcePath || null,
    stagingPath: relativePath
      ? path.resolve(stagingRoot, relativePath)
      : null,
    publicUrl: asset?.publicUrl || null,
    sha256: null,
    status: SKIPPED,
    reason: asset?.reason || "NOT_READY_FOR_PAGES",
    sizeBytes: 0
  };
}

function failedAsset(asset, stagingRoot, error) {
  let stagingPath = null;

  if (typeof asset?.stagingRelativePath === "string") {
    const candidate = path.resolve(stagingRoot, asset.stagingRelativePath);
    if (isPathInside(stagingRoot, candidate)) {
      stagingPath = candidate;
      fs.rmSync(candidate, { recursive: true, force: true });
    }
  }

  return {
    songId: asset?.songId || null,
    sourcePath: asset?.sourcePath || null,
    stagingPath,
    publicUrl: asset?.publicUrl || null,
    sha256: null,
    status: STAGE_FAILED,
    reason: failureCode(error),
    sizeBytes: 0
  };
}

function buildSummary(totalPlanned, assets) {
  const staged = assets.filter((asset) => asset.status === STAGED);

  return {
    totalPlanned,
    copied: staged.length,
    skipped: assets.filter((asset) => asset.status === SKIPPED).length,
    failed: assets.filter((asset) => asset.status === STAGE_FAILED).length,
    totalBytes: staged.reduce((total, asset) => total + asset.sizeBytes, 0)
  };
}

function writeReport(report, reportFile) {
  const resolved = path.resolve(reportFile);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return resolved;
}

export function buildPagesStaging({
  plan,
  sourcePlan,
  stagingDirectory,
  reportFile = DEFAULT_REPORT_FILE
}) {
  validatePlan(plan);
  const context = resolveAudioContext(plan);
  const stagingRoot = validateStagingRoot(stagingDirectory, context.audioRoot);
  prepareStagingRoot(stagingRoot);

  const assets = plan.assets.map((asset) => {
    if (asset?.status !== READY_FOR_PAGES) {
      return skippedAsset(asset, stagingRoot);
    }

    try {
      return stageAsset(asset, context, stagingRoot);
    } catch (error) {
      return failedAsset(asset, stagingRoot, error);
    }
  });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourcePlan: path.resolve(sourcePlan),
    stagingRoot,
    summary: buildSummary(plan.assets.length, assets),
    assets
  };

  const writtenReport = writeReport(report, reportFile);
  return { report, reportFile: writtenReport };
}

export function buildPagesStagingFromFile({
  planFile,
  stagingDirectory,
  reportFile = DEFAULT_REPORT_FILE
}) {
  const resolvedPlan = path.resolve(planFile);
  const plan = readJsonObject(resolvedPlan, "PAGES_PLAN");
  const result = buildPagesStaging({
    plan,
    sourcePlan: resolvedPlan,
    stagingDirectory,
    reportFile
  });

  console.log("LOCAL STAGING ONLY - NO CLOUDFLARE DEPLOYMENT");
  console.log(`規劃項目：${result.report.summary.totalPlanned}`);
  console.log(`已複製：${result.report.summary.copied}`);
  console.log(`已略過：${result.report.summary.skipped}`);
  console.log(`失敗：${result.report.summary.failed}`);
  console.log(`總 bytes：${result.report.summary.totalBytes}`);
  console.log(`Staging root：${result.report.stagingRoot}`);
  console.log(`Staging report：${result.reportFile}`);

  return result;
}

function createTestFile(root, relativePath, content) {
  const filePath = path.resolve(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function manifestAsset(audioRoot, assetId, relativePath) {
  const sourcePath = path.resolve(audioRoot, relativePath);
  const stats = fs.statSync(sourcePath);
  return {
    assetId,
    relativePath: toPortablePath(relativePath),
    extension: path.extname(relativePath).toLocaleLowerCase("en-US"),
    sizeBytes: stats.size,
    modifiedTime: new Date(stats.mtimeMs).toISOString()
  };
}

function missingManifestAsset(assetId, relativePath) {
  return {
    assetId,
    relativePath: toPortablePath(relativePath),
    extension: path.extname(relativePath).toLocaleLowerCase("en-US"),
    sizeBytes: 1,
    modifiedTime: new Date(0).toISOString()
  };
}

function plannedAsset(audioRoot, manifestEntry, songId, status = READY_FOR_PAGES) {
  const extension = manifestEntry.extension;
  const relativePath = `${songId}/preview${extension}`;
  return {
    assetId: manifestEntry.assetId,
    songId,
    sourcePath: path.resolve(audioRoot, manifestEntry.relativePath),
    extension,
    mimeType: extension === ".mp3" ? "audio/mpeg" : null,
    sizeBytes: manifestEntry.sizeBytes,
    status,
    reason: status === READY_FOR_PAGES ? null : "SELF_TEST_BLOCKED",
    reasons: status === READY_FOR_PAGES ? [] : ["SELF_TEST_BLOCKED"],
    stagingRelativePath: relativePath,
    publicPath: `/${relativePath}`,
    publicUrl: `${PRODUCTION_ORIGIN}/${relativePath}`
  };
}

function createPlan(sourceManifest, assets) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target: {
      provider: PROVIDER,
      projectName: PROJECT_NAME,
      productionOrigin: PRODUCTION_ORIGIN
    },
    sourceManifest,
    summary: {},
    assets
  };
}

function safelyRemoveTestRoot(tempRoot, prefix) {
  const resolved = path.resolve(tempRoot);
  const systemTemp = path.resolve(os.tmpdir());

  if (
    !isPathInside(systemTemp, resolved) ||
    !path.basename(resolved).startsWith(prefix)
  ) {
    throw new StageError("UNSAFE_SELF_TEST_CLEANUP");
  }

  fs.rmSync(resolved, { recursive: true, force: true });
}

function runFixtureSelfTest() {
  const prefix = "gsk-pages-staging-fixture-";
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const audioRoot = path.join(tempRoot, "audio");
  const stagingRoot = path.join(tempRoot, "staging");
  const manifestFile = path.join(tempRoot, "manifest.json");
  const planFile = path.join(tempRoot, "plan.json");
  const reportFile = path.join(tempRoot, "report.json");
  fs.mkdirSync(audioRoot, { recursive: true });

  try {
    createTestFile(audioRoot, "valid.mp3", "valid-audio");
    createTestFile(audioRoot, "blocked.mp3", "blocked-audio");
    createTestFile(audioRoot, "changed.mp3", "before");

    const valid = manifestAsset(audioRoot, "valid", "valid.mp3");
    const blocked = manifestAsset(audioRoot, "blocked", "blocked.mp3");
    const missing = missingManifestAsset("missing", "missing.mp3");
    const changed = manifestAsset(audioRoot, "changed", "changed.mp3");
    createTestFile(audioRoot, "changed.mp3", "changed-after-plan");

    let symlinkAvailable = false;
    let symlink = null;
    const outsideRoot = path.join(tempRoot, "outside");
    createTestFile(outsideRoot, "escape.mp3", "outside-audio");

    try {
      const linkDirectory = path.join(audioRoot, "linked");
      fs.symlinkSync(outsideRoot, linkDirectory, "junction");
      symlink = manifestAsset(audioRoot, "symlink", "linked/escape.mp3");
      symlinkAvailable = true;
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
    }

    const manifestAssets = [valid, blocked, missing, changed];
    const planAssets = [
      plannedAsset(audioRoot, valid, "M000001"),
      plannedAsset(audioRoot, blocked, "M000002", "BLOCKED"),
      plannedAsset(audioRoot, missing, "M000003"),
      plannedAsset(audioRoot, changed, "M000004")
    ];

    if (symlinkAvailable) {
      manifestAssets.push(symlink);
      planAssets.push(plannedAsset(audioRoot, symlink, "M000005"));
    }

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      audioRoot,
      assets: manifestAssets
    };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
    const plan = createPlan(manifestFile, planAssets);
    fs.writeFileSync(planFile, JSON.stringify(plan), "utf8");

    const first = buildPagesStaging({
      plan,
      sourcePlan: planFile,
      stagingDirectory: stagingRoot,
      reportFile
    });
    const validResult = first.report.assets.find((asset) => asset.songId === "M000001");
    const blockedResult = first.report.assets.find((asset) => asset.songId === "M000002");
    const missingResult = first.report.assets.find((asset) => asset.songId === "M000003");
    const changedResult = first.report.assets.find((asset) => asset.songId === "M000004");
    const symlinkResult = first.report.assets.find((asset) => asset.songId === "M000005");
    const stagedValid = path.join(stagingRoot, "M000001", "preview.mp3");
    const blockedDestination = path.join(stagingRoot, "M000002", "preview.mp3");

    let unsafeRootRejected = false;
    try {
      validateStagingRoot(projectRoot, audioRoot);
    } catch (error) {
      unsafeRootRejected = failureCode(error) === "UNSAFE_STAGING_REPO_ROOT";
    }

    createTestFile(stagingRoot, "old.txt", "remove-me");
    const outsideSentinel = createTestFile(tempRoot, "keep.txt", "keep-me");
    const second = buildPagesStaging({
      plan,
      sourcePlan: planFile,
      stagingDirectory: stagingRoot,
      reportFile
    });
    const cleanupContained =
      !fs.existsSync(path.join(stagingRoot, "old.txt")) &&
      fs.existsSync(outsideSentinel);
    const expectedFailed = symlinkAvailable ? 3 : 2;
    const symlinkPassed =
      !symlinkAvailable ||
      (symlinkResult?.status === STAGE_FAILED &&
        symlinkResult.reason === "SOURCE_SYMLINK_NOT_ALLOWED");
    const passed =
      first.report.summary.copied === 1 &&
      first.report.summary.skipped === 1 &&
      first.report.summary.failed === expectedFailed &&
      validResult?.status === STAGED &&
      validResult.sha256 === hashFile(stagedValid) &&
      validResult.stagingPath === stagedValid &&
      validResult.publicUrl === `${PRODUCTION_ORIGIN}/M000001/preview.mp3` &&
      blockedResult?.status === SKIPPED &&
      !fs.existsSync(blockedDestination) &&
      missingResult?.reason === "SOURCE_FILE_MISSING" &&
      changedResult?.reason === "SOURCE_CHANGED_AFTER_PLAN" &&
      symlinkPassed &&
      unsafeRootRejected &&
      cleanupContained &&
      second.report.summary.copied === 1;

    return {
      passed,
      symlinkTest: symlinkAvailable ? "PASS" : "SKIPPED_OS_RESTRICTION",
      unsafeRootRejected,
      cleanupContained,
      sha256Verified: validResult?.sha256 === hashFile(stagedValid),
      expectedUrlPreserved:
        validResult?.publicUrl === `${PRODUCTION_ORIGIN}/M000001/preview.mp3`,
      summary: first.report.summary
    };
  } finally {
    safelyRemoveTestRoot(tempRoot, prefix);
  }
}

function runScaleSelfTest() {
  const prefix = "gsk-pages-staging-scale-";
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const audioRoot = path.join(tempRoot, "audio");
  const stagingRoot = path.join(tempRoot, "staging");
  const manifestFile = path.join(tempRoot, "manifest.json");
  const planFile = path.join(tempRoot, "plan.json");
  const reportFile = path.join(tempRoot, "report.json");
  fs.mkdirSync(audioRoot, { recursive: true });

  try {
    const manifestAssets = [];
    const planAssets = [];

    for (let index = 1; index <= 500; index += 1) {
      const songId = `M${String(index).padStart(6, "0")}`;
      const relativePath = `${songId}.mp3`;
      createTestFile(audioRoot, relativePath, `audio-${songId}`);
      const entry = manifestAsset(audioRoot, `scale-${index}`, relativePath);
      manifestAssets.push(entry);
      planAssets.push(plannedAsset(audioRoot, entry, songId));
    }

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      audioRoot,
      assets: manifestAssets
    };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest), "utf8");
    const plan = createPlan(manifestFile, planAssets);
    fs.writeFileSync(planFile, JSON.stringify(plan), "utf8");

    const startedAt = Date.now();
    const result = buildPagesStaging({
      plan,
      sourcePlan: planFile,
      stagingDirectory: stagingRoot,
      reportFile
    });
    const stagingPaths = new Set(result.report.assets.map((asset) => asset.stagingPath));
    const hashes = result.report.assets.filter((asset) => {
      return asset.sha256 === hashFile(asset.stagingPath);
    });
    const passed =
      result.report.summary.totalPlanned === 500 &&
      result.report.summary.copied === 500 &&
      result.report.summary.skipped === 0 &&
      result.report.summary.failed === 0 &&
      stagingPaths.size === 500 &&
      hashes.length === 500;

    return {
      passed,
      durationMs: Date.now() - startedAt,
      staged: result.report.summary.copied,
      failed: result.report.summary.failed,
      uniqueStagingPaths: stagingPaths.size,
      sha256Verified: hashes.length
    };
  } finally {
    safelyRemoveTestRoot(tempRoot, prefix);
  }
}

export function runSelfTest() {
  const fixture = runFixtureSelfTest();
  const scale = runScaleSelfTest();

  console.log(`Pages staging fixture：${fixture.passed ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(fixture));
  console.log(`Pages staging 500-file：${scale.passed ? "PASS" : "FAIL"}`);
  console.log(JSON.stringify(scale));

  if (!fixture.passed || !scale.passed) {
    throw new Error("Cloudflare Pages staging builder self-test failed。");
  }

  return { fixture, scale };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    if (process.argv[2] === "--self-test") {
      runSelfTest();
    } else if (!process.argv[2] || !process.argv[3]) {
      console.error(
        "用法：node " +
          "scripts/song-import/audio-assets/buildPagesStaging.js " +
          "<pages-plan> <staging-dir>"
      );
      process.exitCode = 1;
    } else {
      buildPagesStagingFromFile({
        planFile: resolveCliPath(process.argv[2]),
        stagingDirectory: resolveCliPath(process.argv[3])
      });
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
