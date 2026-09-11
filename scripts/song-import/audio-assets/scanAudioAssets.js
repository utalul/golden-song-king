/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { MATCH_CONFIG } from "../matchConfig.js";
import {
  normalizeMatchText,
  scoreTrackMatch
} from "../matchEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_LIBRARY_FILE = path.join(
  projectRoot,
  "src/data/songs/all_with_spotify.json"
);
const DEFAULT_OUTPUT_FILE = path.join(
  projectRoot,
  "scripts/song-import/output/audio-assets-manifest.json"
);

const SUPPORTED_EXTENSIONS = new Set([
  ".mp3",
  ".m4a",
  ".aac",
  ".wav",
  ".ogg"
]);

const AUDIO_ASSET_STATUSES = Object.freeze({
  AUTO_MATCH: "AUTO_MATCH",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  UNMATCHED: "UNMATCHED",
  UNPARSED: "UNPARSED",
  DUPLICATE_ASSET: "DUPLICATE_ASSET"
});

const AMBIGUITY_SCORE_GAP = 0.05;

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function readSongLibrary(filePath) {
  const songs = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(songs)) {
    throw new Error("歌曲資料庫必須是 JSON array。");
  }

  return songs.filter(
    (song) =>
      typeof song?.id === "string" &&
      typeof song?.songName === "string" &&
      typeof song?.artist === "string"
  );
}

export function parseAudioFilename(filename) {
  const extension = path.extname(filename);
  const basename = path.basename(filename, extension).trim();
  const doubleUnderscoreParts = basename
    .split("__")
    .map((part) => part.trim());

  if (
    doubleUnderscoreParts.length === 3 &&
    /^M\d{6}$/i.test(doubleUnderscoreParts[0]) &&
    doubleUnderscoreParts.every(Boolean)
  ) {
    return {
      parsedId: doubleUnderscoreParts[0].toUpperCase(),
      parsedSongName: doubleUnderscoreParts[1],
      parsedArtist: doubleUnderscoreParts[2],
      parseMethod: "ID_DOUBLE_UNDERSCORE"
    };
  }

  if (
    doubleUnderscoreParts.length === 2 &&
    doubleUnderscoreParts.every(Boolean)
  ) {
    return {
      parsedId: null,
      parsedSongName: doubleUnderscoreParts[0],
      parsedArtist: doubleUnderscoreParts[1],
      parseMethod: "DOUBLE_UNDERSCORE"
    };
  }

  const dashParts = basename
    .split(/\s+-\s+/)
    .map((part) => part.trim());

  if (dashParts.length === 2 && dashParts.every(Boolean)) {
    return {
      parsedId: null,
      parsedSongName: dashParts[0],
      parsedArtist: dashParts[1],
      parseMethod: "SPACED_DASH"
    };
  }

  return {
    parsedId: null,
    parsedSongName: null,
    parsedArtist: null,
    parseMethod: "UNPARSED"
  };
}

function scanDirectory(audioRoot) {
  const assets = [];
  let totalFiles = 0;

  function visit(directory) {
    const entries = fs.readdirSync(directory, {
      withFileTypes: true
    });

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      totalFiles += 1;

      const extension = path.extname(entry.name).toLowerCase();

      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        continue;
      }

      const stats = fs.statSync(absolutePath);
      const relativePath = toPortablePath(
        path.relative(audioRoot, absolutePath)
      );
      const parsedFilename = parseAudioFilename(entry.name);

      assets.push({
        assetId: crypto
          .createHash("sha256")
          .update(relativePath)
          .digest("hex")
          .slice(0, 16),
        filename: entry.name,
        relativePath,
        extension,
        sizeBytes: stats.size,
        modifiedTime: stats.mtime.toISOString(),
        parsed: {
          id: parsedFilename.parsedId,
          songName: parsedFilename.parsedSongName,
          artist: parsedFilename.parsedArtist,
          method: parsedFilename.parseMethod
        }
      });
    }
  }

  visit(audioRoot);

  assets.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-TW")
  );

  return { assets, totalFiles };
}

function matchResult(status, song, score, reasons) {
  return {
    status,
    songId: song?.id || null,
    songName: song?.songName || null,
    artist: song?.artist || null,
    confidence: score?.confidence ?? 0,
    titleScore: score?.titleScore ?? 0,
    artistScore: score?.artistScore ?? 0,
    reasons
  };
}

function parsedCandidate(parsed) {
  return {
    matchedSongName: parsed.songName,
    matchedArtist: parsed.artist
  };
}

function scoreSong(parsed, song) {
  return scoreTrackMatch(song, parsedCandidate(parsed));
}

function exactMetadataSongs(parsed, songs) {
  const songName = normalizeMatchText(parsed.songName);
  const artist = normalizeMatchText(parsed.artist);

  return songs.filter(
    (song) =>
      normalizeMatchText(song.songName) === songName &&
      normalizeMatchText(song.artist) === artist
  );
}

function matchById(parsed, songsById, songs) {
  const idSong = songsById.get(parsed.id);

  if (!idSong) {
    return null;
  }

  const exactMetadata = exactMetadataSongs(parsed, songs);
  const score = scoreSong(parsed, idSong);
  const metadataPointsElsewhere = exactMetadata.some(
    (song) => song.id !== idSong.id
  );
  const metadataConflicts =
    metadataPointsElsewhere ||
    score.confidence < MATCH_CONFIG.autoApproveThreshold;

  if (metadataConflicts) {
    return matchResult(
      AUDIO_ASSET_STATUSES.REVIEW_REQUIRED,
      idSong,
      score,
      [
        "ID_EXACT",
        "ID_METADATA_CONFLICT",
        ...score.reasons
      ]
    );
  }

  return matchResult(
    AUDIO_ASSET_STATUSES.AUTO_MATCH,
    idSong,
    score,
    ["ID_EXACT", "METADATA_CONFIRMED", ...score.reasons]
  );
}

function matchByExactMetadata(parsed, songs) {
  const exactSongs = exactMetadataSongs(parsed, songs);

  if (exactSongs.length === 0) {
    return null;
  }

  const score = scoreSong(parsed, exactSongs[0]);

  if (parsed.id || exactSongs.length > 1) {
    return matchResult(
      AUDIO_ASSET_STATUSES.REVIEW_REQUIRED,
      exactSongs.length === 1 ? exactSongs[0] : null,
      score,
      [
        parsed.id
          ? "PARSED_ID_NOT_FOUND"
          : "AMBIGUOUS_EXACT_METADATA",
        "METADATA_EXACT",
        ...score.reasons
      ]
    );
  }

  return matchResult(
    AUDIO_ASSET_STATUSES.AUTO_MATCH,
    exactSongs[0],
    score,
    ["METADATA_EXACT", ...score.reasons]
  );
}

function matchBySimilarity(parsed, songs) {
  const ranked = songs
    .map((song) => ({ song, score: scoreSong(parsed, song) }))
    .sort(
      (left, right) =>
        right.score.confidence - left.score.confidence
    );
  const best = ranked[0];
  const second = ranked[1];

  if (!best) {
    return matchResult(
      AUDIO_ASSET_STATUSES.UNMATCHED,
      null,
      null,
      ["SONG_LIBRARY_EMPTY"]
    );
  }

  const isAmbiguous =
    second &&
    second.score.confidence >= MATCH_CONFIG.reviewThreshold &&
    best.score.confidence - second.score.confidence <
      AMBIGUITY_SCORE_GAP;

  if (isAmbiguous) {
    return matchResult(
      AUDIO_ASSET_STATUSES.REVIEW_REQUIRED,
      best.song,
      best.score,
      ["AMBIGUOUS_SONG_CANDIDATES", ...best.score.reasons]
    );
  }

  if (
    !parsed.id &&
    best.score.confidence >= MATCH_CONFIG.autoApproveThreshold
  ) {
    return matchResult(
      AUDIO_ASSET_STATUSES.AUTO_MATCH,
      best.song,
      best.score,
      ["HIGH_CONFIDENCE_SIMILARITY", ...best.score.reasons]
    );
  }

  if (best.score.confidence >= MATCH_CONFIG.reviewThreshold) {
    return matchResult(
      AUDIO_ASSET_STATUSES.REVIEW_REQUIRED,
      best.song,
      best.score,
      [
        parsed.id
          ? "PARSED_ID_NOT_FOUND"
          : "SIMILARITY_REQUIRES_REVIEW",
        ...best.score.reasons
      ]
    );
  }

  return matchResult(
    AUDIO_ASSET_STATUSES.UNMATCHED,
    null,
    best.score,
    ["CONFIDENCE_BELOW_REVIEW_THRESHOLD", ...best.score.reasons]
  );
}

function matchAsset(asset, songs, songsById) {
  const { parsed } = asset;

  if (parsed.method === "UNPARSED") {
    return matchResult(
      AUDIO_ASSET_STATUSES.UNPARSED,
      null,
      null,
      ["FILENAME_UNPARSED"]
    );
  }

  if (parsed.id) {
    const idMatch = matchById(parsed, songsById, songs);

    if (idMatch) {
      return idMatch;
    }
  }

  return (
    matchByExactMetadata(parsed, songs) ||
    matchBySimilarity(parsed, songs)
  );
}

function duplicateReasons(assets) {
  const reasonsByAssetId = new Map();

  function addReason(asset, reason) {
    const reasons = reasonsByAssetId.get(asset.assetId) || new Set();
    reasons.add(reason);
    reasonsByAssetId.set(asset.assetId, reasons);
  }

  function markDuplicateGroups(keyForAsset, reason) {
    const groups = new Map();

    for (const asset of assets) {
      const key = keyForAsset(asset);

      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(asset);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      if (group.length > 1) {
        group.forEach((asset) => addReason(asset, reason));
      }
    }
  }

  markDuplicateGroups(
    (asset) => asset.relativePath.toLocaleLowerCase("en-US"),
    "DUPLICATE_RELATIVE_PATH"
  );
  markDuplicateGroups(
    (asset) => asset.filename.toLocaleLowerCase("en-US"),
    "DUPLICATE_FILENAME"
  );
  markDuplicateGroups(
    (asset) => asset.match.songId,
    "DUPLICATE_SONG_ASSET"
  );

  return reasonsByAssetId;
}

function applyDuplicateStatuses(assets) {
  const reasonsByAssetId = duplicateReasons(assets);

  return assets.map((asset) => {
    const duplicateReasonSet = reasonsByAssetId.get(asset.assetId);

    if (!duplicateReasonSet) {
      return asset;
    }

    return {
      ...asset,
      match: {
        ...asset.match,
        status: AUDIO_ASSET_STATUSES.DUPLICATE_ASSET,
        reasons: [
          ...asset.match.reasons,
          ...duplicateReasonSet
        ]
      }
    };
  });
}

function buildSummary(totalFiles, assets) {
  const count = (status) =>
    assets.filter((asset) => asset.match.status === status).length;

  return {
    totalFiles,
    supportedAudioFiles: assets.length,
    autoMatched: count(AUDIO_ASSET_STATUSES.AUTO_MATCH),
    reviewRequired: count(
      AUDIO_ASSET_STATUSES.REVIEW_REQUIRED
    ),
    unmatched: count(AUDIO_ASSET_STATUSES.UNMATCHED),
    unparsed: count(AUDIO_ASSET_STATUSES.UNPARSED),
    duplicateAssets: count(
      AUDIO_ASSET_STATUSES.DUPLICATE_ASSET
    )
  };
}

export function buildAudioAssetManifest({
  audioRoot,
  libraryFile = DEFAULT_LIBRARY_FILE
}) {
  const resolvedAudioRoot = path.resolve(audioRoot);

  if (
    !fs.existsSync(resolvedAudioRoot) ||
    !fs.statSync(resolvedAudioRoot).isDirectory()
  ) {
    throw new Error(`找不到音訊資料夾：${resolvedAudioRoot}`);
  }

  const songs = readSongLibrary(libraryFile);
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const scan = scanDirectory(resolvedAudioRoot);
  const matchedAssets = scan.assets.map((asset) => ({
    ...asset,
    match: matchAsset(asset, songs, songsById)
  }));
  const assets = applyDuplicateStatuses(matchedAssets);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    audioRoot: resolvedAudioRoot,
    songLibrary: path.resolve(libraryFile),
    summary: buildSummary(scan.totalFiles, assets),
    assets
  };
}

function writeManifest(manifest, outputFile) {
  const resolvedOutput = path.resolve(outputFile);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(
    resolvedOutput,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );

  return resolvedOutput;
}

function printManifestSummary(manifest, outputFile) {
  const summary = manifest.summary;
  console.log(`總檔案：${summary.totalFiles}`);
  console.log(`支援音訊：${summary.supportedAudioFiles}`);
  console.log(`自動配對：${summary.autoMatched}`);
  console.log(`需要審核：${summary.reviewRequired}`);
  console.log(`無法配對：${summary.unmatched}`);
  console.log(`無法解析：${summary.unparsed}`);
  console.log(`重複資產：${summary.duplicateAssets}`);

  const detailedStatuses = new Set([
    AUDIO_ASSET_STATUSES.REVIEW_REQUIRED,
    AUDIO_ASSET_STATUSES.UNMATCHED,
    AUDIO_ASSET_STATUSES.UNPARSED,
    AUDIO_ASSET_STATUSES.DUPLICATE_ASSET
  ]);

  manifest.assets
    .filter((asset) => detailedStatuses.has(asset.match.status))
    .forEach((asset) => {
      console.log(
        `[${asset.match.status}] ${asset.relativePath} ` +
        `(${asset.match.reasons.join(", ")})`
      );
    });

  console.log(`Manifest：${outputFile}`);
}

function createEmptyFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "", "utf8");
}

function runFixtureTest(libraryFile, outputFile) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-audio-fixture-")
  );

  try {
    [
      "M000001__月亮代表我的心__鄧麗君.mp3",
      "童年__羅大佑.m4a",
      "姐妹 - 張惠妹.aac",
      "M000033__江南__錯誤歌手.wav",
      "不存在歌曲__未知歌手.ogg",
      "badfilename.mp3",
      "1980/童年 - 羅大佑.MP3",
      "1990/姐妹 - 張惠妹.aac",
      "notes.txt"
    ].forEach((filename) => createEmptyFile(tempRoot, filename));

    const manifest = buildAudioAssetManifest({
      audioRoot: tempRoot,
      libraryFile
    });
    const writtenOutput = writeManifest(
      { ...manifest, testFixture: true },
      outputFile
    );

    return {
      passed:
        manifest.summary.totalFiles === 9 &&
        manifest.summary.supportedAudioFiles === 8 &&
        manifest.summary.autoMatched === 1 &&
        manifest.summary.reviewRequired === 1 &&
        manifest.summary.unmatched === 1 &&
        manifest.summary.unparsed === 1 &&
        manifest.summary.duplicateAssets === 4,
      summary: manifest.summary,
      outputFile: writtenOutput
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runScaleTest(libraryFile) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-audio-scale-")
  );

  try {
    for (let index = 1; index <= 500; index += 1) {
      const bucket = String(Math.ceil(index / 100));
      createEmptyFile(
        tempRoot,
        `${bucket}/批次測試${String(index).padStart(3, "0")}__` +
          `測試歌手${String(index).padStart(3, "0")}.mp3`
      );
    }

    const startedAt = Date.now();
    const manifest = buildAudioAssetManifest({
      audioRoot: tempRoot,
      libraryFile
    });

    return {
      passed:
        manifest.summary.totalFiles === 500 &&
        manifest.summary.supportedAudioFiles === 500,
      durationMs: Date.now() - startedAt,
      summary: manifest.summary
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

export function runSelfTest(libraryFile = DEFAULT_LIBRARY_FILE) {
  const fixture = runFixtureTest(
    libraryFile,
    DEFAULT_OUTPUT_FILE
  );
  const scale = runScaleTest(libraryFile);

  console.log(
    `Fixture test：${fixture.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(fixture.summary));
  console.log(`Fixture manifest：${fixture.outputFile}`);
  console.log(
    `500-file test：${scale.passed ? "PASS" : "FAIL"} ` +
      `(${scale.durationMs}ms)`
  );
  console.log(JSON.stringify(scale.summary));

  if (!fixture.passed || !scale.passed) {
    throw new Error("Managed audio scanner self-test failed。");
  }

  return { fixture, scale };
}

export function runAudioAssetScan({
  audioRoot,
  outputFile = DEFAULT_OUTPUT_FILE,
  libraryFile = DEFAULT_LIBRARY_FILE
}) {
  const manifest = buildAudioAssetManifest({
    audioRoot,
    libraryFile
  });
  const writtenOutput = writeManifest(manifest, outputFile);
  printManifestSummary(manifest, writtenOutput);
  return manifest;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    if (process.argv[2] === "--self-test") {
      runSelfTest(
        process.argv[3]
          ? resolveCliPath(process.argv[3])
          : DEFAULT_LIBRARY_FILE
      );
    } else if (!process.argv[2]) {
      console.error(
        "用法：node scripts/song-import/audio-assets/scanAudioAssets.js " +
          "<audio-folder> [output] [song-library]"
      );
      process.exitCode = 1;
    } else {
      runAudioAssetScan({
        audioRoot: resolveCliPath(process.argv[2]),
        outputFile: process.argv[3]
          ? resolveCliPath(process.argv[3])
          : DEFAULT_OUTPUT_FILE,
        libraryFile: process.argv[4]
          ? resolveCliPath(process.argv[4])
          : DEFAULT_LIBRARY_FILE
      });
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
