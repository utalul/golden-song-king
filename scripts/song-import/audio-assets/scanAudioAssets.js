/* global process */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
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
const GENERIC_DIRECTORY_NAMES = new Set([
  "music",
  "音樂",
  "流行音樂",
  "mp3",
  "audio",
  "songs",
  "download",
  "downloads",
  "unknown"
]);
const RELEASE_SUFFIX_PATTERNS = [
  /\s*[（(]\s*(官方完整版\s*MV|官方完整版|Official MV|Official Music Video|MV|HD|HQ)\s*[）)]\s*$/iu,
  /\s*(官方完整版\s*MV|官方完整版|Official MV|Official Music Video|MV|HD|HQ)\s*$/iu
];

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

function normalizeParserText(value) {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFKC")
    .replace(/[–—－]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

function compactIdentityText(value) {
  return normalizeParserText(value)
    .toLocaleLowerCase("zh-TW")
    .replace(/[\s./・／_-]+/gu, "");
}

function normalizeArtistSet(values = []) {
  return new Map(
    [...values]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => [compactIdentityText(value), value.trim()])
  );
}

function cleanReleaseSuffix(title) {
  let cleanedTitle = normalizeParserText(title);
  const notes = [];

  for (const pattern of RELEASE_SUFFIX_PATTERNS) {
    const match = cleanedTitle.match(pattern);
    if (!match) continue;
    notes.push(`REMOVED_RELEASE_SUFFIX:${match[1]}`);
    cleanedTitle = cleanedTitle.slice(0, match.index).trim();
    break;
  }

  return { cleanedTitle, notes };
}

function parseResult({
  parsedId = null,
  parsedSongName = null,
  parsedArtist = null,
  parseMethod,
  confidence,
  reliable,
  reasons = [],
  notes = [],
  candidateTokens = [],
  requiresReview = false
}) {
  return {
    parsedId,
    parsedSongName,
    parsedTitle: parsedSongName,
    parsedArtist,
    parseMethod,
    confidence,
    reliable,
    reasons,
    notes,
    candidateTokens,
    requiresReview
  };
}

function isGenericDirectory(directoryName) {
  return GENERIC_DIRECTORY_NAMES.has(
    normalizeParserText(directoryName).toLocaleLowerCase("zh-TW")
  );
}

function resolveKnownArtist(value, knownArtists, parentDirectory) {
  const key = compactIdentityText(value);
  const parentKey = compactIdentityText(parentDirectory);

  if (knownArtists.has(key)) return knownArtists.get(key);
  if (parentKey && (key === parentKey || key.startsWith(parentKey))) {
    return parentDirectory;
  }
  return null;
}

export function parseAudioFilename(filename, options = {}) {
  const extension = path.extname(filename);
  const basename = normalizeParserText(
    path.basename(filename, extension)
  );
  const parentDirectory =
    typeof options.parentDirectory === "string" &&
    !isGenericDirectory(options.parentDirectory)
      ? options.parentDirectory.trim()
      : null;
  const knownArtists = normalizeArtistSet(options.knownArtists);
  const doubleUnderscoreParts = basename
    .split("__")
    .map((part) => part.trim());

  if (
    doubleUnderscoreParts.length === 3 &&
    /^M\d{6}$/i.test(doubleUnderscoreParts[0]) &&
    doubleUnderscoreParts.every(Boolean)
  ) {
    return parseResult({
      parsedId: doubleUnderscoreParts[0].toUpperCase(),
      parsedSongName: doubleUnderscoreParts[1],
      parsedArtist: doubleUnderscoreParts[2],
      parseMethod: "ID_DOUBLE_UNDERSCORE",
      confidence: 1,
      reliable: true,
      reasons: ["EXPLICIT_ID_TITLE_ARTIST_FIELDS"]
    });
  }

  if (
    doubleUnderscoreParts.length === 2 &&
    doubleUnderscoreParts.every(Boolean)
  ) {
    return parseResult({
      parsedId: null,
      parsedSongName: doubleUnderscoreParts[0],
      parsedArtist: doubleUnderscoreParts[1],
      parseMethod: "DOUBLE_UNDERSCORE",
      confidence: 1,
      reliable: true,
      reasons: ["EXPLICIT_TITLE_ARTIST_FIELDS"]
    });
  }

  const mvWrapper = basename.match(/^MV_([^《]+)《([^》]+)》$/u);
  if (mvWrapper && mvWrapper[1].trim() && mvWrapper[2].trim()) {
    return parseResult({
      parsedSongName: mvWrapper[2].trim(),
      parsedArtist: mvWrapper[1].trim(),
      parseMethod: "MV_ARTIST_BRACKET_TITLE",
      confidence: 1,
      reliable: true,
      reasons: ["EXPLICIT_MV_ARTIST_TITLE_WRAPPER"]
    });
  }

  const malformedBracket = !basename.includes("]")
    ? basename.match(/^([^[]+)\[([^[]+)$/u)
    : null;
  if (malformedBracket) {
    const leftArtist = resolveKnownArtist(
      malformedBracket[1].trim(),
      knownArtists,
      parentDirectory
    );

    if (leftArtist) {
      return parseResult({
        parsedSongName: malformedBracket[2].trim(),
        parsedArtist: leftArtist,
        parseMethod: "MALFORMED_BRACKET_ARTIST_TITLE",
        confidence: 0.96,
        reliable: true,
        reasons: [
          "SINGLE_OPEN_BRACKET_SEPARATOR",
          "ARTIST_CONFIRMED_BY_CONTEXT"
        ]
      });
    }
  }

  const underscoreCount = (basename.match(/_/g) || []).length;
  if (underscoreCount === 1) {
    const [left, right] = basename.split("_").map((part) => part.trim());
    const leftArtist = resolveKnownArtist(
      left,
      knownArtists,
      parentDirectory
    );

    if (left && right && leftArtist) {
      const cleaned = cleanReleaseSuffix(right);
      return parseResult({
        parsedSongName: cleaned.cleanedTitle,
        parsedArtist: leftArtist,
        parseMethod: "ARTIST_SINGLE_UNDERSCORE_TITLE",
        confidence: 0.96,
        reliable: true,
        reasons: ["SINGLE_UNDERSCORE", "ARTIST_CONFIRMED_BY_CONTEXT"],
        notes: cleaned.notes
      });
    }
  }

  if (underscoreCount > 1) {
    const candidateTokens = basename
      .split("_")
      .map((part) => part.trim())
      .filter(Boolean);
    return parseResult({
      parsedArtist: resolveKnownArtist(
        candidateTokens[0],
        knownArtists,
        parentDirectory
      ),
      parseMethod: "MULTI_UNDERSCORE_REVIEW",
      confidence: 0.45,
      reliable: false,
      reasons: ["MULTI_UNDERSCORE_AMBIGUOUS_TITLE_POSITION"],
      candidateTokens,
      requiresReview: true
    });
  }

  const dashMatch = basename.match(/^(.*?)\s*([-–—－])\s*(.+)$/u);
  if (dashMatch) {
    const left = dashMatch[1].trim();
    const right = dashMatch[3].trim();
    const leftArtist = resolveKnownArtist(
      left,
      knownArtists,
      parentDirectory
    );
    const separatorIndex = basename.indexOf(dashMatch[2]);
    const hasLeftSpace = /\s/u.test(basename[separatorIndex - 1] || "");
    const hasRightSpace = /\s/u.test(basename[separatorIndex + 1] || "");
    const fullySpaced = hasLeftSpace && hasRightSpace;
    const parsedSongName = right;
    const parsedArtist = leftArtist || left;
    const parseMethod = fullySpaced
      ? "ARTIST_SPACED_DASH_TITLE"
      : hasLeftSpace || hasRightSpace
        ? "ARTIST_ONE_SIDED_DASH_TITLE"
        : "ARTIST_COMPACT_DASH_TITLE";
    const reason = leftArtist
      ? "ARTIST_CONFIRMED_BY_CONTEXT"
      : "DETERMINISTIC_LEFT_ARTIST_RIGHT_TITLE";

    if (parsedSongName && parsedArtist) {
      const cleaned = cleanReleaseSuffix(parsedSongName);
      return parseResult({
        parsedSongName: cleaned.cleanedTitle,
        parsedArtist,
        parseMethod,
        confidence: leftArtist ? 0.98 : 0.9,
        reliable: true,
        reasons: [
          reason,
          "DASH_SIDES_NON_EMPTY",
          "DASH_ORIENTATION_LEFT_ARTIST_RIGHT_TITLE"
        ],
        notes: cleaned.notes
      });
    }
  }

  if (parentDirectory) {
    const cleaned = cleanReleaseSuffix(basename);
    return parseResult({
      parsedSongName: cleaned.cleanedTitle,
      parsedArtist: parentDirectory,
      parseMethod: "ARTIST_DIRECTORY_TITLE_FILENAME",
      confidence: 0.94,
      reliable: true,
      reasons: ["RELIABLE_ARTIST_DIRECTORY", "TITLE_ONLY_FILENAME"],
      notes: cleaned.notes
    });
  }

  return parseResult({
    parsedSongName: basename || null,
    parseMethod: basename ? "TITLE_ONLY" : "UNPARSED",
    confidence: basename ? 0.55 : 0,
    reliable: false,
    reasons: [basename ? "ARTIST_MISSING" : "FILENAME_UNPARSED"]
  });
}

export function cleanEmbeddedAudioMetadata(metadata = {}) {
  const rawTitle =
    typeof metadata.title === "string" ? metadata.title.trim() : null;
  const rawArtist =
    typeof metadata.artist === "string" ? metadata.artist.trim() : null;
  const result = {
    raw: {
      title: rawTitle,
      artist: rawArtist,
      album:
        typeof metadata.album === "string" ? metadata.album.trim() : null,
      trackNumber:
        typeof metadata.trackNumber === "string"
          ? metadata.trackNumber.trim()
          : null,
      year:
        typeof metadata.year === "string" ? metadata.year.trim() : null
    },
    cleanedTitle: rawTitle,
    cleanedArtist: rawArtist,
    parseMethod: "EMBEDDED_METADATA",
    confidence: rawTitle && rawArtist ? 1 : 0,
    reliable: Boolean(rawTitle && rawArtist),
    reasons: [],
    notes: []
  };

  if (!rawTitle || !rawArtist) {
    result.reasons.push("EMBEDDED_TITLE_OR_ARTIST_MISSING");
    return result;
  }

  const separatedTitle = rawTitle.match(/^(.*?)\s*[-–—－_]\s*(.+)$/u);
  if (
    separatedTitle &&
    compactIdentityText(separatedTitle[1]) === compactIdentityText(rawArtist)
  ) {
    result.cleanedTitle = separatedTitle[2].trim();
    result.parseMethod = "EMBEDDED_METADATA_ARTIST_PREFIX";
    result.reasons.push("REMOVED_EXACT_ARTIST_PREFIX");
  } else {
    const normalizedTitle = normalizeParserText(rawTitle);
    const normalizedArtist = normalizeParserText(rawArtist);
    if (
      normalizedTitle.startsWith(`${normalizedArtist} `) &&
      normalizedTitle.length > normalizedArtist.length + 1
    ) {
      result.cleanedTitle = normalizedTitle
        .slice(normalizedArtist.length + 1)
        .trim();
      result.parseMethod = "EMBEDDED_METADATA_ARTIST_PREFIX";
      result.reasons.push("REMOVED_EXACT_ARTIST_PREFIX");
    }
  }

  const cleaned = cleanReleaseSuffix(result.cleanedTitle);
  result.cleanedTitle = cleaned.cleanedTitle;
  result.notes.push(...cleaned.notes);

  if (!result.cleanedTitle) {
    result.reliable = false;
    result.confidence = 0;
    result.reasons.push("CLEANED_TITLE_EMPTY");
  } else if (result.reasons.length === 0) {
    result.reasons.push("EMBEDDED_TITLE_ARTIST_COMPLETE");
  }

  return result;
}

function readEmbeddedAudioMetadata(filePath) {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:format_tags=title,artist,album,track,date,year",
      "-of",
      "json",
      filePath
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024
    }
  );

  if (result.error || result.status !== 0) {
    return {
      readable: false,
      durationSeconds: null,
      metadata: cleanEmbeddedAudioMetadata(),
      error: result.error?.code || "FFPROBE_UNREADABLE"
    };
  }

  try {
    const output = JSON.parse(result.stdout);
    const tags = Object.fromEntries(
      Object.entries(output?.format?.tags || {}).map(([key, value]) => [
        key.toLocaleLowerCase("en-US"),
        value
      ])
    );
    const duration = Number(output?.format?.duration);
    return {
      readable: true,
      durationSeconds: Number.isFinite(duration)
        ? Number(duration.toFixed(3))
        : null,
      metadata: cleanEmbeddedAudioMetadata({
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        trackNumber: tags.track,
        year: tags.year || tags.date
      }),
      error: null
    };
  } catch {
    return {
      readable: false,
      durationSeconds: null,
      metadata: cleanEmbeddedAudioMetadata(),
      error: "FFPROBE_OUTPUT_INVALID"
    };
  }
}

function hashAudioFile(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = new Uint8Array(128 * 1024);

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

function sourceSnapshot(audioRoot) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const stats = fs.statSync(absolutePath);
        files.push({
          relativePath: toPortablePath(path.relative(audioRoot, absolutePath)),
          sizeBytes: stats.size
        });
      }
    }
  }

  visit(audioRoot);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-TW")
  );
}

function snapshotSha256(snapshot) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex");
}

function collectArtistContext(audioRoot, songs) {
  const artists = new Set(songs.map((song) => song.artist));

  for (const entry of fs.readdirSync(audioRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !isGenericDirectory(entry.name)) {
      artists.add(entry.name);
    }
  }

  return artists;
}

function normalizeComparisonText(value) {
  return normalizeParserText(value)
    .toLocaleLowerCase("zh-TW")
    .replace(/[()[\]{}<>〈〉《》「」『』【】]/gu, "")
    .replace(/[\s.．・/／_-]+/gu, "");
}

function compareMetadataAndFilename(filenameParsed, metadata) {
  if (
    !metadata?.reliable ||
    !metadata.cleanedTitle ||
    !metadata.cleanedArtist ||
    !filenameParsed?.parsedSongName ||
    !filenameParsed?.parsedArtist
  ) {
    return {
      status: "NOT_COMPARABLE",
      titleConsistent: null,
      artistConsistent: null,
      reasons: ["COMPLETE_METADATA_AND_FILENAME_REQUIRED"]
    };
  }

  const titleConsistent =
    normalizeComparisonText(metadata.cleanedTitle) ===
    normalizeComparisonText(filenameParsed.parsedSongName);
  const artistConsistent =
    normalizeComparisonText(metadata.cleanedArtist) ===
    normalizeComparisonText(filenameParsed.parsedArtist);
  let status = "CONSISTENT";

  if (!titleConsistent && !artistConsistent) {
    status = "BOTH_CONFLICT";
  } else if (!titleConsistent) {
    status = "TITLE_CONFLICT";
  } else if (!artistConsistent) {
    status = "ARTIST_CONFLICT";
  }

  return {
    status,
    titleConsistent,
    artistConsistent,
    metadata: {
      title: metadata.cleanedTitle,
      artist: metadata.cleanedArtist
    },
    filename: {
      title: filenameParsed.parsedSongName,
      artist: filenameParsed.parsedArtist
    },
    reasons:
      status === "CONSISTENT"
        ? ["METADATA_FILENAME_CONSISTENT"]
        : [`METADATA_FILENAME_${status}`]
  };
}

function parentDirectoryForAsset(asset) {
  const directory = path.posix.dirname(asset.relativePath);
  return directory === "." ? null : path.posix.basename(directory);
}

function directoryEvidenceForAssets(assets) {
  const groups = new Map();

  for (const asset of assets) {
    const parentDirectory = parentDirectoryForAsset(asset);
    if (!parentDirectory || isGenericDirectory(parentDirectory)) continue;
    const group = groups.get(parentDirectory) || [];
    group.push(asset);
    groups.set(parentDirectory, group);
  }

  const evidenceByDirectory = new Map();

  for (const [parentDirectory, group] of groups) {
    const directoryKey = normalizeComparisonText(parentDirectory);
    const supportingRelativePaths = [];
    const conflictingRelativePaths = [];

    for (const asset of group) {
      const explicitFilenameArtist =
        asset.filenameParsed?.method !==
          "ARTIST_DIRECTORY_TITLE_FILENAME" &&
        asset.filenameParsed?.reliable &&
        asset.filenameParsed?.artist
          ? asset.filenameParsed.artist
          : null;
      const metadataArtist = asset.metadata?.reliable
        ? asset.metadata.cleanedArtist
        : null;

      for (const artist of [explicitFilenameArtist, metadataArtist]) {
        if (!artist) continue;
        if (normalizeComparisonText(artist) === directoryKey) {
          supportingRelativePaths.push(asset.relativePath);
        } else {
          conflictingRelativePaths.push(asset.relativePath);
        }
      }
    }

    const uniqueSupport = [...new Set(supportingRelativePaths)].sort();
    const uniqueConflicts = [...new Set(conflictingRelativePaths)].sort();
    let status = "DIRECTORY_ARTIST_UNVERIFIED";

    if (uniqueConflicts.length > 0) {
      status = "DIRECTORY_ARTIST_CONFLICT";
    } else if (group.length > 1 && uniqueSupport.length > 0) {
      status = "DIRECTORY_ARTIST_CONFIRMED";
    }

    evidenceByDirectory.set(parentDirectory, {
      status,
      parentDirectory,
      siblingAudioCount: group.length,
      supportingRelativePaths: uniqueSupport,
      conflictingRelativePaths: uniqueConflicts,
      reasons:
        status === "DIRECTORY_ARTIST_CONFIRMED"
          ? ["MULTIPLE_SIBLING_FILES", "ARTIST_CROSS_VALIDATED"]
          : status === "DIRECTORY_ARTIST_CONFLICT"
            ? ["SIBLING_ARTIST_CONFLICT"]
            : ["INSUFFICIENT_DIRECTORY_ARTIST_EVIDENCE"]
    });
  }

  return evidenceByDirectory;
}

function applyIdentityQualityChecks(assets) {
  const directoryEvidence = directoryEvidenceForAssets(assets);

  return assets.map((asset) => {
    const parentDirectory = parentDirectoryForAsset(asset);
    const directoryArtistValidation =
      asset.filenameParsed?.method ===
      "ARTIST_DIRECTORY_TITLE_FILENAME"
        ? directoryEvidence.get(parentDirectory) || {
            status: "DIRECTORY_ARTIST_UNVERIFIED",
            parentDirectory,
            siblingAudioCount: 1,
            supportingRelativePaths: [],
            conflictingRelativePaths: [],
            reasons: ["INSUFFICIENT_DIRECTORY_ARTIST_EVIDENCE"]
          }
        : null;
    let filenameParsed = asset.filenameParsed;

    if (
      directoryArtistValidation &&
      directoryArtistValidation.status !==
        "DIRECTORY_ARTIST_CONFIRMED"
    ) {
      filenameParsed = {
        ...filenameParsed,
        reliable: false,
        confidence: Math.min(filenameParsed.confidence, 0.6),
        requiresReview: true,
        reasons: [
          ...filenameParsed.reasons,
          ...directoryArtistValidation.reasons,
          directoryArtistValidation.status
        ]
      };
    } else if (directoryArtistValidation) {
      filenameParsed = {
        ...filenameParsed,
        reasons: [
          ...filenameParsed.reasons,
          ...directoryArtistValidation.reasons,
          directoryArtistValidation.status
        ]
      };
    }

    const metadataFilenameComparison = compareMetadataAndFilename(
      {
        parsedSongName: filenameParsed.songName,
        parsedArtist: filenameParsed.artist
      },
      asset.metadata
    );
    const parsedIdentity = effectiveParsedIdentity(
      filenameParsed,
      asset.metadata,
      metadataFilenameComparison
    );

    return {
      ...asset,
      directoryArtistValidation,
      metadataFilenameComparison,
      filenameParsed,
      parsed: {
        id: parsedIdentity.parsedId,
        songName: parsedIdentity.parsedSongName,
        artist: parsedIdentity.parsedArtist,
        method: parsedIdentity.parseMethod,
        confidence: parsedIdentity.confidence,
        reliable: parsedIdentity.reliable,
        reasons: parsedIdentity.reasons,
        notes: parsedIdentity.notes,
        candidateTokens: parsedIdentity.candidateTokens,
        requiresReview: parsedIdentity.requiresReview
      }
    };
  });
}

function effectiveParsedIdentity(
  filenameParsed,
  metadata,
  metadataFilenameComparison
) {
  if (
    metadataFilenameComparison &&
    [
      "TITLE_CONFLICT",
      "ARTIST_CONFLICT",
      "BOTH_CONFLICT"
    ].includes(metadataFilenameComparison.status)
  ) {
    return parseResult({
      parsedSongName: metadata.cleanedTitle,
      parsedArtist: metadata.cleanedArtist,
      parseMethod: metadata.parseMethod,
      confidence: 0,
      reliable: false,
      reasons: metadataFilenameComparison.reasons,
      notes: metadata.notes,
      requiresReview: true
    });
  }

  if (metadata?.reliable) {
    return parseResult({
      parsedSongName: metadata.cleanedTitle,
      parsedArtist: metadata.cleanedArtist,
      parseMethod: metadata.parseMethod,
      confidence: metadata.confidence,
      reliable: true,
      reasons: metadata.reasons,
      notes: metadata.notes
    });
  }

  return parseResult({
    parsedId: filenameParsed.id,
    parsedSongName: filenameParsed.songName,
    parsedArtist: filenameParsed.artist,
    parseMethod: filenameParsed.method,
    confidence: filenameParsed.confidence,
    reliable: filenameParsed.reliable,
    reasons: filenameParsed.reasons,
    notes: filenameParsed.notes,
    candidateTokens: filenameParsed.candidateTokens,
    requiresReview: filenameParsed.requiresReview
  });
}

function scanDirectory(audioRoot, options = {}) {
  const assets = [];
  let totalFiles = 0;
  const knownArtists = options.knownArtists || new Set();

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
      const relativeDirectory = path.dirname(relativePath);
      const parentDirectory =
        relativeDirectory === "."
          ? null
          : path.basename(relativeDirectory);
      const parsedFilename = parseAudioFilename(entry.name, {
        parentDirectory,
        knownArtists
      });
      const probe = options.includeEmbeddedMetadata
        ? readEmbeddedAudioMetadata(absolutePath)
        : {
            readable: null,
            durationSeconds: null,
            metadata: null,
            error: null
          };
      const sha256 =
        options.includeIntegrity && stats.size > 0
          ? hashAudioFile(absolutePath)
          : null;

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
        durationSeconds: probe.durationSeconds,
        readable: probe.readable,
        sha256,
        metadata: probe.metadata
          ? {
              ...probe.metadata,
              error: probe.error
            }
          : null,
        filenameParsed: {
          id: parsedFilename.parsedId,
          songName: parsedFilename.parsedSongName,
          artist: parsedFilename.parsedArtist,
          method: parsedFilename.parseMethod,
          confidence: parsedFilename.confidence,
          reliable: parsedFilename.reliable,
          reasons: parsedFilename.reasons,
          notes: parsedFilename.notes,
          candidateTokens: parsedFilename.candidateTokens,
          requiresReview: parsedFilename.requiresReview
        },
        parsed: {
          id: parsedFilename.parsedId,
          songName: parsedFilename.parsedSongName,
          artist: parsedFilename.parsedArtist,
          method: parsedFilename.parseMethod,
          confidence: parsedFilename.confidence,
          reliable: parsedFilename.reliable,
          reasons: parsedFilename.reasons,
          notes: parsedFilename.notes,
          candidateTokens: parsedFilename.candidateTokens,
          requiresReview: parsedFilename.requiresReview
        }
      });
    }
  }

  visit(audioRoot);

  assets.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, "zh-TW")
  );

  return {
    assets: applyIdentityQualityChecks(assets),
    totalFiles
  };
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
    matchedSongName: normalizeParserText(parsed.songName),
    matchedArtist: normalizeParserText(parsed.artist)
  };
}

function scoreSong(parsed, song) {
  return scoreTrackMatch(
    {
      songName: normalizeParserText(song.songName),
      artist: normalizeParserText(song.artist)
    },
    parsedCandidate(parsed)
  );
}

function exactMetadataSongs(parsed, songs) {
  const songName = normalizeMatchText(
    normalizeParserText(parsed.songName)
  );
  const artist = normalizeMatchText(
    normalizeParserText(parsed.artist)
  );

  return songs.filter(
    (song) =>
      normalizeMatchText(normalizeParserText(song.songName)) ===
        songName &&
      normalizeMatchText(normalizeParserText(song.artist)) === artist
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

  if (parsed.requiresReview) {
    return matchResult(
      AUDIO_ASSET_STATUSES.REVIEW_REQUIRED,
      null,
      null,
      [...parsed.reasons, "PARSER_REVIEW_REQUIRED"]
    );
  }

  if (!parsed.reliable || !parsed.songName || !parsed.artist) {
    return matchResult(
      AUDIO_ASSET_STATUSES.UNPARSED,
      null,
      null,
      parsed.reasons.length > 0
        ? parsed.reasons
        : ["FILENAME_UNPARSED"]
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

function classifyIdentity(asset, match) {
  const { parsed } = asset;

  if (parsed.requiresReview || match.status === AUDIO_ASSET_STATUSES.REVIEW_REQUIRED) {
    return {
      status: "REVIEW_REQUIRED",
      source: parsed.method.startsWith("EMBEDDED_")
        ? "EMBEDDED_METADATA"
        : "FILENAME",
      reasons: [...parsed.reasons, ...match.reasons]
    };
  }

  if (parsed.reliable && parsed.songName && parsed.artist) {
    return {
      status:
        match.status === AUDIO_ASSET_STATUSES.AUTO_MATCH
          ? "AUTO_MATCH_EXISTING_LIBRARY"
          : "IDENTIFIED_NOT_IN_LIBRARY",
      source: parsed.method.startsWith("EMBEDDED_")
        ? "EMBEDDED_METADATA"
        : "FILENAME",
      reasons: [...parsed.reasons, ...match.reasons]
    };
  }

  if (parsed.songName && !parsed.artist) {
    return {
      status: "TITLE_ONLY",
      source: "FILENAME",
      reasons: parsed.reasons
    };
  }

  if (!parsed.songName && parsed.artist) {
    return {
      status: "ARTIST_ONLY",
      source: "FILENAME",
      reasons: parsed.reasons
    };
  }

  return {
    status: "UNKNOWN_AUDIO",
    source: null,
    reasons: parsed.reasons
  };
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
  markDuplicateGroups(
    (asset) => asset.sha256,
    "DUPLICATE_SHA256"
  );

  return reasonsByAssetId;
}

function canonicalDuplicateCandidates(assets) {
  const groups = new Map();
  const canonicalByAssetId = new Map();

  for (const asset of assets) {
    if (!asset.sha256) continue;
    const group = groups.get(asset.sha256) || [];
    group.push(asset);
    groups.set(asset.sha256, group);
  }

  for (const [sha256, group] of groups) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((left, right) => {
      const metadataScore = (asset) =>
        Number(Boolean(asset.metadata?.raw?.title)) +
        Number(Boolean(asset.metadata?.raw?.artist));
      const metadataDifference =
        metadataScore(right) - metadataScore(left);
      if (metadataDifference !== 0) return metadataDifference;

      const parserDifference =
        Number(Boolean(right.parsed.reliable)) -
        Number(Boolean(left.parsed.reliable));
      if (parserDifference !== 0) return parserDifference;

      return left.relativePath.localeCompare(
        right.relativePath,
        "zh-TW"
      );
    });
    const canonical = sorted[0];

    for (const asset of group) {
      canonicalByAssetId.set(asset.assetId, {
        sha256,
        groupSize: group.length,
        canonicalAssetId: canonical.assetId,
        canonicalRelativePath: canonical.relativePath,
        isCanonical: asset.assetId === canonical.assetId
      });
    }
  }

  return canonicalByAssetId;
}

function applyDuplicateStatuses(assets) {
  const reasonsByAssetId = duplicateReasons(assets);
  const canonicalByAssetId = canonicalDuplicateCandidates(assets);

  return assets.map((asset) => {
    const duplicateReasonSet = reasonsByAssetId.get(asset.assetId);
    const duplicate = canonicalByAssetId.get(asset.assetId) || null;

    if (!duplicateReasonSet) {
      return { ...asset, duplicate };
    }

    return {
      ...asset,
      duplicate,
      match: {
        ...asset.match,
        baseStatus: asset.match.status,
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
  const identityCount = (status, source = null) =>
    assets.filter(
      (asset) =>
        asset.identity.status === status &&
        (!source || asset.identity.source === source)
    ).length;
  const shaGroups = new Set(
    assets
      .filter((asset) => asset.duplicate?.sha256)
      .map((asset) => asset.duplicate.sha256)
  );
  const uniqueAssets = assets.filter(
    (asset) => !asset.duplicate || asset.duplicate.isCanonical
  );
  const uniqueIdentityCount = (status, source = null) =>
    uniqueAssets.filter(
      (asset) =>
        asset.identity.status === status &&
        (!source || asset.identity.source === source)
    ).length;
  const parseMethods = {};
  const directoryValidationCounts = {
    DIRECTORY_ARTIST_CONFIRMED: 0,
    DIRECTORY_ARTIST_UNVERIFIED: 0,
    DIRECTORY_ARTIST_CONFLICT: 0
  };
  const metadataFilenameConflictCounts = {
    TITLE_CONFLICT: 0,
    ARTIST_CONFLICT: 0,
    BOTH_CONFLICT: 0
  };

  for (const asset of assets) {
    parseMethods[asset.parsed.method] =
      (parseMethods[asset.parsed.method] || 0) + 1;
    const directoryStatus = asset.directoryArtistValidation?.status;
    const comparisonStatus = asset.metadataFilenameComparison?.status;

    if (directoryValidationCounts[directoryStatus] !== undefined) {
      directoryValidationCounts[directoryStatus] += 1;
    }
    if (metadataFilenameConflictCounts[comparisonStatus] !== undefined) {
      metadataFilenameConflictCounts[comparisonStatus] += 1;
    }
  }

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
    ),
    uniqueAudioFiles: uniqueAssets.length,
    metadataTitleArtistUsable: identityCount(
      "IDENTIFIED_NOT_IN_LIBRARY",
      "EMBEDDED_METADATA"
    ) + identityCount("AUTO_MATCH_EXISTING_LIBRARY", "EMBEDDED_METADATA"),
    filenameTitleArtistReliable: identityCount(
      "IDENTIFIED_NOT_IN_LIBRARY",
      "FILENAME"
    ) + identityCount("AUTO_MATCH_EXISTING_LIBRARY", "FILENAME"),
    identifiedNotInLibrary: identityCount("IDENTIFIED_NOT_IN_LIBRARY"),
    autoMatchExistingLibrary: identityCount(
      "AUTO_MATCH_EXISTING_LIBRARY"
    ),
    identityReviewRequired: identityCount("REVIEW_REQUIRED"),
    titleOnly: identityCount("TITLE_ONLY"),
    artistOnly: identityCount("ARTIST_ONLY"),
    unknownAudio: identityCount("UNKNOWN_AUDIO"),
    unreadableFiles: assets.filter(
      (asset) => asset.readable === false
    ).length,
    duplicateSha256Groups: shaGroups.size,
    duplicateSha256Files: assets.filter(
      (asset) => asset.duplicate?.sha256
    ).length,
    directoryArtistValidation: directoryValidationCounts,
    metadataFilenameConflicts: {
      ...metadataFilenameConflictCounts,
      total: Object.values(metadataFilenameConflictCounts).reduce(
        (total, countValue) => total + countValue,
        0
      )
    },
    parseMethods: Object.fromEntries(
      Object.entries(parseMethods).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    uniqueCandidates: {
      total: uniqueAssets.length,
      reliableTitleArtist: uniqueIdentityCount(
        "IDENTIFIED_NOT_IN_LIBRARY"
      ) + uniqueIdentityCount("AUTO_MATCH_EXISTING_LIBRARY"),
      metadataTitleArtistUsable:
        uniqueIdentityCount(
          "IDENTIFIED_NOT_IN_LIBRARY",
          "EMBEDDED_METADATA"
        ) +
        uniqueIdentityCount(
          "AUTO_MATCH_EXISTING_LIBRARY",
          "EMBEDDED_METADATA"
        ),
      filenameTitleArtistReliable:
        uniqueIdentityCount(
          "IDENTIFIED_NOT_IN_LIBRARY",
          "FILENAME"
        ) +
        uniqueIdentityCount(
          "AUTO_MATCH_EXISTING_LIBRARY",
          "FILENAME"
        ),
      identifiedNotInLibrary: uniqueIdentityCount(
        "IDENTIFIED_NOT_IN_LIBRARY"
      ),
      autoMatchExistingLibrary: uniqueIdentityCount(
        "AUTO_MATCH_EXISTING_LIBRARY"
      ),
      reviewRequired: uniqueIdentityCount("REVIEW_REQUIRED"),
      titleOnly: uniqueIdentityCount("TITLE_ONLY"),
      artistOnly: uniqueIdentityCount("ARTIST_ONLY"),
      unknownAudio: uniqueIdentityCount("UNKNOWN_AUDIO")
    }
  };
}

export function buildAudioAssetManifest({
  audioRoot,
  libraryFile = DEFAULT_LIBRARY_FILE,
  includeEmbeddedMetadata = false,
  includeIntegrity = includeEmbeddedMetadata
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
  const beforeSnapshot = sourceSnapshot(resolvedAudioRoot);
  const knownArtists = collectArtistContext(resolvedAudioRoot, songs);
  const scan = scanDirectory(resolvedAudioRoot, {
    knownArtists,
    includeEmbeddedMetadata,
    includeIntegrity
  });
  const matchedAssets = scan.assets.map((asset) => {
    const match = matchAsset(asset, songs, songsById);
    return {
      ...asset,
      match,
      identity: classifyIdentity(asset, match)
    };
  });
  const assets = applyDuplicateStatuses(matchedAssets);
  const afterSnapshot = sourceSnapshot(resolvedAudioRoot);
  const beforeSnapshotSha256 = snapshotSha256(beforeSnapshot);
  const afterSnapshotSha256 = snapshotSha256(afterSnapshot);

  if (beforeSnapshotSha256 !== afterSnapshotSha256) {
    throw new Error("音訊資料夾在掃描期間發生變更。");
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    audioRoot: resolvedAudioRoot,
    songLibrary: path.resolve(libraryFile),
    options: {
      includeEmbeddedMetadata,
      includeIntegrity
    },
    safety: {
      beforeFileCount: beforeSnapshot.length,
      afterFileCount: afterSnapshot.length,
      beforeSnapshotSha256,
      afterSnapshotSha256,
      sourceUnchanged: true
    },
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
  console.log(`Unique audio：${summary.uniqueAudioFiles}`);
  console.log(
    `已辨識但不在題庫：${summary.identifiedNotInLibrary}`
  );

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

function runParserRegressionTest() {
  const knownArtists = new Set([
    "五月天",
    "王心凌",
    "田馥甄",
    "F. I. R.",
    "蘇打綠",
    "陳綺貞",
    "張惠妹",
    "周蕙"
  ]);
  const parse = (filename, parentDirectory = null) =>
    parseAudioFilename(filename, {
      parentDirectory,
      knownArtists
    });
  const cases = [
    {
      filename: "M000001__月亮代表我的心__鄧麗君.mp3",
      title: "月亮代表我的心",
      artist: "鄧麗君",
      method: "ID_DOUBLE_UNDERSCORE"
    },
    {
      filename: "童年__羅大佑.m4a",
      title: "童年",
      artist: "羅大佑",
      method: "DOUBLE_UNDERSCORE"
    },
    {
      filename: "張惠妹 - 姐妹.aac",
      title: "姐妹",
      artist: "張惠妹",
      method: "ARTIST_SPACED_DASH_TITLE"
    },
    {
      filename: "五月天-星空.mp3",
      title: "星空",
      artist: "五月天"
    },
    {
      filename: "王心凌-當你.mp3",
      title: "當你",
      artist: "王心凌"
    },
    {
      filename: "田馥甄-寂寞寂寞就好.mp3",
      title: "寂寞寂寞就好",
      artist: "田馥甄"
    },
    {
      filename: "F. I. R. -我們的愛.mp3",
      title: "我們的愛",
      artist: "F. I. R."
    },
    {
      filename: "周蕙 - 約定.mp3",
      title: "約定",
      artist: "周蕙",
      method: "ARTIST_SPACED_DASH_TITLE"
    },
    {
      filename: "蘇打綠 -無眠.mp3",
      title: "無眠",
      artist: "蘇打綠"
    },
    {
      filename: "陳綺貞_旅行的意義.mp3",
      parentDirectory: "陳綺貞",
      title: "旅行的意義",
      artist: "陳綺貞"
    },
    {
      filename: "知足.mp3",
      parentDirectory: "五月天",
      title: "知足",
      artist: "五月天",
      method: "ARTIST_DIRECTORY_TITLE_FILENAME"
    },
    {
      filename: "五月天-瘋狂世界 (官方完整版MV).mp3",
      title: "瘋狂世界",
      artist: "五月天"
    },
    {
      filename: "MV_陳綺貞《魚》.mp3",
      title: "魚",
      artist: "陳綺貞",
      method: "MV_ARTIST_BRACKET_TITLE"
    },
    {
      filename: "五月天[傷心的人別聽慢歌.mp3",
      parentDirectory: "五月天",
      title: "傷心的人別聽慢歌",
      artist: "五月天",
      method: "MALFORMED_BRACKET_ARTIST_TITLE"
    }
  ];
  const failures = cases.filter((testCase) => {
    const result = parse(
      testCase.filename,
      testCase.parentDirectory
    );
    return (
      result.parsedSongName !== testCase.title ||
      result.parsedArtist !== testCase.artist ||
      result.reliable !== true ||
      (testCase.method && result.parseMethod !== testCase.method)
    );
  });
  const multiUnderscore = parse(
    "五月天_五月之戀原聲帶_而我知道_冰融演奏版.wmv.mp3",
    "五月天"
  );
  const metadataDash = cleanEmbeddedAudioMetadata({
    title: "五月天-星空",
    artist: "五月天",
    album: "測試專輯"
  });
  const metadataUnderscore = cleanEmbeddedAudioMetadata({
    title: "五月天_星空",
    artist: "五月天"
  });
  const metadataSpace = cleanEmbeddedAudioMetadata({
    title: "五月天 星空",
    artist: "五月天"
  });
  const metadataConflict = compareMetadataAndFilename(
    {
      parsedSongName: "檔名歌名",
      parsedArtist: "相同歌手"
    },
    cleanEmbeddedAudioMetadata({
      title: "Metadata 歌名",
      artist: "相同歌手"
    })
  );
  const passed =
    failures.length === 0 &&
    multiUnderscore.reliable === false &&
    multiUnderscore.requiresReview === true &&
    multiUnderscore.parseMethod === "MULTI_UNDERSCORE_REVIEW" &&
    metadataDash.cleanedTitle === "星空" &&
    metadataDash.raw.title === "五月天-星空" &&
    metadataUnderscore.cleanedTitle === "星空" &&
    metadataSpace.cleanedTitle === "星空" &&
    metadataConflict.status === "TITLE_CONFLICT";

  return {
    passed,
    cases: cases.length + 4,
    failures: failures.map((testCase) => testCase.filename),
    multiUnderscoreReviewRequired:
      multiUnderscore.requiresReview === true,
    metadataCleanupPassed:
      metadataDash.cleanedTitle === "星空" &&
      metadataUnderscore.cleanedTitle === "星空" &&
      metadataSpace.cleanedTitle === "星空",
    metadataConflictPassed:
      metadataConflict.status === "TITLE_CONFLICT"
  };
}

function runDirectoryArtistRegressionTest(libraryFile) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-directory-artist-")
  );

  try {
    [
      "歌手甲/歌手甲-歌名甲.mp3",
      "歌手甲/歌名乙.mp3",
      "歌手乙/歌名丙.mp3",
      "歌手丙/歌手丙-歌名丁.mp3",
      "歌手丙/其他歌手-歌名戊.mp3",
      "歌手丙/歌名己.mp3"
    ].forEach((filename) => createEmptyFile(tempRoot, filename));

    const manifest = buildAudioAssetManifest({
      audioRoot: tempRoot,
      libraryFile
    });
    const find = (relativePath) =>
      manifest.assets.find(
        (asset) => asset.relativePath === relativePath
      );
    const confirmed = find("歌手甲/歌名乙.mp3");
    const unverified = find("歌手乙/歌名丙.mp3");
    const conflict = find("歌手丙/歌名己.mp3");
    const passed =
      confirmed?.directoryArtistValidation?.status ===
        "DIRECTORY_ARTIST_CONFIRMED" &&
      confirmed?.parsed?.reliable === true &&
      unverified?.directoryArtistValidation?.status ===
        "DIRECTORY_ARTIST_UNVERIFIED" &&
      unverified?.parsed?.requiresReview === true &&
      conflict?.directoryArtistValidation?.status ===
        "DIRECTORY_ARTIST_CONFLICT" &&
      conflict?.parsed?.requiresReview === true;

    return {
      passed,
      confirmed: confirmed?.directoryArtistValidation?.status || null,
      unverified: unverified?.directoryArtistValidation?.status || null,
      conflict: conflict?.directoryArtistValidation?.status || null
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runFixtureTest(libraryFile, outputFile) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "gsk-audio-fixture-")
  );

  try {
    [
      "M000001__月亮代表我的心__鄧麗君.mp3",
      "童年__羅大佑.m4a",
      "張惠妹 - 姐妹.aac",
      "M000033__江南__錯誤歌手.wav",
      "不存在歌曲__未知歌手.ogg",
      "badfilename.mp3",
      "1980/羅大佑 - 童年.MP3",
      "1990/張惠妹 - 姐妹.aac",
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
  const parser = runParserRegressionTest();
  const directoryArtist = runDirectoryArtistRegressionTest(libraryFile);
  const fixture = runFixtureTest(
    libraryFile,
    DEFAULT_OUTPUT_FILE
  );
  const scale = runScaleTest(libraryFile);

  console.log(
    `Parser regression：${parser.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(parser));
  console.log(
    `Directory artist regression：${directoryArtist.passed ? "PASS" : "FAIL"}`
  );
  console.log(JSON.stringify(directoryArtist));
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

  if (
    !parser.passed ||
    !directoryArtist.passed ||
    !fixture.passed ||
    !scale.passed
  ) {
    throw new Error("Managed audio scanner self-test failed。");
  }

  return { parser, directoryArtist, fixture, scale };
}

export function runAudioAssetScan({
  audioRoot,
  outputFile = DEFAULT_OUTPUT_FILE,
  libraryFile = DEFAULT_LIBRARY_FILE,
  includeEmbeddedMetadata = false,
  includeIntegrity = includeEmbeddedMetadata
}) {
  const manifest = buildAudioAssetManifest({
    audioRoot,
    libraryFile,
    includeEmbeddedMetadata,
    includeIntegrity
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
          : DEFAULT_LIBRARY_FILE,
        includeEmbeddedMetadata:
          process.argv[5] === "--metadata",
        includeIntegrity: process.argv[5] === "--metadata"
      });
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
