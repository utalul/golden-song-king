/* global process */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getSongIdentityKey,
  normalizeSongs,
  toSerializableSong
} from "./normalizeSongs.js";
import {
  findIncomingDuplicates,
  indexesForDuplicateGroups,
  validateSong
} from "./validateSongs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const DEFAULT_INPUT_FILE =
  "scripts/song-import/input/fixture.json";
const DEFAULT_OUTPUT_FILE =
  "scripts/song-import/output/import-report.json";
const DEFAULT_EXISTING_FILE =
  "src/data/songs/all_with_spotify.json";

function issue(code, message) {
  return { code, message };
}

function readJsonRecords(filePath) {
  if (path.extname(filePath).toLowerCase() !== ".json") {
    throw new Error(
      "Sprint23B 目前只支援 JSON input；CSV 尚未啟用。"
    );
  }

  const parsed = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
  const records = Array.isArray(parsed)
    ? parsed
    : parsed?.songs;

  if (!Array.isArray(records)) {
    throw new Error(
      "Input 必須是 JSON array，或包含 songs array 的 object。"
    );
  }

  return records;
}

function mapFirstBy(records, keySelector) {
  const index = new Map();

  records.forEach((record) => {
    const key = keySelector(record);

    if (key && !index.has(key)) {
      index.set(key, record);
    }
  });

  return index;
}

function getNumericSongId(id) {
  const match =
    typeof id === "string"
      ? id.match(/^M(\d{6})$/)
      : null;

  return match ? Number(match[1]) : null;
}

function createIdAllocator(existingSongs, incomingSongs) {
  const reservedIds = new Set(
    [...existingSongs, ...incomingSongs]
      .map((song) => song.id)
      .filter((id) => typeof id === "string" && id)
  );

  const existingNumericIds = existingSongs
    .map((song) => getNumericSongId(song.id))
    .filter((id) => id !== null);
  const existingMaxNumericId =
    existingNumericIds.length > 0
      ? Math.max(...existingNumericIds)
      : 0;
  let nextNumericId = existingMaxNumericId + 1;

  return {
    existingMaxNumericId,
    allocate() {
      let candidate;

      do {
        candidate = `M${String(nextNumericId).padStart(6, "0")}`;
        nextNumericId += 1;
      } while (reservedIds.has(candidate));

      reservedIds.add(candidate);
      return candidate;
    },
    getNextNumericId() {
      return nextNumericId;
    }
  };
}

function addIncomingDuplicateIssues(records, normalizedSongs) {
  const duplicates = findIncomingDuplicates(normalizedSongs);
  const duplicateIdIndexes = indexesForDuplicateGroups(
    duplicates.id
  );
  const duplicateIdentityIndexes = indexesForDuplicateGroups(
    duplicates.identity
  );
  const duplicateSpotifyIndexes = indexesForDuplicateGroups(
    duplicates.spotifyId
  );
  const duplicatePreviewIndexes = indexesForDuplicateGroups(
    duplicates.previewUrl
  );

  records.forEach((record, index) => {
    if (duplicateIdIndexes.has(index)) {
      record.errors.push(
        issue(
          "DUPLICATE_ID",
          "Input 中有重複 id。"
        )
      );
    }

    if (duplicateIdentityIndexes.has(index)) {
      record.errors.push(
        issue(
          "DUPLICATE_SONG",
          "Input 中有重複的 songName + artist。"
        )
      );
    }

    if (duplicateSpotifyIndexes.has(index)) {
      record.warnings.push(
        issue(
          "DUPLICATE_SPOTIFY_ID",
          "Input 中有重複 spotifyId，請確認是否為同一錄音版本。"
        )
      );
    }

    if (duplicatePreviewIndexes.has(index)) {
      record.warnings.push(
        issue(
          "DUPLICATE_PREVIEW_URL",
          "Input 中有重複 previewUrl。"
        )
      );
    }
  });
}

function addExistingLibraryIssues(record, song, indexes) {
  const identity = getSongIdentityKey(song);
  const existingByIdentity = indexes.identity.get(identity);
  const existingById = song.id
    ? indexes.id.get(song.id)
    : null;

  if (
    existingById &&
    getSongIdentityKey(existingById) !== identity
  ) {
    record.errors.push(
      issue(
        "ID_CONFLICT",
        "id 已被現有題庫中的其他歌曲使用。"
      )
    );
  }

  const existingBySpotifyId = song.spotifyId
    ? indexes.spotifyId.get(song.spotifyId)
    : null;

  if (
    existingBySpotifyId &&
    getSongIdentityKey(existingBySpotifyId) !== identity
  ) {
    record.warnings.push(
      issue(
        "EXISTING_SPOTIFY_ID_MATCH",
        "spotifyId 已被現有題庫中的其他歌曲使用。"
      )
    );
  }

  const existingByPreviewUrl = song.previewUrl
    ? indexes.previewUrl.get(song.previewUrl)
    : null;

  if (
    existingByPreviewUrl &&
    getSongIdentityKey(existingByPreviewUrl) !== identity
  ) {
    record.warnings.push(
      issue(
        "EXISTING_PREVIEW_URL_MATCH",
        "previewUrl 已被現有題庫中的其他歌曲使用。"
      )
    );
  }

  if (
    existingByIdentity &&
    song.id &&
    song.id !== existingByIdentity.id
  ) {
    record.warnings.push(
      issue(
        "EXISTING_ID_MISMATCH",
        "歌曲已存在，但 input id 與現有 id 不同。"
      )
    );
  }

  return existingByIdentity;
}

function hasDuplicateError(record) {
  return record.errors.some(
    (error) =>
      error.code === "DUPLICATE_ID" ||
      error.code === "DUPLICATE_SONG" ||
      error.code === "ID_CONFLICT"
  );
}

function determineStatus(record, hasValidationError, existingSong) {
  if (hasValidationError) {
    return "INVALID";
  }

  if (hasDuplicateError(record)) {
    return "DUPLICATE";
  }

  if (existingSong) {
    return "EXISTING";
  }

  return "NEW";
}

export function buildImportReport(
  incomingRecords,
  existingRecords,
  source = {}
) {
  const normalizedSongs = normalizeSongs(incomingRecords);
  const existingSongs = normalizeSongs(existingRecords);
  const existingIndexes = {
    identity: mapFirstBy(existingSongs, getSongIdentityKey),
    id: mapFirstBy(existingSongs, (song) => song.id || ""),
    spotifyId: mapFirstBy(
      existingSongs,
      (song) => song.spotifyId || ""
    ),
    previewUrl: mapFirstBy(
      existingSongs,
      (song) => song.previewUrl || ""
    )
  };
  const allocator = createIdAllocator(
    existingSongs,
    normalizedSongs
  );
  const validationErrors = [];

  const records = normalizedSongs.map((song, inputIndex) => {
    const validation = validateSong(
      song,
      incomingRecords[inputIndex]
    );

    validationErrors[inputIndex] = validation.errors.length > 0;

    return {
      inputIndex,
      status: "INVALID",
      proposedId: null,
      song: toSerializableSong(song),
      warnings: [...validation.warnings],
      errors: [...validation.errors]
    };
  });

  addIncomingDuplicateIssues(records, normalizedSongs);

  records.forEach((record, index) => {
    const song = normalizedSongs[index];
    const existingSong = addExistingLibraryIssues(
      record,
      song,
      existingIndexes
    );

    record.status = determineStatus(
      record,
      validationErrors[index],
      existingSong
    );

    if (record.status === "EXISTING") {
      record.proposedId = existingSong.id || song.id || null;
    } else if (record.status === "NEW") {
      record.proposedId = song.id || allocator.allocate();
    } else {
      record.proposedId = song.id || null;
    }
  });

  const countStatus = (status) =>
    records.filter((record) => record.status === status).length;
  const warningCount = records.reduce(
    (count, record) => count + record.warnings.length,
    0
  );
  const errorCount = records.reduce(
    (count, record) => count + record.errors.length,
    0
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    idAllocation: {
      format: "M000001",
      existingMaxNumericId: allocator.existingMaxNumericId,
      nextNumericId: allocator.getNextNumericId()
    },
    summary: {
      inputCount: records.length,
      validCount: countStatus("NEW") + countStatus("EXISTING"),
      invalidCount: countStatus("INVALID"),
      newCount: countStatus("NEW"),
      existingCount: countStatus("EXISTING"),
      duplicateCount: countStatus("DUPLICATE"),
      warningCount,
      errorCount
    },
    records
  };
}

export function runImportDryRun({
  inputFile,
  outputFile,
  existingFile
}) {
  const incomingRecords = readJsonRecords(inputFile);
  const existingRecords = readJsonRecords(existingFile);
  const report = buildImportReport(
    incomingRecords,
    existingRecords,
    {
      inputFile: path.relative(projectRoot, inputFile),
      existingLibraryFile: path.relative(projectRoot, existingFile)
    }
  );

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(
    outputFile,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  console.log(`Total: ${report.summary.inputCount}`);
  console.log(`Valid: ${report.summary.validCount}`);
  console.log(`Invalid: ${report.summary.invalidCount}`);
  console.log(`New: ${report.summary.newCount}`);
  console.log(`Existing: ${report.summary.existingCount}`);
  console.log(`Duplicates: ${report.summary.duplicateCount}`);
  console.log(`Warnings: ${report.summary.warningCount}`);
  console.log(`Errors: ${report.summary.errorCount}`);

  report.records
    .filter(
      (record) =>
        record.warnings.length > 0 || record.errors.length > 0
    )
    .forEach((record) => {
      const name = record.song.songName || "未命名歌曲";
      console.log(
        `[${record.inputIndex + 1}] ${record.status} ${name}`
      );

      record.errors.forEach((error) => {
        console.log(`  ERROR ${error.code}: ${error.message}`);
      });

      record.warnings.forEach((warning) => {
        console.log(
          `  WARNING ${warning.code}: ${warning.message}`
        );
      });
    });

  console.log(
    `Report: ${path.relative(projectRoot, outputFile)}`
  );

  return report;
}

function resolveProjectPath(filePath) {
  return path.resolve(projectRoot, filePath);
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  const inputFile = resolveProjectPath(
    process.argv[2] || DEFAULT_INPUT_FILE
  );
  const outputFile = resolveProjectPath(
    process.argv[3] || DEFAULT_OUTPUT_FILE
  );
  const existingFile = resolveProjectPath(
    process.argv[4] || DEFAULT_EXISTING_FILE
  );

  try {
    runImportDryRun({
      inputFile,
      outputFile,
      existingFile
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
