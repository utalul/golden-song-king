/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Buffer } from "buffer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_AUDIT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/pop-music-audit-v3.json"
);
const DEFAULT_LIBRARY_FILE = path.join(
  projectRoot,
  "src/data/songs/all_with_spotify.json"
);
const DEFAULT_OUTPUT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/new-song-candidates-v2.json"
);
const PAGES_ORIGIN = "https://golden-song-audio.pages.dev";
const SONG_ID_PATTERN = /^M(\d+)$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;

const IDENTITY_STATUSES = Object.freeze({
  IDENTIFIED_NOT_IN_LIBRARY: "IDENTIFIED_NOT_IN_LIBRARY",
  TITLE_ONLY: "TITLE_ONLY",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  ALREADY_IN_LIBRARY: "ALREADY_IN_LIBRARY",
  POSSIBLE_DUPLICATE: "POSSIBLE_DUPLICATE"
});
const METADATA_FILENAME_CONFLICTS = new Set([
  "TITLE_CONFLICT",
  "ARTIST_CONFLICT",
  "BOTH_CONFLICT"
]);

function resolveCliPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

function toPortablePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function normalizeIdentityPart(value) {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLocaleLowerCase("zh-TW")
        .replace(/[–—－]/gu, "-")
        .replace(/\s+/gu, " ")
        .trim()
    : "";
}

export function getCandidateIdentityKey(songName, artist) {
  const normalizedSongName = normalizeIdentityPart(songName);
  const normalizedArtist = normalizeIdentityPart(artist);

  return normalizedSongName && normalizedArtist
    ? `${normalizedSongName}\u0000${normalizedArtist}`
    : "";
}

function readJson(filePath, label) {
  let value;

  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `${label} 無法讀取：${error instanceof Error ? error.message : "Unknown error"}`,
      { cause: error }
    );
  }

  return value;
}

function readAudit(filePath) {
  const audit = readJson(filePath, "Audio audit report");

  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    throw new Error("Audio audit report 必須是 JSON object。");
  }

  if (!Array.isArray(audit.assets)) {
    throw new Error("Audio audit report 缺少 assets array。");
  }

  if (typeof audit.audioRoot !== "string" || !audit.audioRoot.trim()) {
    throw new Error("Audio audit report 缺少 audioRoot。");
  }

  return audit;
}

function readSongLibrary(filePath) {
  const songs = readJson(filePath, "正式歌曲資料庫");

  if (!Array.isArray(songs)) {
    throw new Error("正式歌曲資料庫必須是 JSON array。");
  }

  return songs;
}

function compareText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isRetainedCanonical(asset) {
  return !asset?.duplicate || asset.duplicate.isCanonical === true;
}

function hasReliableIdentity(asset) {
  return (
    asset?.identity?.status ===
      IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY &&
    asset?.parsed?.reliable === true &&
    typeof asset.parsed.songName === "string" &&
    asset.parsed.songName.trim() !== "" &&
    typeof asset.parsed.artist === "string" &&
    asset.parsed.artist.trim() !== ""
  );
}

function uniqueReasons(...reasonGroups) {
  return [
    ...new Set(
      reasonGroups.flat().filter(
        (reason) => typeof reason === "string" && reason
      )
    )
  ];
}

function structuralSanityReasons(asset) {
  const songName = asset?.parsed?.songName?.trim() || "";
  const artist = asset?.parsed?.artist?.trim() || "";
  const reasons = [];
  const forbiddenText = /\.(mp3|m4a|aac|wav|ogg)\b|Official\s*(MV|Music Video)|官方完整版\s*MV?|MV$/iu;
  const wrapperText = /MV_|[《》【】]/u;
  const releaseArtifactSuffix = /(?:^|[\s_-])(字幕|鈴聲)$/u;
  const suspiciousPunctuation =
    /(^|\s)[_-]{2,}|(?:\[|\]|\{|\}){2,}/u;

  if (!songName) reasons.push("SONG_NAME_EMPTY");
  if (!artist) reasons.push("ARTIST_EMPTY");
  if (
    songName &&
    artist &&
    normalizeIdentityPart(songName) === normalizeIdentityPart(artist)
  ) {
    reasons.push("SONG_NAME_EQUALS_ARTIST");
  }
  if (forbiddenText.test(songName) || forbiddenText.test(artist)) {
    reasons.push("RELEASE_OR_EXTENSION_TEXT_REMAINS");
  }
  if (wrapperText.test(songName) || wrapperText.test(artist)) {
    reasons.push("PARSER_WRAPPER_REMAINS");
  }
  if (
    releaseArtifactSuffix.test(songName) ||
    releaseArtifactSuffix.test(artist)
  ) {
    reasons.push("RELEASE_ARTIFACT_SUFFIX_REMAINS");
  }
  if (
    suspiciousPunctuation.test(songName) ||
    suspiciousPunctuation.test(artist)
  ) {
    reasons.push("SUSPICIOUS_PUNCTUATION");
  }

  return reasons;
}

function qualityGateReasons(asset) {
  const reasons = structuralSanityReasons(asset);
  const directoryStatus = asset?.directoryArtistValidation?.status;
  const comparisonStatus = asset?.metadataFilenameComparison?.status;

  if (
    asset?.filenameParsed?.method ===
      "ARTIST_DIRECTORY_TITLE_FILENAME" &&
    directoryStatus !== "DIRECTORY_ARTIST_CONFIRMED"
  ) {
    reasons.push(
      directoryStatus || "DIRECTORY_ARTIST_UNVERIFIED"
    );
  }
  if (METADATA_FILENAME_CONFLICTS.has(comparisonStatus)) {
    reasons.push(`METADATA_FILENAME_${comparisonStatus}`);
  }

  return uniqueReasons(reasons);
}

function normalizeVariantText(value) {
  return normalizeIdentityPart(value).replace(
    /[\s.．・/／_\-()[\]{}<>〈〉《》「」『』【】]/gu,
    ""
  );
}

function levenshteinDistance(left, right) {
  if (!left) return right.length;
  if (!right) return left.length;
  let previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          Number(left[leftIndex - 1] !== right[rightIndex - 1])
      );
    }
    previous = current;
  }

  return previous[right.length];
}

function isPossibleTextVariantDuplicate(left, right) {
  const leftArtist = normalizeVariantText(left?.parsed?.artist);
  const rightArtist = normalizeVariantText(right?.parsed?.artist);
  const leftTitle = normalizeVariantText(left?.parsed?.songName);
  const rightTitle = normalizeVariantText(right?.parsed?.songName);

  if (
    !leftArtist ||
    leftArtist !== rightArtist ||
    !leftTitle ||
    !rightTitle ||
    getCandidateIdentityKey(
      left.parsed.songName,
      left.parsed.artist
    ) ===
      getCandidateIdentityKey(
        right.parsed.songName,
        right.parsed.artist
      )
  ) {
    return false;
  }

  const distance = levenshteinDistance(leftTitle, rightTitle);
  return distance <= 1 && Math.max(leftTitle.length, rightTitle.length) >= 4;
}

function findPossibleDuplicateGroups(assets) {
  const parents = assets.map((_, index) => index);
  const find = (index) => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]];
      current = parents[current];
    }
    return current;
  };
  const unite = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < assets.length; left += 1) {
    for (let right = left + 1; right < assets.length; right += 1) {
      if (isPossibleTextVariantDuplicate(assets[left], assets[right])) {
        unite(left, right);
      }
    }
  }

  const groups = new Map();
  assets.forEach((asset, index) => {
    const root = find(index);
    const group = groups.get(root) || [];
    group.push(asset);
    groups.set(root, group);
  });

  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) =>
      [...group].sort((left, right) =>
        compareText(left.relativePath, right.relativePath)
      )
    );
}

function hasReliableMetadata(asset) {
  return (
    asset?.identity?.source === "EMBEDDED_METADATA" &&
    asset?.metadata?.reliable === true &&
    typeof asset.metadata.cleanedTitle === "string" &&
    typeof asset.metadata.cleanedArtist === "string"
  );
}

function canonicalCandidateComparator(left, right) {
  const metadataDifference =
    Number(hasReliableMetadata(right)) -
    Number(hasReliableMetadata(left));

  if (metadataDifference !== 0) return metadataDifference;

  const confidenceDifference =
    Number(right?.parsed?.confidence || 0) -
    Number(left?.parsed?.confidence || 0);

  if (confidenceDifference !== 0) return confidenceDifference;

  const duplicateCanonicalDifference =
    Number(right?.duplicate?.isCanonical === true) -
    Number(left?.duplicate?.isCanonical === true);

  if (duplicateCanonicalDifference !== 0) {
    return duplicateCanonicalDifference;
  }

  return compareText(left.relativePath, right.relativePath);
}

function getExistingLibraryState(songs) {
  const ids = new Set();
  const identityKeys = new Set();
  let maxNumericId = 0;
  let idWidth = 6;

  for (const song of songs) {
    if (typeof song?.id === "string" && song.id.trim()) {
      if (ids.has(song.id)) {
        throw new Error(`正式題庫含重複 song ID：${song.id}`);
      }

      ids.add(song.id);
      const match = song.id.match(SONG_ID_PATTERN);

      if (match) {
        maxNumericId = Math.max(maxNumericId, Number(match[1]));
        idWidth = Math.max(idWidth, match[1].length);
      }
    }

    const identityKey = getCandidateIdentityKey(
      song?.songName,
      song?.artist
    );

    if (identityKey) identityKeys.add(identityKey);
  }

  return { ids, identityKeys, maxNumericId, idWidth };
}

function allocateProposedIds(count, existingState) {
  const proposedIds = [];
  const allocatedIds = new Set();
  let numericId = existingState.maxNumericId;

  while (proposedIds.length < count) {
    numericId += 1;
    const proposedId = `M${String(numericId).padStart(
      existingState.idWidth,
      "0"
    )}`;

    if (
      existingState.ids.has(proposedId) ||
      allocatedIds.has(proposedId)
    ) {
      continue;
    }

    allocatedIds.add(proposedId);
    proposedIds.push(proposedId);
  }

  return proposedIds;
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

function resolveSourceFile(audioRoot, asset) {
  if (
    typeof asset?.relativePath !== "string" ||
    !asset.relativePath.trim() ||
    path.isAbsolute(asset.relativePath)
  ) {
    throw new Error("Audio asset 含無效 relativePath。");
  }

  const sourcePath = path.resolve(audioRoot, asset.relativePath);

  if (!isPathInside(audioRoot, sourcePath)) {
    throw new Error(`Audio asset 超出 audioRoot：${asset.relativePath}`);
  }

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`找不到 canonical source：${asset.relativePath}`);
  }

  const stats = fs.statSync(sourcePath);

  if (!stats.isFile()) {
    throw new Error(`Canonical source 不是檔案：${asset.relativePath}`);
  }

  if (
    Number.isFinite(asset.sizeBytes) &&
    stats.size !== asset.sizeBytes
  ) {
    throw new Error(`Canonical source 大小已改變：${asset.relativePath}`);
  }

  return { sourcePath, stats };
}

function captureSourceSnapshot(audioRoot, assets) {
  const entries = assets
    .map((asset) => {
      const { stats } = resolveSourceFile(audioRoot, asset);
      return {
        relativePath: toPortablePath(asset.relativePath),
        sizeBytes: stats.size,
        modifiedTimeMs: stats.mtimeMs
      };
    })
    .sort((left, right) =>
      compareText(left.relativePath, right.relativePath)
    );

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex");
}

function buildUnresolvedCandidate(asset) {
  return {
    fileName: asset.filename,
    relativePath: toPortablePath(asset.relativePath),
    parsedTitle: asset?.parsed?.songName || null,
    parsedArtist: asset?.parsed?.artist || null,
    status: asset?.identity?.status || "UNKNOWN_AUDIO",
    reasons: [
      ...(asset?.parsed?.reasons || []),
      ...(asset?.identity?.reasons || []),
      ...qualityGateReasons(asset)
    ].filter((reason, index, reasons) =>
      reason && reasons.indexOf(reason) === index
    ),
    parseMethod: asset?.parsed?.method || null,
    evidence: {
      directoryArtistValidation:
        asset?.directoryArtistValidation || null,
      metadataFilenameComparison:
        asset?.metadataFilenameComparison || null
    }
  };
}

function buildQualityCandidate(asset, status, reasons = []) {
  return {
    fileName: asset.filename,
    relativePath: toPortablePath(asset.relativePath),
    parsedTitle: asset?.parsed?.songName || null,
    parsedArtist: asset?.parsed?.artist || null,
    parseMethod: asset?.parsed?.method || null,
    confidence: asset?.parsed?.confidence ?? 0,
    sourceType: asset?.identity?.source || null,
    status,
    reasons: uniqueReasons(
      asset?.parsed?.reasons || [],
      asset?.identity?.reasons || [],
      reasons
    ),
    evidence: {
      directoryArtistValidation:
        asset?.directoryArtistValidation || null,
      metadataFilenameComparison:
        asset?.metadataFilenameComparison || null
    },
    sourceAudio: {
      extension: asset.extension,
      sha256: asset.sha256,
      durationSeconds: asset.durationSeconds
    }
  };
}

function evidenceForSpotCheck(asset) {
  return uniqueReasons(
    asset?.parsed?.reasons || [],
    asset?.directoryArtistValidation?.reasons || [],
    asset?.metadataFilenameComparison?.reasons || []
  );
}

function buildReadyCandidate(asset, proposedId, audioRoot) {
  const { sourcePath } = resolveSourceFile(audioRoot, asset);
  const extension = String(asset.extension || "").toLowerCase();

  if (!extension.startsWith(".")) {
    throw new Error(`無效音訊副檔名：${asset.relativePath}`);
  }

  if (!SHA256_PATTERN.test(asset.sha256 || "")) {
    throw new Error(`Canonical source 缺少 SHA-256：${asset.relativePath}`);
  }

  const previewRelativePath = `${proposedId}/preview${extension}`;

  return {
    proposedId,
    songName: asset.parsed.songName.trim(),
    artist: asset.parsed.artist.trim(),
    category: null,
    decade: null,
    difficulty: null,
    metadataStatus: "NEEDS_ENRICHMENT",
    sourceAudio: {
      relativePath: toPortablePath(asset.relativePath),
      extension,
      sha256: asset.sha256,
      durationSeconds: asset.durationSeconds
    },
    parseMethod: asset.parsed.method,
    confidence: asset.parsed.confidence,
    sourceType: asset.identity.source,
    existingLibraryMatch: false,
    status: "READY_FOR_IMPORT",
    audioStatus: "SOURCE_READY",
    plannedPreview: {
      relativePath: previewRelativePath,
      publicUrl: `${PAGES_ORIGIN}/${previewRelativePath}`
    },
    toolingOnly: {
      absoluteSourcePath: sourcePath
    }
  };
}

function validateUnique(values, label) {
  const seen = new Set();

  for (const value of values) {
    if (!value || seen.has(value)) {
      throw new Error(`${label} 驗證失敗：${value || "EMPTY"}`);
    }
    seen.add(value);
  }
}

function validateReport(report, existingState) {
  const candidates = report.readyForImport;
  const ids = candidates.map((candidate) => candidate.proposedId);
  const identityKeys = candidates.map((candidate) =>
    getCandidateIdentityKey(candidate.songName, candidate.artist)
  );
  const previewPaths = candidates.map(
    (candidate) => candidate.plannedPreview.relativePath
  );
  const previewUrls = candidates.map(
    (candidate) => candidate.plannedPreview.publicUrl
  );

  validateUnique(ids, "Proposed ID uniqueness");
  validateUnique(identityKeys, "Song identity uniqueness");
  validateUnique(previewPaths, "Preview path uniqueness");
  validateUnique(previewUrls, "Preview URL uniqueness");

  const idCollision = ids.some((id) => existingState.ids.has(id));
  const identityCollision = identityKeys.some((identityKey) =>
    existingState.identityKeys.has(identityKey)
  );
  const missingSha256 = candidates.some(
    (candidate) =>
      !SHA256_PATTERN.test(candidate.sourceAudio.sha256 || "")
  );
  const structuralViolations = candidates.flatMap((candidate) =>
    structuralSanityReasons({
      parsed: {
        songName: candidate.songName,
        artist: candidate.artist
      }
    })
  );

  if (idCollision) throw new Error("Candidate ID 與正式題庫衝突。");
  if (identityCollision) {
    throw new Error("Candidate songName + artist 與正式題庫衝突。");
  }
  if (missingSha256) throw new Error("Candidate 缺少 SHA-256。");
  if (structuralViolations.length > 0) {
    throw new Error("READY_FOR_IMPORT 含結構品質問題。");
  }

  return {
    passed: true,
    proposedIdsUnique: true,
    songIdentitiesUnique: true,
    previewPathsUnique: true,
    previewUrlsUnique: true,
    existingIdCollisions: 0,
    existingIdentityCollisions: 0,
    missingSha256: 0,
    missingCanonicalSources: 0,
    structuralViolations: 0,
    allReadyCandidatesPassedQualityGate: true
  };
}

export function generateCandidateReport(audit, songs, options = {}) {
  const audioRoot = path.resolve(audit.audioRoot);
  const existingState = getExistingLibraryState(songs);
  const retainedAssets = audit.assets.filter(isRetainedCanonical);
  const beforeSnapshot = captureSourceSnapshot(
    audioRoot,
    audit.assets
  );
  const titleOnlyAssets = retainedAssets.filter(
    (asset) =>
      asset?.identity?.status === IDENTITY_STATUSES.TITLE_ONLY
  );
  const initialReviewAssets = retainedAssets.filter(
    (asset) =>
      asset?.identity?.status === IDENTITY_STATUSES.REVIEW_REQUIRED
  );
  const identifiedAssets = retainedAssets.filter(hasReliableIdentity);
  const alreadyInLibrary = [];
  const candidateGroups = new Map();

  for (const asset of identifiedAssets) {
    const identityKey = getCandidateIdentityKey(
      asset.parsed.songName,
      asset.parsed.artist
    );
    const existingId = asset?.parsed?.id;

    if (
      (typeof existingId === "string" &&
        existingState.ids.has(existingId)) ||
      existingState.identityKeys.has(identityKey)
    ) {
      alreadyInLibrary.push(
        buildQualityCandidate(
          asset,
          IDENTITY_STATUSES.ALREADY_IN_LIBRARY,
          ["EXISTING_LIBRARY_IDENTITY_MATCH"]
        )
      );
      continue;
    }

    const group = candidateGroups.get(identityKey) || [];
    group.push(asset);
    candidateGroups.set(identityKey, group);
  }

  const canonicalAssets = [];
  const candidateDuplicateGroups = [];

  for (const [identityKey, assets] of candidateGroups) {
    const ordered = [...assets].sort(canonicalCandidateComparator);
    canonicalAssets.push({ identityKey, asset: ordered[0] });

    if (ordered.length > 1) {
      candidateDuplicateGroups.push({
        songName: ordered[0].parsed.songName,
        artist: ordered[0].parsed.artist,
        canonicalRelativePath: toPortablePath(
          ordered[0].relativePath
        ),
        excludedRelativePaths: ordered
          .slice(1)
          .map((asset) => toPortablePath(asset.relativePath))
      });
    }
  }

  canonicalAssets.sort((left, right) => {
    const identityOrder = compareText(
      left.identityKey,
      right.identityKey
    );
    return identityOrder !== 0
      ? identityOrder
      : compareText(left.asset.relativePath, right.asset.relativePath);
  });

  const reviewAssetMap = new Map(
    initialReviewAssets.map((asset) => [asset.relativePath, asset])
  );
  const structurallyEligibleAssets = [];

  for (const { asset } of canonicalAssets) {
    const gateReasons = qualityGateReasons(asset);
    if (gateReasons.length > 0) {
      reviewAssetMap.set(asset.relativePath, asset);
    } else {
      structurallyEligibleAssets.push(asset);
    }
  }

  const nearDuplicatePool = [
    ...structurallyEligibleAssets,
    ...reviewAssetMap.values()
  ].filter(
    (asset) => asset?.parsed?.songName && asset?.parsed?.artist
  );
  const possibleDuplicateGroups = findPossibleDuplicateGroups(
    nearDuplicatePool
  );
  const possibleDuplicatePaths = new Set(
    possibleDuplicateGroups.flatMap((group) =>
      group.map((asset) => asset.relativePath)
    )
  );
  const possibleDuplicates = possibleDuplicateGroups.map(
    (group, index) => ({
      groupId: `POSSIBLE_DUPLICATE_${String(index + 1).padStart(3, "0")}`,
      reason: "POSSIBLE_TEXT_VARIANT_DUPLICATE",
      members: group.map((asset) =>
        buildQualityCandidate(
          asset,
          IDENTITY_STATUSES.POSSIBLE_DUPLICATE,
          [
            "REVIEW_REQUIRED_DUPLICATE",
            "POSSIBLE_TEXT_VARIANT_DUPLICATE"
          ]
        )
      )
    })
  );
  const finalReadyAssets = structurallyEligibleAssets.filter(
    (asset) => !possibleDuplicatePaths.has(asset.relativePath)
  );
  const reviewRequired = [...reviewAssetMap.values()]
    .filter((asset) => !possibleDuplicatePaths.has(asset.relativePath))
    .map((asset) =>
      buildQualityCandidate(
        asset,
        IDENTITY_STATUSES.REVIEW_REQUIRED,
        qualityGateReasons(asset)
      )
    )
    .sort((left, right) =>
      compareText(left.relativePath, right.relativePath)
    );
  const titleOnly = titleOnlyAssets
    .map(buildUnresolvedCandidate)
    .sort((left, right) =>
      compareText(left.relativePath, right.relativePath)
    );
  const proposedIds = allocateProposedIds(
    finalReadyAssets.length,
    existingState
  );
  const readyForImport = finalReadyAssets.map((asset, index) =>
    buildReadyCandidate(asset, proposedIds[index], audioRoot)
  );
  const duplicateSongCount = candidateDuplicateGroups.reduce(
    (total, group) => total + group.excludedRelativePaths.length,
    0
  );
  const afterSnapshot = captureSourceSnapshot(audioRoot, audit.assets);

  if (beforeSnapshot !== afterSnapshot) {
    throw new Error("來源音訊在 candidate generation 期間發生變更。");
  }

  const readyByPath = new Map(
    readyForImport.map((candidate) => [
      candidate.sourceAudio.relativePath,
      candidate
    ])
  );
  const statusByPath = new Map();
  readyForImport.forEach((candidate) =>
    statusByPath.set(
      candidate.sourceAudio.relativePath,
      "READY_FOR_IMPORT"
    )
  );
  reviewRequired.forEach((candidate) =>
    statusByPath.set(candidate.relativePath, "REVIEW_REQUIRED")
  );
  titleOnly.forEach((candidate) =>
    statusByPath.set(candidate.relativePath, "TITLE_ONLY")
  );
  alreadyInLibrary.forEach((candidate) =>
    statusByPath.set(candidate.relativePath, "ALREADY_IN_LIBRARY")
  );
  possibleDuplicates.forEach((group) =>
    group.members.forEach((candidate) =>
      statusByPath.set(candidate.relativePath, "POSSIBLE_DUPLICATE")
    )
  );
  candidateDuplicateGroups.forEach((group) =>
    group.excludedRelativePaths.forEach((relativePath) =>
      statusByPath.set(relativePath, "CANDIDATE_DUPLICATE_EXCLUDED")
    )
  );
  audit.assets
    .filter((asset) => asset.duplicate?.isCanonical === false)
    .forEach((asset) =>
      statusByPath.set(asset.relativePath, "SHA256_DUPLICATE_EXCLUDED")
    );

  const buildSpotCheck = (asset) => {
    const readyCandidate = readyByPath.get(asset.relativePath);
    return {
      proposedId: readyCandidate?.proposedId || null,
      songName: asset?.parsed?.songName || null,
      artist: asset?.parsed?.artist || null,
      sourceFilename: asset.filename,
      relativePath: toPortablePath(asset.relativePath),
      parseMethod: asset?.parsed?.method || null,
      evidence: evidenceForSpotCheck(asset),
      status: statusByPath.get(asset.relativePath) || "NOT_SELECTED"
    };
  };
  const directoryArtistCandidates = audit.assets
    .filter(
      (asset) =>
        asset?.filenameParsed?.method ===
        "ARTIST_DIRECTORY_TITLE_FILENAME"
    )
    .map(buildSpotCheck);
  const spotCheckPaths = new Set();
  const spotCheckAssets = [];
  const addSpotCheckAsset = (asset) => {
    if (!asset || spotCheckPaths.has(asset.relativePath)) return;
    spotCheckPaths.add(asset.relativePath);
    spotCheckAssets.push(asset);
  };

  audit.assets
    .filter(
      (asset) =>
        asset.relativePath === "周蕙 - 約定.mp3" ||
        asset.filename.includes("傷心的人別聽慢歌") ||
        asset.filename.includes("傷心的人别聽慢歌") ||
        asset?.filenameParsed?.method ===
          "ARTIST_DIRECTORY_TITLE_FILENAME"
    )
    .forEach(addSpotCheckAsset);
  const seenMethods = new Set();
  audit.assets.forEach((asset) => {
    const method = asset?.parsed?.method;
    if (method && !seenMethods.has(method)) {
      seenMethods.add(method);
      addSpotCheckAsset(asset);
    }
  });
  for (const asset of finalReadyAssets) {
    if (spotCheckAssets.length >= 30) break;
    addSpotCheckAsset(asset);
  }

  const report = {
    schemaVersion: 1,
    generatedFromAuditAt: audit.generatedAt || null,
    source: {
      auditFile: options.auditFile || null,
      songLibraryFile: options.libraryFile || null,
      audioRoot
    },
    summary: {
      totalUniqueAudio:
        audit?.summary?.uniqueAudioFiles ?? retainedAssets.length,
      identifiedNotInLibrary: identifiedAssets.length,
      readyForImport: readyForImport.length,
      alreadyInLibrary: alreadyInLibrary.length,
      candidateDuplicateSongs: duplicateSongCount,
      candidateDuplicateSongGroups: candidateDuplicateGroups.length,
      titleOnly: titleOnly.length,
      reviewRequired: reviewRequired.length,
      possibleDuplicate: possibleDuplicatePaths.size,
      possibleDuplicateGroups: possibleDuplicates.length,
      directoryArtistConfirmed:
        audit?.summary?.directoryArtistValidation
          ?.DIRECTORY_ARTIST_CONFIRMED || 0,
      directoryArtistUnverified:
        audit?.summary?.directoryArtistValidation
          ?.DIRECTORY_ARTIST_UNVERIFIED || 0,
      directoryArtistConflict:
        audit?.summary?.directoryArtistValidation
          ?.DIRECTORY_ARTIST_CONFLICT || 0,
      metadataFilenameConflicts:
        audit?.summary?.metadataFilenameConflicts?.total || 0,
      firstProposedId: readyForImport[0]?.proposedId || null,
      lastProposedId:
        readyForImport[readyForImport.length - 1]?.proposedId || null,
      plannedPreviewUrls: readyForImport.length
    },
    safety: {
      sourceSnapshotBefore: beforeSnapshot,
      sourceSnapshotAfter: afterSnapshot,
      sourceAudioModified: false,
      firestoreWrites: 0,
      cloudflareWrites: 0
    },
    readyForImport,
    alreadyInLibrary,
    candidateDuplicateGroups,
    reviewRequired,
    titleOnly,
    possibleDuplicates,
    unresolvedCandidates: [...reviewRequired, ...titleOnly],
    directoryArtistCandidates,
    spotCheck: spotCheckAssets.map(buildSpotCheck),
    validation: null
  };

  report.validation = validateReport(report, existingState);
  return report;
}

export function runCandidateGenerator(options = {}) {
  const auditFile = path.resolve(
    options.auditFile || DEFAULT_AUDIT_FILE
  );
  const libraryFile = path.resolve(
    options.libraryFile || DEFAULT_LIBRARY_FILE
  );
  const outputFile = path.resolve(
    options.outputFile || DEFAULT_OUTPUT_FILE
  );
  const audit = readAudit(auditFile);
  const songs = readSongLibrary(libraryFile);
  const report = generateCandidateReport(audit, songs, {
    auditFile,
    libraryFile
  });

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);

  return { outputFile, report };
}

function createFixtureAsset(audioRoot, fixture) {
  const sourcePath = path.join(audioRoot, fixture.relativePath);
  const content = Buffer.from(fixture.relativePath, "utf8");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, content);

  return {
    filename: path.basename(fixture.relativePath),
    relativePath: fixture.relativePath,
    extension: path.extname(fixture.relativePath),
    sizeBytes: content.length,
    durationSeconds: 30,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    metadata: {
      cleanedTitle: fixture.songName,
      cleanedArtist: fixture.artist,
      reliable: fixture.sourceType === "EMBEDDED_METADATA"
    },
    filenameParsed: {
      songName: fixture.songName,
      artist: fixture.artist,
      method:
        fixture.filenameParseMethod ||
        fixture.parseMethod ||
        "ARTIST_COMPACT_DASH_TITLE",
      reliable: fixture.reliable !== false
    },
    parsed: {
      id: null,
      songName: fixture.songName,
      artist: fixture.artist,
      method: fixture.parseMethod || "ARTIST_COMPACT_DASH_TITLE",
      confidence: fixture.confidence ?? 0.98,
      reliable: fixture.reliable !== false,
      reasons: fixture.reasons || []
    },
    identity: {
      status: fixture.status,
      source: fixture.sourceType || "FILENAME",
      reasons: fixture.reasons || []
    },
    directoryArtistValidation: fixture.directoryStatus
      ? {
          status: fixture.directoryStatus,
          reasons: [fixture.directoryStatus]
        }
      : null,
    metadataFilenameComparison: {
      status: fixture.metadataFilenameStatus || "NOT_COMPARABLE",
      reasons: fixture.metadataFilenameStatus
        ? [`METADATA_FILENAME_${fixture.metadataFilenameStatus}`]
        : []
    },
    duplicate: fixture.duplicate || null
  };
}

export function runSelfTest() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "song-candidates-")
  );
  const fixtures = [
    {
      relativePath: "filename-alpha.mp3",
      songName: "新歌甲",
      artist: "歌手甲",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY,
      confidence: 1
    },
    {
      relativePath: "metadata-alpha.mp3",
      songName: "新歌甲",
      artist: "歌手甲",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY,
      sourceType: "EMBEDDED_METADATA",
      parseMethod: "EMBEDDED_METADATA_ARTIST_PREFIX",
      confidence: 0.95
    },
    {
      relativePath: "beta.m4a",
      songName: "新歌乙",
      artist: "歌手乙",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY
    },
    {
      relativePath: "existing.mp3",
      songName: "既有歌曲",
      artist: "既有歌手",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY
    },
    {
      relativePath: "title-only.mp3",
      songName: "只有歌名",
      artist: null,
      status: IDENTITY_STATUSES.TITLE_ONLY,
      reliable: false,
      reasons: ["ARTIST_MISSING"]
    },
    {
      relativePath: "review.mp3",
      songName: null,
      artist: null,
      status: IDENTITY_STATUSES.REVIEW_REQUIRED,
      reliable: false,
      reasons: ["MULTI_UNDERSCORE_AMBIGUOUS_TITLE_POSITION"]
    },
    {
      relativePath: "variant-traditional.mp3",
      songName: "傷心的人別聽慢歌",
      artist: "五月天",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY
    },
    {
      relativePath: "variant-simplified.mp3",
      songName: "傷心的人别聽慢歌",
      artist: "五月天",
      status: IDENTITY_STATUSES.REVIEW_REQUIRED,
      reliable: false,
      reasons: ["METADATA_FILENAME_TITLE_CONFLICT"]
    },
    {
      relativePath: "歌手丙/directory-confirmed.mp3",
      songName: "資料夾歌名",
      artist: "歌手丙",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY,
      parseMethod: "ARTIST_DIRECTORY_TITLE_FILENAME",
      filenameParseMethod: "ARTIST_DIRECTORY_TITLE_FILENAME",
      directoryStatus: "DIRECTORY_ARTIST_CONFIRMED"
    },
    {
      relativePath: "歌手丁/directory-unverified.mp3",
      songName: "未驗證歌名",
      artist: "歌手丁",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY,
      parseMethod: "ARTIST_DIRECTORY_TITLE_FILENAME",
      filenameParseMethod: "ARTIST_DIRECTORY_TITLE_FILENAME",
      directoryStatus: "DIRECTORY_ARTIST_UNVERIFIED"
    },
    {
      relativePath: "metadata-conflict.mp3",
      songName: "衝突歌名",
      artist: "衝突歌手",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY,
      metadataFilenameStatus: "TITLE_CONFLICT"
    },
    {
      relativePath: "release-artifact.mp3",
      songName: "測試歌曲 Official MV",
      artist: "測試歌手",
      status: IDENTITY_STATUSES.IDENTIFIED_NOT_IN_LIBRARY
    }
  ];

  try {
    const assets = fixtures.map((fixture) =>
      createFixtureAsset(tempRoot, fixture)
    );
    const audit = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      audioRoot: tempRoot,
      summary: { uniqueAudioFiles: assets.length },
      assets
    };
    const songs = [
      { id: "M000001", songName: "起始歌曲", artist: "歌手" },
      { id: "M000003", songName: "既有歌曲", artist: "既有歌手" }
    ];
    const first = generateCandidateReport(audit, songs);
    const second = generateCandidateReport(audit, songs);
    const failures = [];
    const check = (condition, message) => {
      if (!condition) failures.push(message);
    };

    check(first.summary.readyForImport === 3, "READY_FOR_IMPORT_COUNT");
    check(first.summary.alreadyInLibrary === 1, "EXISTING_LIBRARY_EXCLUSION");
    check(first.summary.candidateDuplicateSongs === 1, "DUPLICATE_SONG_DEDUPE");
    check(first.summary.titleOnly === 1, "TITLE_ONLY_EXCLUSION");
    check(first.summary.reviewRequired === 4, "REVIEW_REQUIRED_EXCLUSION");
    check(first.summary.firstProposedId === "M000004", "FIRST_ID_ALLOCATION");
    check(first.summary.lastProposedId === "M000006", "LAST_ID_ALLOCATION");
    const alphaCandidate = first.readyForImport.find(
      (candidate) => candidate.songName === "新歌甲"
    );
    check(
      alphaCandidate?.sourceType === "EMBEDDED_METADATA",
      "METADATA_CANONICAL_PRIORITY"
    );
    check(
      JSON.stringify(first.readyForImport) ===
        JSON.stringify(second.readyForImport),
      "DETERMINISTIC_OUTPUT"
    );
    check(first.validation.passed === true, "VALIDATION_FAILED");
    check(
      first.summary.possibleDuplicate === 2,
      "NEAR_DUPLICATE_DETECTION"
    );
    check(
      first.reviewRequired.some(
        (candidate) =>
          candidate.relativePath ===
          "歌手丁/directory-unverified.mp3"
      ),
      "DIRECTORY_UNVERIFIED_GATE"
    );
    check(
      first.readyForImport.some(
        (candidate) =>
          candidate.sourceAudio.relativePath ===
          "歌手丙/directory-confirmed.mp3"
      ),
      "DIRECTORY_CONFIRMED_GATE"
    );
    check(
      first.reviewRequired.some(
        (candidate) =>
          candidate.relativePath === "metadata-conflict.mp3"
      ),
      "METADATA_CONFLICT_GATE"
    );
    check(
      first.reviewRequired.some(
        (candidate) =>
          candidate.relativePath === "release-artifact.mp3"
      ),
      "STRUCTURAL_SANITY_GATE"
    );

    return {
      passed: failures.length === 0,
      failures,
      checks: {
        duplicateSongCandidateDedupe: failures.includes(
          "DUPLICATE_SONG_DEDUPE"
        ) === false,
        existingLibraryExclusion: failures.includes(
          "EXISTING_LIBRARY_EXCLUSION"
        ) === false,
        deterministicIdAllocation: failures.includes(
          "DETERMINISTIC_OUTPUT"
        ) === false,
        duplicateIdPrevention: first.validation.proposedIdsUnique,
        duplicatePreviewPathPrevention:
          first.validation.previewPathsUnique,
        titleOnlyExclusion: failures.includes("TITLE_ONLY_EXCLUSION") === false,
        reviewRequiredExclusion: failures.includes(
          "REVIEW_REQUIRED_EXCLUSION"
        ) === false,
        directoryConfirmation: failures.includes(
          "DIRECTORY_CONFIRMED_GATE"
        ) === false,
        directoryUnverified: failures.includes(
          "DIRECTORY_UNVERIFIED_GATE"
        ) === false,
        metadataConflict: failures.includes(
          "METADATA_CONFLICT_GATE"
        ) === false,
        nearDuplicateDetection: failures.includes(
          "NEAR_DUPLICATE_DETECTION"
        ) === false,
        structuralSanity: failures.includes(
          "STRUCTURAL_SANITY_GATE"
        ) === false
      }
    };
  } finally {
    const resolvedTempRoot = path.resolve(tempRoot);
    const resolvedSystemTemp = path.resolve(os.tmpdir());

    if (isPathInside(resolvedSystemTemp, resolvedTempRoot)) {
      fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
    }
  }
}

function printSummary(report, outputFile) {
  console.log(`Unique audio：${report.summary.totalUniqueAudio}`);
  console.log(
    `Identified not in library：${report.summary.identifiedNotInLibrary}`
  );
  console.log(`Ready for import：${report.summary.readyForImport}`);
  console.log(`Review required：${report.summary.reviewRequired}`);
  console.log(`Title only：${report.summary.titleOnly}`);
  console.log(
    `Possible duplicate：${report.summary.possibleDuplicate}`
  );
  console.log(`Already in library：${report.summary.alreadyInLibrary}`);
  console.log(
    `Candidate duplicate songs：${report.summary.candidateDuplicateSongs}`
  );
  console.log(
    `Proposed IDs：${report.summary.firstProposedId || "N/A"} - ${report.summary.lastProposedId || "N/A"}`
  );
  console.log(`Report：${outputFile}`);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  try {
    if (process.argv.includes("--self-test")) {
      const result = runSelfTest();
      console.log(`Candidate generator self-test：${result.passed ? "PASS" : "FAIL"}`);
      console.log(JSON.stringify(result));
      if (!result.passed) process.exitCode = 1;
    } else {
      const auditFile = process.argv[2]
        ? resolveCliPath(process.argv[2])
        : DEFAULT_AUDIT_FILE;
      const outputFile = process.argv[3]
        ? resolveCliPath(process.argv[3])
        : DEFAULT_OUTPUT_FILE;
      const libraryFile = process.argv[4]
        ? resolveCliPath(process.argv[4])
        : DEFAULT_LIBRARY_FILE;
      const result = runCandidateGenerator({
        auditFile,
        outputFile,
        libraryFile
      });
      printSummary(result.report, result.outputFile);
    }
  } catch (error) {
    console.error(
      `Candidate generator 失敗：${error instanceof Error ? error.message : "Unknown error"}`
    );
    process.exitCode = 1;
  }
}
