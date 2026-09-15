/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_CANDIDATE_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/new-song-candidates-v2.json"
);
const DEFAULT_STAGING_ROOT = path.join(
  projectRoot,
  "dist/pages-audio-staging"
);
const DEFAULT_REPORT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/pages-preview-build-report.json"
);
const DEFAULT_FINAL_RESOLUTION_AUDIT = path.join(
  projectRoot,
  "dist/audio-library-audit/pop-music-audit-v3.json"
);
const DEFAULT_FINAL_REPORT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/final-14-preview-build-report.json"
);
const DEFAULT_PRESERVED_PREVIEW = path.join(
  projectRoot,
  "public/audio/test.mp3"
);
const PRODUCTION_ORIGIN = "https://golden-song-audio.pages.dev";
const SONG_ID_PATTERN = /^M\d{6}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
const READY_FOR_IMPORT = "READY_FOR_IMPORT";
const PREVIEW_READY = "PREVIEW_READY";
const SHORT_SOURCE = "SHORT_SOURCE";

class PreviewBuildError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "PreviewBuildError";
    this.code = code;
  }
}

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizePathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32"
    ? resolved.toLocaleLowerCase("en-US")
    : resolved;
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

function readJsonObject(filePath, label) {
  let value;

  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new PreviewBuildError(
      `${label}_UNREADABLE`,
      `${label} 無法讀取：${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewBuildError(`${label}_INVALID`);
  }

  return value;
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = new Uint8Array(256 * 1024);

  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }

  return hash.digest("hex");
}

function runCommand(command, args, code) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });

  if (result.error || result.status !== 0) {
    const detail = result.error?.code || result.stderr?.trim() || code;
    throw new PreviewBuildError(code, `${code}：${detail}`);
  }

  return result.stdout;
}

export function getFfmpegVersion(ffmpegCommand = "ffmpeg") {
  const output = runCommand(
    ffmpegCommand,
    ["-version"],
    "FFMPEG_NOT_FOUND"
  );
  return output.split(/\r?\n/u)[0]?.trim() || "UNKNOWN";
}

export function calculateClipStart(durationSeconds) {
  const duration = Number(durationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new PreviewBuildError("SOURCE_DURATION_INVALID");
  }
  if (duration >= 90) return 30;
  if (duration >= 60) return 15;
  if (duration >= 30) {
    return Number(Math.max(0, (duration - 30) / 2).toFixed(3));
  }
  return 0;
}

function probeAudio(filePath, ffprobeCommand = "ffprobe") {
  const output = runCommand(
    ffprobeCommand,
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:format_tags=title,artist,album:stream=codec_type,codec_name:stream_tags=title,artist,album",
      "-of",
      "json",
      filePath
    ],
    "FFPROBE_FAILED"
  );
  let parsed;

  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new PreviewBuildError(
      "FFPROBE_OUTPUT_INVALID",
      `FFPROBE_OUTPUT_INVALID：${error instanceof Error ? error.message : "Unknown error"}`
    );
  }

  const durationSeconds = Number(parsed?.format?.duration);
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const metadataValues = [
    parsed?.format?.tags?.title,
    parsed?.format?.tags?.artist,
    parsed?.format?.tags?.album,
    ...streams.flatMap((stream) => [
      stream?.tags?.title,
      stream?.tags?.artist,
      stream?.tags?.album
    ])
  ].filter((value) => typeof value === "string" && value.trim());

  return {
    durationSeconds: Number.isFinite(durationSeconds)
      ? Number(durationSeconds.toFixed(3))
      : null,
    codecNames: streams
      .filter((stream) => stream.codec_type === "audio")
      .map((stream) => stream.codec_name),
    hasNonAudioStream: streams.some(
      (stream) => stream.codec_type !== "audio"
    ),
    metadataStripped: metadataValues.length === 0
  };
}

function encodePreview({
  sourcePath,
  destinationPath,
  clipStartSeconds,
  ffmpegCommand = "ffmpeg"
}) {
  runCommand(
    ffmpegCommand,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(clipStartSeconds),
      "-i",
      sourcePath,
      "-t",
      "30",
      "-map",
      "0:a:0",
      "-vn",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-ac",
      "2",
      destinationPath
    ],
    "FFMPEG_ENCODING_FAILED"
  );
}

function validateCandidateReport(report) {
  if (!Array.isArray(report.readyForImport)) {
    throw new PreviewBuildError("CANDIDATE_LIST_INVALID");
  }

  const ids = new Set();
  const outputPaths = new Set();

  for (const candidate of report.readyForImport) {
    if (
      candidate?.status !== READY_FOR_IMPORT ||
      !SONG_ID_PATTERN.test(candidate?.proposedId || "")
    ) {
      throw new PreviewBuildError("CANDIDATE_STATUS_OR_ID_INVALID");
    }

    const outputPath = `${candidate.proposedId}/preview.mp3`;
    if (ids.has(candidate.proposedId)) {
      throw new PreviewBuildError("DUPLICATE_SONG_ID");
    }
    if (outputPaths.has(outputPath)) {
      throw new PreviewBuildError("DUPLICATE_OUTPUT_PATH");
    }
    ids.add(candidate.proposedId);
    outputPaths.add(outputPath);
  }
}

function isFinalResolutionReport(report) {
  return (
    report?.mode === "READ_ONLY_FINAL_RESOLUTION" &&
    Array.isArray(report?.items)
  );
}

function normalizeFinalResolutionReport(report, audit, auditFile) {
  const auditAssets = new Map(
    audit.assets.map((asset) => [
      toPortablePath(asset.relativePath),
      asset
    ])
  );
  const readyItems = report.items.filter(
    (item) => item.resolutionStatus === READY_FOR_IMPORT
  );

  if (
    readyItems.length !== 14 ||
    report.items.some(
      (item) => item.resolutionStatus === "NEEDS_FINAL_CONFIRMATION"
    )
  ) {
    throw new PreviewBuildError("FINAL_RESOLUTION_STATUS_INVALID");
  }

  return {
    source: { auditFile },
    readyForImport: readyItems.map((item) => {
      const relativePath = toPortablePath(item.sourceFile || "");
      const auditAsset = auditAssets.get(relativePath);

      if (!auditAsset) {
        throw new PreviewBuildError(
          "FINAL_RESOLUTION_SOURCE_NOT_IN_AUDIT"
        );
      }

      return {
        proposedId: item.proposedId,
        songName: item.canonicalSongName,
        artist: item.canonicalArtist,
        status: READY_FOR_IMPORT,
        sourceAudio: {
          relativePath,
          extension: auditAsset.extension,
          sha256: item.sha256,
          durationSeconds: auditAsset.durationSeconds
        }
      };
    })
  };
}

function validateProductionPaths(stagingRoot, reportFile) {
  const resolvedStaging = path.resolve(stagingRoot);
  const resolvedReport = path.resolve(reportFile);

  if (!pathsEqual(resolvedStaging, DEFAULT_STAGING_ROOT)) {
    throw new PreviewBuildError("STAGING_ROOT_NOT_ALLOWLISTED");
  }
  if (!isPathInside(path.join(projectRoot, "dist"), resolvedStaging)) {
    throw new PreviewBuildError("STAGING_ROOT_OUTSIDE_DIST");
  }
  if (!isPathInside(path.join(projectRoot, "dist"), resolvedReport)) {
    throw new PreviewBuildError("REPORT_PATH_OUTSIDE_DIST");
  }

  return { stagingRoot: resolvedStaging, reportFile: resolvedReport };
}

function validateTestPaths(stagingRoot, reportFile, testRoot) {
  const resolvedTestRoot = path.resolve(testRoot);
  const resolvedStaging = path.resolve(stagingRoot);
  const resolvedReport = path.resolve(reportFile);

  if (
    !isPathInside(resolvedTestRoot, resolvedStaging) ||
    !isPathInside(resolvedTestRoot, resolvedReport)
  ) {
    throw new PreviewBuildError("TEST_PATH_OUTSIDE_ROOT");
  }

  return { stagingRoot: resolvedStaging, reportFile: resolvedReport };
}

function prepareStagingRoot(stagingRoot, testRoot = null) {
  if (testRoot) {
    if (!isPathInside(path.resolve(testRoot), stagingRoot)) {
      throw new PreviewBuildError("UNSAFE_TEST_STAGING_ROOT");
    }
  } else if (!pathsEqual(stagingRoot, DEFAULT_STAGING_ROOT)) {
    throw new PreviewBuildError("UNSAFE_STAGING_DELETE_TARGET");
  }

  if (fs.existsSync(stagingRoot)) {
    const stats = fs.lstatSync(stagingRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new PreviewBuildError("UNSAFE_STAGING_ROOT_TYPE");
    }
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingRoot, { recursive: true });
}

function resolveSource(audioRoot, candidate) {
  const relativePath = candidate?.sourceAudio?.relativePath;
  if (
    typeof relativePath !== "string" ||
    !relativePath.trim() ||
    path.isAbsolute(relativePath)
  ) {
    throw new PreviewBuildError("SOURCE_PATH_INVALID");
  }

  const sourcePath = path.resolve(audioRoot, relativePath);
  if (!isPathInside(audioRoot, sourcePath)) {
    throw new PreviewBuildError("SOURCE_PATH_ESCAPE");
  }
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new PreviewBuildError("SOURCE_FILE_MISSING");
  }

  const actualSha256 = hashFile(sourcePath);
  if (
    !SHA256_PATTERN.test(candidate?.sourceAudio?.sha256 || "") ||
    actualSha256 !== candidate.sourceAudio.sha256
  ) {
    throw new PreviewBuildError("SOURCE_SHA256_MISMATCH");
  }

  return { sourcePath, actualSha256 };
}

function resolveOutput(stagingRoot, songId) {
  const outputRelativePath = `${songId}/preview.mp3`;
  const outputPath = path.resolve(stagingRoot, outputRelativePath);

  if (!isPathInside(stagingRoot, outputPath)) {
    throw new PreviewBuildError("OUTPUT_PATH_ESCAPE");
  }

  return { outputPath, outputRelativePath };
}

function buildSourceSnapshot(audit) {
  const audioRoot = path.resolve(audit.audioRoot || "");
  if (
    !audioRoot ||
    !Array.isArray(audit.assets) ||
    !fs.existsSync(audioRoot) ||
    !fs.statSync(audioRoot).isDirectory()
  ) {
    throw new PreviewBuildError("SOURCE_AUDIT_INVALID");
  }

  const entries = audit.assets
    .map((asset) => {
      const relativePath = asset.relativePath;
      if (
        typeof relativePath !== "string" ||
        path.isAbsolute(relativePath)
      ) {
        throw new PreviewBuildError("AUDIT_SOURCE_PATH_INVALID");
      }
      const sourcePath = path.resolve(audioRoot, relativePath);
      if (
        !isPathInside(audioRoot, sourcePath) ||
        !fs.existsSync(sourcePath) ||
        !fs.statSync(sourcePath).isFile()
      ) {
        throw new PreviewBuildError("AUDIT_SOURCE_MISSING");
      }
      const stats = fs.statSync(sourcePath);
      return {
        relativePath: toPortablePath(relativePath),
        sizeBytes: stats.size,
        sha256: hashFile(sourcePath)
      };
    })
    .sort((left, right) =>
      left.relativePath < right.relativePath ? -1 : 1
    );
  const snapshotSha256 = crypto
    .createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");

  return { audioRoot, entries, snapshotSha256 };
}

function validatePreview(outputPath, sourceDuration, ffprobeCommand) {
  if (!fs.existsSync(outputPath)) {
    throw new PreviewBuildError("PREVIEW_MISSING");
  }
  const stats = fs.statSync(outputPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new PreviewBuildError("PREVIEW_EMPTY");
  }
  const probe = probeAudio(outputPath, ffprobeCommand);
  if (
    !probe.durationSeconds ||
    probe.durationSeconds <= 0 ||
    probe.durationSeconds > 30.5
  ) {
    throw new PreviewBuildError("PREVIEW_DURATION_INVALID");
  }
  if (
    sourceDuration < 30 &&
    probe.durationSeconds > sourceDuration + 0.5
  ) {
    throw new PreviewBuildError("SHORT_PREVIEW_PADDED");
  }
  if (
    probe.hasNonAudioStream ||
    !probe.codecNames.includes("mp3")
  ) {
    throw new PreviewBuildError("PREVIEW_FORMAT_INVALID");
  }
  if (!probe.metadataStripped) {
    throw new PreviewBuildError("PREVIEW_METADATA_NOT_STRIPPED");
  }

  return {
    sizeBytes: stats.size,
    sha256: hashFile(outputPath),
    ...probe
  };
}

function enumerateStagingFiles(stagingRoot) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PreviewBuildError("STAGING_SYMLINK_NOT_ALLOWED");
      }
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) {
        files.push(toPortablePath(path.relative(stagingRoot, absolutePath)));
      } else {
        throw new PreviewBuildError("STAGING_ENTRY_TYPE_INVALID");
      }
    }
  };

  visit(stagingRoot);
  return files.sort();
}

function expectedExistingPreviewPaths() {
  return [
    "M000001/preview.mp3",
    ...Array.from(
      { length: 95 },
      (_, index) => `M${String(index + 51).padStart(6, "0")}/preview.mp3`
    )
  ];
}

function snapshotStagingFiles(stagingRoot, expectedPaths) {
  if (
    !fs.existsSync(stagingRoot) ||
    !fs.statSync(stagingRoot).isDirectory()
  ) {
    throw new PreviewBuildError("EXISTING_STAGING_MISSING");
  }

  const actualPaths = enumerateStagingFiles(stagingRoot);
  const sortedExpected = [...expectedPaths].sort();
  if (
    actualPaths.length !== sortedExpected.length ||
    actualPaths.some(
      (filePath, index) => filePath !== sortedExpected[index]
    )
  ) {
    throw new PreviewBuildError("EXISTING_STAGING_CONTENT_MISMATCH");
  }

  return actualPaths.map((relativePath) => {
    const absolutePath = path.join(stagingRoot, relativePath);
    return {
      relativePath,
      sizeBytes: fs.statSync(absolutePath).size,
      sha256: hashFile(absolutePath)
    };
  });
}

function validatePreservedStaging(stagingRoot, snapshot) {
  return snapshot.every((entry) => {
    const absolutePath = path.join(stagingRoot, entry.relativePath);
    return (
      fs.existsSync(absolutePath) &&
      fs.statSync(absolutePath).size === entry.sizeBytes &&
      hashFile(absolutePath) === entry.sha256
    );
  });
}

function snapshotResolutionSources(report, audioRoot) {
  return report.items.map((item) => {
    const relativePath = toPortablePath(item.sourceFile || "");
    const sourcePath = path.resolve(audioRoot, relativePath);

    if (
      path.isAbsolute(relativePath) ||
      !isPathInside(audioRoot, sourcePath) ||
      !fs.existsSync(sourcePath) ||
      !fs.statSync(sourcePath).isFile()
    ) {
      throw new PreviewBuildError("RESOLUTION_SOURCE_MISSING");
    }

    const sha256 = hashFile(sourcePath);
    if (!SHA256_PATTERN.test(item.sha256 || "") || sha256 !== item.sha256) {
      throw new PreviewBuildError("RESOLUTION_SOURCE_SHA256_MISMATCH");
    }

    return { relativePath, sha256 };
  });
}

export function buildGamePreviews(options = {}) {
  const candidateFile = path.resolve(
    options.candidateFile || DEFAULT_CANDIDATE_FILE
  );
  const sourceReport = readJsonObject(
    candidateFile,
    "CANDIDATE_REPORT"
  );
  const finalResolutionMode = isFinalResolutionReport(sourceReport);
  const auditFile = path.resolve(
    options.auditFile ||
      (finalResolutionMode
        ? DEFAULT_FINAL_RESOLUTION_AUDIT
        : sourceReport?.source?.auditFile || "")
  );
  const audit = readJsonObject(auditFile, "SOURCE_AUDIT");
  const candidateReport = finalResolutionMode
    ? normalizeFinalResolutionReport(sourceReport, audit, auditFile)
    : sourceReport;
  validateCandidateReport(candidateReport);

  const testRoot = options.testRoot ? path.resolve(options.testRoot) : null;
  const paths = testRoot
    ? validateTestPaths(
        options.stagingRoot,
        options.reportFile,
        testRoot
      )
    : validateProductionPaths(
        options.stagingRoot || DEFAULT_STAGING_ROOT,
        options.reportFile ||
          (finalResolutionMode
            ? DEFAULT_FINAL_REPORT_FILE
            : DEFAULT_REPORT_FILE)
      );
  const sourceBefore = buildSourceSnapshot(audit);
  const resolutionSourcesBefore = finalResolutionMode
    ? snapshotResolutionSources(sourceReport, sourceBefore.audioRoot)
    : null;
  const ffmpegCommand = options.ffmpegCommand || "ffmpeg";
  const ffprobeCommand = options.ffprobeCommand || "ffprobe";
  const ffmpegVersion = getFfmpegVersion(ffmpegCommand);
  const preservedPreview = path.resolve(
    options.preservedPreview || DEFAULT_PRESERVED_PREVIEW
  );

  if (
    !fs.existsSync(preservedPreview) ||
    !fs.statSync(preservedPreview).isFile()
  ) {
    throw new PreviewBuildError("M000001_PREVIEW_MISSING");
  }
  if (!testRoot && !isPathInside(projectRoot, preservedPreview)) {
    throw new PreviewBuildError("M000001_PREVIEW_OUTSIDE_REPO");
  }

  const existingPreviewPaths = finalResolutionMode
    ? expectedExistingPreviewPaths()
    : [];
  const existingStagingBefore = finalResolutionMode
    ? snapshotStagingFiles(paths.stagingRoot, existingPreviewPaths)
    : null;

  if (!finalResolutionMode) {
    prepareStagingRoot(paths.stagingRoot, testRoot);
  }
  const assets = [];
  const expectedPaths = new Set(
    finalResolutionMode
      ? existingPreviewPaths
      : ["M000001/preview.mp3"]
  );
  const audioRoot = sourceBefore.audioRoot;

  for (const candidate of candidateReport.readyForImport) {
    const { sourcePath, actualSha256 } = resolveSource(
      audioRoot,
      candidate
    );
    const { outputPath, outputRelativePath } = resolveOutput(
      paths.stagingRoot,
      candidate.proposedId
    );
    const sourceDuration = Number(
      candidate.sourceAudio.durationSeconds
    );
    const clipStartSeconds = calculateClipStart(sourceDuration);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    encodePreview({
      sourcePath,
      destinationPath: outputPath,
      clipStartSeconds,
      ffmpegCommand
    });
    const preview = validatePreview(
      outputPath,
      sourceDuration,
      ffprobeCommand
    );
    expectedPaths.add(outputRelativePath);
    assets.push({
      songId: candidate.proposedId,
      songName: candidate.songName,
      artist: candidate.artist,
      sourceRelativePath: candidate.sourceAudio.relativePath,
      sourceSha256: actualSha256,
      sourceDurationSeconds: sourceDuration,
      clipStartSeconds,
      previewDurationSeconds: preview.durationSeconds,
      outputRelativePath,
      previewSha256: preview.sha256,
      sizeBytes: preview.sizeBytes,
      publicUrl: `${PRODUCTION_ORIGIN}/${outputRelativePath}`,
      status: sourceDuration < 30 ? SHORT_SOURCE : PREVIEW_READY,
      metadataStripped: preview.metadataStripped
    });
  }

  let preserved = null;
  if (finalResolutionMode) {
    if (!validatePreservedStaging(paths.stagingRoot, existingStagingBefore)) {
      throw new PreviewBuildError("EXISTING_STAGING_SHA256_MISMATCH");
    }
  } else {
    const preservedOutput = resolveOutput(paths.stagingRoot, "M000001");
    fs.mkdirSync(path.dirname(preservedOutput.outputPath), {
      recursive: true
    });
    fs.copyFileSync(preservedPreview, preservedOutput.outputPath);
    const preservedSourceSha256 = hashFile(preservedPreview);
    const preservedOutputSha256 = hashFile(preservedOutput.outputPath);

    if (preservedSourceSha256 !== preservedOutputSha256) {
      throw new PreviewBuildError("M000001_SHA256_MISMATCH");
    }
    preserved = {
      songId: "M000001",
      sourcePath: preservedPreview,
      outputRelativePath: preservedOutput.outputRelativePath,
      sourceSha256: preservedSourceSha256,
      previewSha256: preservedOutputSha256,
      sha256Preserved: true,
      publicUrl: `${PRODUCTION_ORIGIN}/${preservedOutput.outputRelativePath}`
    };
  }

  const actualPaths = enumerateStagingFiles(paths.stagingRoot);
  const expectedPathList = [...expectedPaths].sort();
  if (
    actualPaths.length !== expectedPathList.length ||
    actualPaths.some((filePath, index) => filePath !== expectedPathList[index])
  ) {
    throw new PreviewBuildError("STAGING_CONTENT_MISMATCH");
  }

  const publicUrls = assets.map((asset) => asset.publicUrl);
  if (new Set(publicUrls).size !== publicUrls.length) {
    throw new PreviewBuildError("DUPLICATE_PUBLIC_URL");
  }

  const sourceAfter = buildSourceSnapshot(audit);
  if (sourceBefore.snapshotSha256 !== sourceAfter.snapshotSha256) {
    throw new PreviewBuildError("SOURCE_AUDIO_MODIFIED");
  }
  const resolutionSourcesAfter = finalResolutionMode
    ? snapshotResolutionSources(sourceReport, sourceAfter.audioRoot)
    : null;
  if (
    finalResolutionMode &&
    JSON.stringify(resolutionSourcesBefore) !==
      JSON.stringify(resolutionSourcesAfter)
  ) {
    throw new PreviewBuildError("RESOLUTION_SOURCE_AUDIO_MODIFIED");
  }

  if (finalResolutionMode) {
    const report = {
      schemaVersion: 1,
      source: {
        resolutionFile: candidateFile,
        auditFile,
        audioRoot
      },
      summary: {
        plannedCount: candidateReport.readyForImport.length,
        builtCount: assets.length,
        failedCount: 0,
        preservedExistingCount: existingStagingBefore.length,
        finalStagingCount: actualPaths.length
      },
      encoding: {
        format: "mp3",
        codec: "libmp3lame",
        bitrate: "128k",
        sampleRateHz: 44100,
        channels: 2,
        maxDurationSeconds: 30,
        metadataStripped: true,
        ffmpegVersion
      },
      safety: {
        unresolvedSourcesChecked: resolutionSourcesAfter.length,
        sourceAudioModified: false,
        preservedExistingSha256: true,
        cloudflareWrites: 0,
        firestoreWrites: 0,
        firebaseStorageWrites: 0
      },
      stagingRoot: paths.stagingRoot,
      stagingFiles: actualPaths,
      assets: assets.map((asset) => ({
        songId: asset.songId,
        songName: asset.songName,
        artist: asset.artist,
        sourceFile: asset.sourceRelativePath,
        sourceSha256: asset.sourceSha256,
        outputPath: asset.outputRelativePath,
        outputSha256: asset.previewSha256,
        duration: asset.previewDurationSeconds,
        size: asset.sizeBytes,
        previewUrl: asset.publicUrl,
        status: "BUILT"
      }))
    };

    fs.mkdirSync(path.dirname(paths.reportFile), { recursive: true });
    fs.writeFileSync(
      paths.reportFile,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );

    return { report, reportFile: paths.reportFile };
  }

  const report = {
    schemaVersion: 1,
    source: {
      candidateFile,
      auditFile,
      audioRoot
    },
    encoding: {
      format: "mp3",
      codec: "libmp3lame",
      bitrate: "128k",
      sampleRateHz: 44100,
      channels: 2,
      maxDurationSeconds: 30,
      metadataStripped: true,
      ffmpegVersion
    },
    summary: {
      readySourceCount: candidateReport.readyForImport.length,
      newPreviewsGenerated: assets.length,
      preservedExistingPreviews: 1,
      totalStagingAudioFiles: actualPaths.length,
      encodingFailures: 0,
      shortSources: assets.filter(
        (asset) => asset.status === SHORT_SOURCE
      ).length
    },
    safety: {
      sourceFileCountBefore: sourceBefore.entries.length,
      sourceFileCountAfter: sourceAfter.entries.length,
      sourceSnapshotBefore: sourceBefore.snapshotSha256,
      sourceSnapshotAfter: sourceAfter.snapshotSha256,
      sourceAudioModified: false,
      cloudflareWrites: 0,
      firestoreWrites: 0,
      firebaseStorageWrites: 0
    },
    preserved,
    validation: {
      passed: true,
      pathsUnique: expectedPaths.size === actualPaths.length,
      publicUrlsUnique: true,
      allPreviewSha256Present: assets.every((asset) =>
        SHA256_PATTERN.test(asset.previewSha256)
      ),
      allPreviewDurationsValid: assets.every(
        (asset) =>
          asset.previewDurationSeconds > 0 &&
          asset.previewDurationSeconds <= 30.5
      ),
      allMetadataStripped: assets.every(
        (asset) => asset.metadataStripped
      ),
      unexpectedFiles: 0
    },
    stagingRoot: paths.stagingRoot,
    stagingFiles: actualPaths,
    assets
  };

  fs.mkdirSync(path.dirname(paths.reportFile), { recursive: true });
  fs.writeFileSync(
    paths.reportFile,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  return { report, reportFile: paths.reportFile };
}

function createSineAudio(
  outputPath,
  durationSeconds,
  ffmpegCommand,
  metadata = false
) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${durationSeconds}`,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "64k"
  ];
  if (metadata) {
    args.push(
      "-metadata",
      "title=測試歌名",
      "-metadata",
      "artist=測試歌手",
      "-metadata",
      "album=測試專輯"
    );
  }
  args.push(outputPath);
  runCommand(ffmpegCommand, args, "SELF_TEST_SOURCE_CREATE_FAILED");
}

function fixtureCandidate(songId, relativePath, sourcePath, durationSeconds) {
  return {
    proposedId: songId,
    songName: `測試歌曲${songId}`,
    artist: "測試歌手",
    status: READY_FOR_IMPORT,
    sourceAudio: {
      relativePath: toPortablePath(relativePath),
      extension: ".mp3",
      sha256: hashFile(sourcePath),
      durationSeconds
    }
  };
}

export function runSelfTest() {
  const testRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "game-preview-builder-")
  );
  const sourceRoot = path.join(testRoot, "source");
  const stagingRoot = path.join(testRoot, "staging");
  const reportFile = path.join(testRoot, "report.json");
  const candidateFile = path.join(testRoot, "candidates.json");
  const auditFile = path.join(testRoot, "audit.json");
  const preservedPreview = path.join(testRoot, "M000001.mp3");
  const ffmpegCommand = "ffmpeg";
  const failures = [];
  const check = (condition, label) => {
    if (!condition) failures.push(label);
  };

  try {
    const fixtures = [
      ["M000051", "long.mp3", 100],
      ["M000052", "medium.mp3", 70],
      ["M000053", "center.mp3", 45],
      ["M000054", "short.mp3", 10]
    ];
    const candidates = fixtures.map(
      ([songId, relativePath, durationSeconds], index) => {
        const sourcePath = path.join(sourceRoot, relativePath);
        createSineAudio(
          sourcePath,
          durationSeconds,
          ffmpegCommand,
          index === 0
        );
        return fixtureCandidate(
          songId,
          relativePath,
          sourcePath,
          durationSeconds
        );
      }
    );
    createSineAudio(preservedPreview, 5, ffmpegCommand, true);
    const audit = {
      audioRoot: sourceRoot,
      assets: candidates.map((candidate) => ({
        relativePath: candidate.sourceAudio.relativePath
      }))
    };
    fs.writeFileSync(auditFile, JSON.stringify(audit));
    fs.writeFileSync(
      candidateFile,
      JSON.stringify({
        source: { auditFile },
        readyForImport: candidates
      })
    );

    const result = buildGamePreviews({
      candidateFile,
      auditFile,
      stagingRoot,
      reportFile,
      preservedPreview,
      testRoot
    });
    const starts = result.report.assets.map(
      (asset) => asset.clipStartSeconds
    );
    check(
      JSON.stringify(starts) === JSON.stringify([30, 15, 7.5, 0]),
      "CLIP_SELECTION"
    );
    check(
      result.report.summary.shortSources === 1,
      "SHORT_SOURCE_STATUS"
    );
    check(
      result.report.validation.allMetadataStripped,
      "METADATA_STRIPPING"
    );
    check(
      result.report.preserved.sha256Preserved,
      "M000001_PRESERVATION"
    );
    check(
      result.report.summary.totalStagingAudioFiles === 5,
      "STAGING_FILE_COUNT"
    );

    let missingSourcePassed = false;
    try {
      resolveSource(sourceRoot, {
        sourceAudio: {
          relativePath: "missing.mp3",
          sha256: "0".repeat(64)
        }
      });
    } catch (error) {
      missingSourcePassed = error?.code === "SOURCE_FILE_MISSING";
    }
    check(missingSourcePassed, "MISSING_SOURCE");

    let ffmpegFailurePassed = false;
    try {
      getFfmpegVersion("definitely-missing-ffmpeg-command");
    } catch (error) {
      ffmpegFailurePassed = error?.code === "FFMPEG_NOT_FOUND";
    }
    check(ffmpegFailurePassed, "FFMPEG_FAILURE");

    let pathEscapePassed = false;
    try {
      resolveSource(sourceRoot, {
        sourceAudio: {
          relativePath: "../escape.mp3",
          sha256: "0".repeat(64)
        }
      });
    } catch (error) {
      pathEscapePassed = error?.code === "SOURCE_PATH_ESCAPE";
    }
    check(pathEscapePassed, "PATH_ESCAPE");

    let duplicateOutputPassed = false;
    try {
      validateCandidateReport({
        readyForImport: [candidates[0], { ...candidates[0] }]
      });
    } catch (error) {
      duplicateOutputPassed = error?.code === "DUPLICATE_SONG_ID";
    }
    check(duplicateOutputPassed, "DUPLICATE_OUTPUT");

    return {
      passed: failures.length === 0,
      failures,
      checks: {
        durationAtLeast90: starts[0] === 30,
        duration60To89: starts[1] === 15,
        duration30To59: starts[2] === 7.5,
        durationBelow30: starts[3] === 0,
        missingSource: missingSourcePassed,
        ffmpegFailure: ffmpegFailurePassed,
        pathEscape: pathEscapePassed,
        duplicateOutput: duplicateOutputPassed,
        metadataStripping:
          result.report.validation.allMetadataStripped,
        m000001Preservation:
          result.report.preserved.sha256Preserved
      }
    };
  } finally {
    const resolvedTestRoot = path.resolve(testRoot);
    if (isPathInside(path.resolve(os.tmpdir()), resolvedTestRoot)) {
      fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
    }
  }
}

function printSummary(report, reportFile) {
  if (typeof report.summary.plannedCount === "number") {
    console.log(`READY sources：${report.summary.plannedCount}`);
    console.log(`New previews：${report.summary.builtCount}`);
    console.log(
      `Preserved previews：${report.summary.preservedExistingCount}`
    );
    console.log(
      `Total staging files：${report.summary.finalStagingCount}`
    );
    console.log(`Failed previews：${report.summary.failedCount}`);
    console.log(`Report：${reportFile}`);
    return;
  }

  console.log(`READY sources：${report.summary.readySourceCount}`);
  console.log(`New previews：${report.summary.newPreviewsGenerated}`);
  console.log(
    `Preserved previews：${report.summary.preservedExistingPreviews}`
  );
  console.log(
    `Total staging files：${report.summary.totalStagingAudioFiles}`
  );
  console.log(`Short sources：${report.summary.shortSources}`);
  console.log(`Report：${reportFile}`);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    if (process.argv.includes("--self-test")) {
      const result = runSelfTest();
      console.log(
        `Game preview builder self-test：${result.passed ? "PASS" : "FAIL"}`
      );
      console.log(JSON.stringify(result));
      if (!result.passed) process.exitCode = 1;
    } else {
      const candidateFile = process.argv[2]
        ? resolveCliPath(process.argv[2])
        : DEFAULT_CANDIDATE_FILE;
      const result = buildGamePreviews({ candidateFile });
      printSummary(result.report, result.reportFile);
    }
  } catch (error) {
    console.error(
      `Game preview build 失敗 [${error?.code || "UNKNOWN"}]：${error instanceof Error ? error.message : "Unknown error"}`
    );
    process.exitCode = 1;
  }
}
