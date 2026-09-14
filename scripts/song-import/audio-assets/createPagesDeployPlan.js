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
  "scripts/song-import/output/pages-deploy-plan.json"
);
const PROVIDER = "cloudflare-pages";
const PROJECT_NAME = "golden-song-audio";
const PRODUCTION_ORIGIN = "https://golden-song-audio.pages.dev";
const READY_FOR_PAGES = "READY_FOR_PAGES";
const BLOCKED = "BLOCKED";
const ELIGIBLE_SCANNER_STATUS = "AUTO_MATCH";
const SONG_ID_PATTERN = /^M\d{6}$/;
const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024;

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

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
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

function readManifest(manifestFile) {
  let manifest;

  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  } catch (error) {
    throw new Error(
      `Audio asset manifest 無法讀取：${error instanceof Error ? error.message : "Unknown error"}`,
      { cause: error }
    );
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
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

function resolveAudioRoot(audioRoot) {
  const resolved = path.resolve(audioRoot);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`找不到 audioRoot：${resolved}`);
  }

  if (fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error("audioRoot 不可為 symlink。");
  }

  return {
    resolved,
    real: fs.realpathSync(resolved)
  };
}

function deterministicDestination(songId, extension) {
  const stagingRelativePath = `${songId}/preview${extension}`;
  const publicPath = `/${stagingRelativePath}`;

  return {
    stagingRelativePath,
    publicPath,
    publicUrl: `${PRODUCTION_ORIGIN}${publicPath}`
  };
}

function validateSource(asset, audioRoot, result) {
  const relativePath = asset?.relativePath;

  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    path.isAbsolute(relativePath)
  ) {
    appendUnique(result.reasons, "SOURCE_PATH_OUTSIDE_ROOT");
    return;
  }

  const sourcePath = path.resolve(audioRoot.resolved, relativePath);
  result.sourcePath = sourcePath;

  if (!isPathInside(audioRoot.resolved, sourcePath)) {
    appendUnique(result.reasons, "SOURCE_PATH_OUTSIDE_ROOT");
    return;
  }

  if (hasSymlinkSegment(audioRoot.resolved, sourcePath)) {
    appendUnique(result.reasons, "SOURCE_SYMLINK_NOT_ALLOWED");
    return;
  }

  if (!fs.existsSync(sourcePath)) {
    appendUnique(result.reasons, "SOURCE_FILE_MISSING");
    return;
  }

  let stats;

  try {
    stats = fs.statSync(sourcePath);
  } catch {
    appendUnique(result.reasons, "SOURCE_FILE_UNREADABLE");
    return;
  }

  if (!stats.isFile()) {
    appendUnique(result.reasons, "SOURCE_NOT_REGULAR_FILE");
    return;
  }

  let realSourcePath;

  try {
    realSourcePath = fs.realpathSync(sourcePath);
  } catch {
    appendUnique(result.reasons, "SOURCE_FILE_UNREADABLE");
    return;
  }

  result.sourcePath = realSourcePath;

  if (!isPathInside(audioRoot.real, realSourcePath)) {
    appendUnique(result.reasons, "SOURCE_REAL_PATH_OUTSIDE_ROOT");
    return;
  }

  const actualExtension = path.extname(sourcePath).toLowerCase();
  const manifestExtension =
    typeof asset?.extension === "string"
      ? asset.extension.toLowerCase()
      : "";

  if (!MIME_TYPES[actualExtension]) {
    appendUnique(result.reasons, "UNSUPPORTED_EXTENSION");
  }

  if (manifestExtension && manifestExtension !== actualExtension) {
    appendUnique(result.reasons, "EXTENSION_MISMATCH");
  }

  result.extension = actualExtension;
  result.mimeType = MIME_TYPES[actualExtension] || null;
  result.sizeBytes = stats.size;

  if (
    Number.isFinite(Number(asset?.sizeBytes)) &&
    Number(asset.sizeBytes) !== stats.size
  ) {
    appendUnique(result.reasons, "SOURCE_SIZE_CHANGED");
  }

  if (stats.size > MAX_ASSET_SIZE_BYTES) {
    appendUnique(result.reasons, "ASSET_TOO_LARGE");
  }
}

function createPlannedAsset(asset, audioRoot) {
  const songId =
    typeof asset?.match?.songId === "string"
      ? asset.match.songId.trim().toUpperCase()
      : null;
  const result = {
    assetId:
      typeof asset?.assetId === "string" ? asset.assetId : null,
    songId,
    sourcePath: null,
    extension:
      typeof asset?.extension === "string"
        ? asset.extension.toLowerCase()
        : null,
    mimeType: null,
    sizeBytes: null,
    status: BLOCKED,
    reason: null,
    reasons: [],
    stagingRelativePath: null,
    publicPath: null,
    publicUrl: null
  };

  if (asset?.match?.status !== ELIGIBLE_SCANNER_STATUS) {
    appendUnique(result.reasons, "SCANNER_STATUS_NOT_AUTO_MATCH");
  }

  if (!SONG_ID_PATTERN.test(songId || "")) {
    appendUnique(result.reasons, "INVALID_SONG_ID");
  }

  validateSource(asset, audioRoot, result);

  if (SONG_ID_PATTERN.test(songId || "") && MIME_TYPES[result.extension]) {
    Object.assign(
      result,
      deterministicDestination(songId, result.extension)
    );
  }

  result.status =
    result.reasons.length === 0 ? READY_FOR_PAGES : BLOCKED;
  result.reason = result.reasons[0] || null;
  return result;
}

function applyCollisionReason(group, reason) {
  group.forEach((asset) => {
    appendUnique(asset.reasons, reason);
    asset.status = BLOCKED;
    asset.reason = asset.reasons[0];
  });
}

function groupBy(assets, keyForAsset) {
  const groups = new Map();

  assets.forEach((asset) => {
    const key = keyForAsset(asset);
    if (!key) return;
    const group = groups.get(key) || [];
    group.push(asset);
    groups.set(key, group);
  });

  return groups;
}

function applyCollisionProtection(assets) {
  const readyCandidates = assets.filter(
    (asset) => asset.status === READY_FOR_PAGES
  );

  groupBy(readyCandidates, (asset) => asset.songId).forEach((group) => {
    if (group.length > 1) {
      applyCollisionReason(group, "MULTIPLE_ASSETS_FOR_SONG");
    }
  });

  groupBy(readyCandidates, (asset) => asset.publicPath).forEach(
    (group) => {
      const sources = new Set(group.map((asset) => asset.sourcePath));
      if (group.length > 1 && sources.size > 1) {
        applyCollisionReason(group, "PUBLIC_PATH_COLLISION");
      }
    }
  );

  groupBy(
    readyCandidates,
    (asset) => asset.stagingRelativePath
  ).forEach((group) => {
    const sources = new Set(group.map((asset) => asset.sourcePath));
    if (group.length > 1 && sources.size > 1) {
      applyCollisionReason(group, "STAGING_PATH_COLLISION");
    }
  });

  return assets;
}

function buildBlockedReasonCounts(assets) {
  const counts = {};

  assets
    .filter((asset) => asset.status === BLOCKED)
    .forEach((asset) => {
      asset.reasons.forEach((reason) => {
        counts[reason] = (counts[reason] || 0) + 1;
      });
    });

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

function buildSummary(assets) {
  const ready = assets.filter(
    (asset) => asset.status === READY_FOR_PAGES
  );

  return {
    totalAssets: assets.length,
    readyForPages: ready.length,
    blocked: assets.length - ready.length,
    totalReadyFiles: ready.length,
    totalReadyBytes: ready.reduce(
      (total, asset) => total + asset.sizeBytes,
      0
    ),
    blockedReasons: buildBlockedReasonCounts(assets)
  };
}

function validateTarget(target) {
  const parsed = new URL(target.productionOrigin);
  if (
    target.provider !== PROVIDER ||
    target.projectName !== PROJECT_NAME ||
    parsed.protocol !== "https:" ||
    parsed.hostname !== "golden-song-audio.pages.dev" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Cloudflare Pages target 設定不安全。");
  }
}

export function buildPagesDeployPlan({ manifest, sourceManifest }) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.assets)) {
    throw new Error("Audio asset manifest 格式無效。");
  }

  const audioRoot = resolveAudioRoot(manifest.audioRoot);
  const target = {
    provider: PROVIDER,
    projectName: PROJECT_NAME,
    productionOrigin: PRODUCTION_ORIGIN
  };
  validateTarget(target);

  const assets = applyCollisionProtection(
    manifest.assets.map((asset) =>
      createPlannedAsset(asset, audioRoot)
    )
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target,
    sourceManifest: path.resolve(sourceManifest),
    summary: buildSummary(assets),
    assets
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
  console.log("LOCAL PLAN ONLY - NO CLOUDFLARE DEPLOYMENT");
  console.log(`總資產：${plan.summary.totalAssets}`);
  console.log(`可部署：${plan.summary.readyForPages}`);
  console.log(`已阻擋：${plan.summary.blocked}`);
  console.log(`部署檔案：${plan.summary.totalReadyFiles}`);
  console.log(`部署 bytes：${plan.summary.totalReadyBytes}`);

  plan.assets
    .filter((asset) => asset.status === BLOCKED)
    .forEach((asset) => {
      console.log(
        `[BLOCKED] ${asset.songId || asset.assetId || "UNKNOWN"} ` +
          `${asset.reasons.join(",")}`
      );
    });

  console.log(`Pages deploy plan：${outputFile}`);
}

export function createPagesDeployPlan({
  manifestFile,
  outputFile = DEFAULT_OUTPUT_FILE
}) {
  const resolvedManifest = path.resolve(manifestFile);
  const manifest = readManifest(resolvedManifest);
  const plan = buildPagesDeployPlan({
    manifest,
    sourceManifest: resolvedManifest
  });
  const writtenOutput = writePlan(plan, outputFile);
  printPlan(plan, writtenOutput);
  return plan;
}

function createTestFile(root, relativePath, sizeBytes = 1) {
  const filePath = path.resolve(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "w");

  try {
    fs.ftruncateSync(descriptor, sizeBytes);
  } finally {
    fs.closeSync(descriptor);
  }

  return filePath;
}

function testAsset({
  assetId,
  relativePath,
  songId,
  status = ELIGIBLE_SCANNER_STATUS,
  extension = path.extname(relativePath).toLowerCase(),
  sizeBytes = 1
}) {
  return {
    assetId,
    filename: path.basename(relativePath),
    relativePath: toPortablePath(relativePath),
    extension,
    sizeBytes,
    modifiedTime: new Date(0).toISOString(),
    parsed: {},
    match: {
      status,
      songId,
      songName: null,
      artist: null,
      confidence: status === ELIGIBLE_SCANNER_STATUS ? 1 : 0,
      reasons: []
    }
  };
}

function resultFor(plan, assetId) {
  return plan.assets.find((asset) => asset.assetId === assetId);
}

function safelyRemoveTempDirectory(tempRoot, prefix) {
  const resolvedTemp = path.resolve(tempRoot);
  const systemTemp = path.resolve(os.tmpdir());

  if (
    !isPathInside(systemTemp, resolvedTemp) ||
    !path.basename(resolvedTemp).startsWith(prefix)
  ) {
    throw new Error("拒絕清理非測試暫存目錄。");
  }

  fs.rmSync(resolvedTemp, { recursive: true, force: true });
}

function runFixtureSelfTest(outputFile) {
  const prefix = "gsk-pages-plan-fixture-";
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const audioRoot = path.join(tempRoot, "audio");
  fs.mkdirSync(audioRoot, { recursive: true });

  try {
    const files = [
      ["valid.mp3", 10],
      ["valid.m4a", 11],
      ["review.mp3", 1],
      ["unmatched.mp3", 1],
      ["unsupported.flac", 1],
      ["duplicate-a.mp3", 1],
      ["duplicate-b.mp3", 1],
      ["unknown.mp3", 1],
      ["unparsed.mp3", 1],
      ["scanner-duplicate.mp3", 1]
    ];
    files.forEach(([relativePath, sizeBytes]) =>
      createTestFile(audioRoot, relativePath, sizeBytes)
    );
    createTestFile(
      audioRoot,
      "large.mp3",
      MAX_ASSET_SIZE_BYTES + 1
    );
    createTestFile(tempRoot, "outside.mp3", 1);

    const assets = [
      testAsset({
        assetId: "valid-mp3",
        relativePath: "valid.mp3",
        songId: "M000001",
        sizeBytes: 10
      }),
      testAsset({
        assetId: "valid-m4a",
        relativePath: "valid.m4a",
        songId: "M000002",
        sizeBytes: 11
      }),
      testAsset({
        assetId: "review",
        relativePath: "review.mp3",
        songId: "M000003",
        status: "REVIEW_REQUIRED"
      }),
      testAsset({
        assetId: "unmatched",
        relativePath: "unmatched.mp3",
        songId: null,
        status: "UNMATCHED"
      }),
      testAsset({
        assetId: "unsupported",
        relativePath: "unsupported.flac",
        songId: "M000005"
      }),
      testAsset({
        assetId: "missing",
        relativePath: "missing.mp3",
        songId: "M000006"
      }),
      testAsset({
        assetId: "escape",
        relativePath: "../outside.mp3",
        songId: "M000007"
      }),
      testAsset({
        assetId: "duplicate-a",
        relativePath: "duplicate-a.mp3",
        songId: "M000008"
      }),
      testAsset({
        assetId: "duplicate-b",
        relativePath: "duplicate-b.mp3",
        songId: "M000008"
      }),
      testAsset({
        assetId: "large",
        relativePath: "large.mp3",
        songId: "M000010",
        sizeBytes: MAX_ASSET_SIZE_BYTES + 1
      }),
      testAsset({
        assetId: "unknown",
        relativePath: "unknown.mp3",
        songId: "M000011",
        status: "FUTURE_STATUS"
      }),
      testAsset({
        assetId: "unparsed",
        relativePath: "unparsed.mp3",
        songId: null,
        status: "UNPARSED"
      }),
      testAsset({
        assetId: "scanner-duplicate",
        relativePath: "scanner-duplicate.mp3",
        songId: "M000012",
        status: "DUPLICATE_ASSET"
      })
    ];
    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      audioRoot,
      songLibrary: path.join(tempRoot, "songs.json"),
      summary: {},
      assets
    };
    const sourceManifest = path.join(tempRoot, "manifest.json");
    const firstPlan = buildPagesDeployPlan({
      manifest,
      sourceManifest
    });
    const secondPlan = buildPagesDeployPlan({
      manifest,
      sourceManifest
    });
    const writtenOutput = writePlan(firstPlan, outputFile);
    const validMp3 = resultFor(firstPlan, "valid-mp3");
    const validM4a = resultFor(firstPlan, "valid-m4a");
    const duplicateA = resultFor(firstPlan, "duplicate-a");
    const deterministic =
      JSON.stringify(firstPlan.assets) ===
      JSON.stringify(secondPlan.assets);
    const passed =
      firstPlan.summary.totalAssets === 13 &&
      firstPlan.summary.readyForPages === 2 &&
      firstPlan.summary.blocked === 11 &&
      firstPlan.summary.totalReadyFiles === 2 &&
      firstPlan.summary.totalReadyBytes === 21 &&
      validMp3.status === READY_FOR_PAGES &&
      validMp3.mimeType === "audio/mpeg" &&
      validMp3.stagingRelativePath === "M000001/preview.mp3" &&
      validMp3.publicPath === "/M000001/preview.mp3" &&
      validMp3.publicUrl ===
        "https://golden-song-audio.pages.dev/M000001/preview.mp3" &&
      validM4a.status === READY_FOR_PAGES &&
      validM4a.mimeType === "audio/mp4" &&
      resultFor(firstPlan, "review").status === BLOCKED &&
      resultFor(firstPlan, "unmatched").status === BLOCKED &&
      resultFor(firstPlan, "unsupported").reasons.includes(
        "UNSUPPORTED_EXTENSION"
      ) &&
      resultFor(firstPlan, "missing").reasons.includes(
        "SOURCE_FILE_MISSING"
      ) &&
      resultFor(firstPlan, "escape").reasons.includes(
        "SOURCE_PATH_OUTSIDE_ROOT"
      ) &&
      duplicateA.reasons.includes("MULTIPLE_ASSETS_FOR_SONG") &&
      duplicateA.reasons.includes("PUBLIC_PATH_COLLISION") &&
      duplicateA.reasons.includes("STAGING_PATH_COLLISION") &&
      resultFor(firstPlan, "large").reasons.includes(
        "ASSET_TOO_LARGE"
      ) &&
      resultFor(firstPlan, "unknown").status === BLOCKED &&
      resultFor(firstPlan, "unparsed").status === BLOCKED &&
      resultFor(firstPlan, "scanner-duplicate").status === BLOCKED &&
      deterministic;

    return {
      passed,
      deterministic,
      expectedUrlMatched:
        validMp3.publicUrl ===
        "https://golden-song-audio.pages.dev/M000001/preview.mp3",
      summary: firstPlan.summary,
      outputFile: writtenOutput
    };
  } finally {
    safelyRemoveTempDirectory(tempRoot, prefix);
  }
}

function runScaleSelfTest() {
  const prefix = "gsk-pages-plan-scale-";
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const audioRoot = path.join(tempRoot, "audio");
  fs.mkdirSync(audioRoot, { recursive: true });

  try {
    const assets = [];

    for (let index = 1; index <= 500; index += 1) {
      const songId = `M${String(index).padStart(6, "0")}`;
      const relativePath = `${songId}.mp3`;
      createTestFile(audioRoot, relativePath, 1);
      assets.push(
        testAsset({
          assetId: `scale-${index}`,
          relativePath,
          songId
        })
      );
    }

    const manifest = {
      schemaVersion: 1,
      generatedAt: new Date(0).toISOString(),
      audioRoot,
      songLibrary: path.join(tempRoot, "songs.json"),
      summary: {},
      assets
    };
    const startedAt = Date.now();
    const plan = buildPagesDeployPlan({
      manifest,
      sourceManifest: path.join(tempRoot, "manifest.json")
    });
    const publicPaths = new Set(
      plan.assets.map((asset) => asset.publicPath)
    );
    const stagingPaths = new Set(
      plan.assets.map((asset) => asset.stagingRelativePath)
    );
    const passed =
      plan.summary.totalAssets === 500 &&
      plan.summary.readyForPages === 500 &&
      plan.summary.blocked === 0 &&
      plan.summary.totalReadyFiles === 500 &&
      publicPaths.size === 500 &&
      stagingPaths.size === 500 &&
      plan.assets[0].publicPath === "/M000001/preview.mp3" &&
      plan.assets.at(-1).publicPath === "/M000500/preview.mp3";

    return {
      passed,
      durationMs: Date.now() - startedAt,
      uniquePublicPaths: publicPaths.size,
      uniqueStagingPaths: stagingPaths.size,
      summary: plan.summary
    };
  } finally {
    safelyRemoveTempDirectory(tempRoot, prefix);
  }
}

export function runSelfTest(outputFile = DEFAULT_OUTPUT_FILE) {
  const fixture = runFixtureSelfTest(outputFile);
  const scale = runScaleSelfTest();

  console.log(
    `Pages planner fixture：${fixture.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(fixture));
  console.log(
    `Pages planner 500-song：${scale.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(scale));
  console.log(`Fixture Pages plan：${path.resolve(outputFile)}`);

  if (!fixture.passed || !scale.passed) {
    throw new Error("Cloudflare Pages deploy planner self-test failed。");
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
          "scripts/song-import/audio-assets/createPagesDeployPlan.js " +
          "<manifest> [output]"
      );
      process.exitCode = 1;
    } else {
      createPagesDeployPlan({
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
