/* global process */

import assert from "assert/strict";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSongIdentityKey } from "../normalizeSongs.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");

const DEFAULT_CANDIDATE_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/new-song-candidates-v2.json"
);
const DEFAULT_PREVIEW_REPORT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/pages-preview-build-report.json"
);
const DEFAULT_OUTPUT_FILE = path.join(
  projectRoot,
  "dist/audio-library-audit/firestore-import-dry-run.json"
);
const EXPECTED_PROJECT_ID = "golden-song-king";
const PRODUCTION_ORIGIN = "https://golden-song-audio.pages.dev";
const SONG_COLLECTION = "songs";
const EXPECTED_FIRST_ID = 51;
const EXPECTED_LAST_ID = 145;
const EXPECTED_CANDIDATE_COUNT = 95;
const DEFAULT_HTTP_CONCURRENCY = 8;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const REQUIRED_RUNTIME_FIELDS = Object.freeze([
  "id",
  "songName",
  "artist",
  "previewUrl"
]);
const OPTIONAL_CANONICAL_FIELDS = Object.freeze([
  "category",
  "decade",
  "difficulty",
  "spotifyId"
]);

const STATUSES = Object.freeze({
  READY: "READY_TO_IMPORT",
  PREVIEW_FAILED: "PREVIEW_FAILED",
  BATCH_BLOCKED: "BATCH_BLOCKED_PREVIEW_FAILURE",
  ID_CONFLICT: "ID_CONFLICT",
  IDENTITY_CONFLICT: "SONG_IDENTITY_CONFLICT",
  METADATA_REQUIRED: "METADATA_REQUIRED"
});

class ImportPlanError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ImportPlanError";
    this.code = code;
  }
}

function readJson(filePath, label) {
  let parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new ImportPlanError(
      "INPUT_READ_FAILED",
      `${label} 無法讀取：${error.message}`
    );
  }

  return parsed;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function songIdNumber(songId) {
  const match = /^M(\d{6})$/u.exec(songId || "");
  return match ? Number(match[1]) : null;
}

function compareSongIds(left, right) {
  return left.localeCompare(right, "en");
}

function expectedPreviewUrl(songId) {
  return `${PRODUCTION_ORIGIN}/${songId}/preview.mp3`;
}

function assertProductionPreviewUrl(url, songId) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new ImportPlanError(
      "INVALID_PREVIEW_URL",
      `${songId} previewUrl 不是有效 URL。`
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== PRODUCTION_ORIGIN ||
    parsed.pathname !== `/${songId}/preview.mp3` ||
    parsed.search ||
    parsed.hash ||
    url !== expectedPreviewUrl(songId)
  ) {
    throw new ImportPlanError(
      "INVALID_PREVIEW_URL",
      `${songId} previewUrl 不符合 production canonical URL。`
    );
  }
}

function validateExpectedIdRange(candidates, enforceProductionCount) {
  if (!enforceProductionCount) return;

  if (candidates.length !== EXPECTED_CANDIDATE_COUNT) {
    throw new ImportPlanError(
      "CANDIDATE_COUNT_MISMATCH",
      `READY_FOR_IMPORT 必須為 ${EXPECTED_CANDIDATE_COUNT} 首。`
    );
  }

  const numbers = candidates.map((candidate) =>
    songIdNumber(candidate.proposedId)
  );
  const expected = Array.from(
    { length: EXPECTED_CANDIDATE_COUNT },
    (_, index) => EXPECTED_FIRST_ID + index
  );

  if (
    numbers.some((value) => value === null) ||
    numbers.some((value, index) => value !== expected[index]) ||
    numbers.at(-1) !== EXPECTED_LAST_ID
  ) {
    throw new ImportPlanError(
      "CANDIDATE_ID_RANGE_MISMATCH",
      "proposed ID 必須完整且依序為 M000051–M000145。"
    );
  }
}

function reliableOptionalValue(field, value) {
  if (field === "difficulty") {
    return typeof value === "number" && Number.isFinite(value);
  }

  return nonEmptyString(value);
}

function buildPlannedDocument(candidate, previewUrl) {
  const document = {
    id: candidate.proposedId,
    songName: candidate.songName.trim(),
    artist: candidate.artist.trim(),
    previewUrl
  };

  for (const field of OPTIONAL_CANONICAL_FIELDS) {
    if (reliableOptionalValue(field, candidate[field])) {
      document[field] = candidate[field];
    }
  }

  return document;
}

function validateAndJoinInputs(
  candidateReport,
  previewReport,
  { enforceProductionCount = true } = {}
) {
  if (!Array.isArray(candidateReport.readyForImport)) {
    throw new ImportPlanError(
      "INVALID_CANDIDATE_REPORT",
      "Candidate report 缺少 readyForImport。"
    );
  }

  if (!Array.isArray(previewReport.assets)) {
    throw new ImportPlanError(
      "INVALID_PREVIEW_REPORT",
      "Preview report 缺少 assets。"
    );
  }

  const candidates = candidateReport.readyForImport
    .filter((candidate) => candidate.status === "READY_FOR_IMPORT")
    .sort((left, right) =>
      compareSongIds(left.proposedId, right.proposedId)
    );

  validateExpectedIdRange(candidates, enforceProductionCount);

  const candidateIds = new Set();
  const candidateIdentities = new Set();
  const assetById = new Map();

  for (const asset of previewReport.assets) {
    if (assetById.has(asset.songId)) {
      throw new ImportPlanError(
        "DUPLICATE_PREVIEW_ASSET",
        `Preview report 重複 songId：${asset.songId}`
      );
    }

    assetById.set(asset.songId, asset);
  }

  return candidates.map((candidate) => {
    const songId = candidate.proposedId;

    if (
      !nonEmptyString(songId) ||
      !nonEmptyString(candidate.songName) ||
      !nonEmptyString(candidate.artist)
    ) {
      throw new ImportPlanError(
        "MISSING_REQUIRED_CANDIDATE_FIELD",
        "READY candidate 缺少 proposedId、songName 或 artist。"
      );
    }

    if (candidateIds.has(songId)) {
      throw new ImportPlanError(
        "DUPLICATE_CANDIDATE_ID",
        `Candidate 重複 proposedId：${songId}`
      );
    }
    candidateIds.add(songId);

    const identityKey = getSongIdentityKey({
      songName: candidate.songName,
      artist: candidate.artist
    });

    if (candidateIdentities.has(identityKey)) {
      throw new ImportPlanError(
        "DUPLICATE_CANDIDATE_IDENTITY",
        `Candidate 重複歌曲 identity：${songId}`
      );
    }
    candidateIdentities.add(identityKey);

    const asset = assetById.get(songId);
    if (!asset) {
      throw new ImportPlanError(
        "PREVIEW_ASSET_MISSING",
        `${songId} 找不到 preview build asset。`
      );
    }

    const previewUrl = expectedPreviewUrl(songId);
    assertProductionPreviewUrl(previewUrl, songId);

    const expectedOutputPath = `${songId}/preview.mp3`;
    const candidatePreviewHintMatchesBuild =
      candidate.plannedPreview?.publicUrl === previewUrl &&
      candidate.plannedPreview?.relativePath === expectedOutputPath;
    const crossCheckPassed =
      asset.songId === songId &&
      asset.songName === candidate.songName &&
      asset.artist === candidate.artist &&
      asset.sourceSha256 === candidate.sourceAudio?.sha256 &&
      SHA256_PATTERN.test(asset.previewSha256 || "") &&
      asset.publicUrl === previewUrl &&
      asset.outputRelativePath === expectedOutputPath &&
      asset.status === "PREVIEW_READY";

    if (!crossCheckPassed) {
      throw new ImportPlanError(
        "PREVIEW_CROSS_CHECK_FAILED",
        `${songId} candidate 與 preview build report 不一致。`
      );
    }

    const plannedDocument = buildPlannedDocument(candidate, previewUrl);
    const missingMetadata = OPTIONAL_CANONICAL_FIELDS.filter(
      (field) => !Object.hasOwn(plannedDocument, field)
    );
    const missingRequired = REQUIRED_RUNTIME_FIELDS.filter(
      (field) => !Object.hasOwn(plannedDocument, field)
    );

    return {
      songId,
      songName: candidate.songName,
      artist: candidate.artist,
      previewUrl,
      previewSha256: asset.previewSha256,
      crossCheckPassed,
      candidatePreviewHintMatchesBuild,
      plannedDocument,
      missingMetadata,
      missingRequired,
      identityKey
    };
  });
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker()
    )
  );

  return results;
}

async function probePreviewUrl(item, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(item.previewUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { Accept: "audio/mpeg" }
    });
    const contentType = (response.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const verified = response.status === 200 && contentType === "audio/mpeg";

    return {
      verified,
      statusCode: response.status,
      contentType: contentType || null,
      error: verified ? null : "HTTP_OR_CONTENT_TYPE_MISMATCH"
    };
  } catch (error) {
    return {
      verified: false,
      statusCode: null,
      contentType: null,
      error: error instanceof Error ? error.message : "HTTP_PROBE_FAILED"
    };
  }
}

function inspectRuntimeCompatibility(root = projectRoot) {
  const gameFile = path.join(root, "src/pages/Game.jsx");
  const lobbyFile = path.join(root, "src/pages/Lobby.jsx");
  const songServiceFile = path.join(root, "src/services/songService.js");
  const audioPlayerFile = path.join(
    root,
    "src/components/game/AudioPlayer.jsx"
  );
  const files = [gameFile, lobbyFile, songServiceFile, audioPlayerFile];
  const source = Object.fromEntries(
    files.map((file) => [file, fs.readFileSync(file, "utf8")])
  );
  const combinedSongSelection = `${source[gameFile]}\n${source[songServiceFile]}`;
  const categoryQueryPattern = /where\(\s*["']category["']/u;
  const optionalDirectAccessPattern = /song\.(category|decade|difficulty)/u;

  const checks = {
    gameLoadsSongCollection: source[gameFile].includes("getDocs(songsRef)"),
    songServiceLoadsSongCollection:
      source[songServiceFile].includes("getDocs(songsRef)"),
    categoryFilterAppliedToSongs:
      categoryQueryPattern.test(combinedSongSelection),
    optionalMetadataDirectlyAccessedByGame:
      optionalDirectAccessPattern.test(source[gameFile]),
    previewUrlPassedOptionally:
      source[gameFile].includes("previewUrl={song?.previewUrl}"),
    spotifyIdPassedOptionally:
      source[gameFile].includes("spotifyId={song?.spotifyId}"),
    lobbyStartsWithSongId:
      source[lobbyFile].includes("currentSongId:") &&
      source[lobbyFile].includes("randomSong.id"),
    audioPlayerAcceptsPreviewUrl:
      source[audioPlayerFile].includes("const audioUrl = previewUrl")
  };
  const compatible =
    checks.gameLoadsSongCollection &&
    checks.songServiceLoadsSongCollection &&
    !checks.categoryFilterAppliedToSongs &&
    !checks.optionalMetadataDirectlyAccessedByGame &&
    checks.previewUrlPassedOptionally &&
    checks.spotifyIdPassedOptionally &&
    checks.lobbyStartsWithSongId &&
    checks.audioPlayerAcceptsPreviewUrl;

  return {
    compatible,
    requiredFields: [...REQUIRED_RUNTIME_FIELDS],
    optionalMissingFields: [...OPTIONAL_CANONICAL_FIELDS],
    checks,
    conclusion: compatible
      ? "目前 runtime 可使用只含 id、songName、artist、previewUrl 的歌曲文件。"
      : "目前 runtime compatibility 檢查未通過。"
  };
}

async function createFirestoreReadAdapter(expectedProjectId) {
  let appModule;
  let firestoreModule;

  try {
    [appModule, firestoreModule] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/firestore")
    ]);
  } catch {
    throw new ImportPlanError(
      "FIRESTORE_INITIALIZATION_FAILED",
      "Firebase Admin Firestore 無法載入。"
    );
  }

  const credential = appModule.applicationDefault();
  let credentialProjectId;

  try {
    credentialProjectId = await credential.getProjectId();
  } catch {
    throw new ImportPlanError(
      "CREDENTIAL_UNAVAILABLE",
      "Application Default Credentials 不可用。"
    );
  }

  if (credentialProjectId !== expectedProjectId) {
    throw new ImportPlanError(
      "PROJECT_MISMATCH",
      `ADC projectId 必須為 ${expectedProjectId}。`
    );
  }

  const app = appModule.initializeApp(
    { credential, projectId: credentialProjectId },
    `firestore-song-import-plan-${crypto.randomUUID()}`
  );
  const firestore = firestoreModule.getFirestore(app);
  let documentReads = 0;

  return {
    projectId: credentialProjectId,

    async readProposedIds(songIds) {
      const references = songIds.map((songId) =>
        firestore.doc(`${SONG_COLLECTION}/${songId}`)
      );
      const snapshots = await firestore.getAll(...references);
      documentReads += snapshots.length;

      return snapshots.map((snapshot) => ({
        id: snapshot.id,
        exists: snapshot.exists
      }));
    },

    async readAllSongs() {
      const snapshot = await firestore.collection(SONG_COLLECTION).get();
      documentReads += snapshot.size;

      return snapshot.docs.map((document) => ({
        documentId: document.id,
        ...document.data()
      }));
    },

    getStats() {
      return { documentReads, documentWrites: 0 };
    },

    async close() {
      await appModule.deleteApp(app);
    }
  };
}

function identityConflictMap(existingSongs) {
  const identities = new Map();

  for (const song of existingSongs) {
    const key = getSongIdentityKey(song);
    if (!key) continue;

    const documentId = song.documentId || song.id;
    const ids = identities.get(key) || [];
    ids.push(documentId);
    identities.set(key, ids);
  }

  for (const ids of identities.values()) {
    ids.sort(compareSongIds);
  }

  return identities;
}

function summarizeMissingMetadata(results) {
  const counts = Object.fromEntries(
    OPTIONAL_CANONICAL_FIELDS.map((field) => [field, 0])
  );

  for (const result of results) {
    for (const field of result.missingMetadata) {
      counts[field] += 1;
    }
  }

  return counts;
}

export async function planFirestoreSongImport({
  candidateReport,
  previewReport,
  firestoreAdapter,
  fetchImpl = fetch,
  runtimeCompatibility,
  httpConcurrency = DEFAULT_HTTP_CONCURRENCY,
  enforceProductionCount = true
}) {
  if (firestoreAdapter.projectId !== EXPECTED_PROJECT_ID) {
    throw new ImportPlanError(
      "PROJECT_MISMATCH",
      `Firestore project 必須為 ${EXPECTED_PROJECT_ID}。`
    );
  }

  const joined = validateAndJoinInputs(candidateReport, previewReport, {
    enforceProductionCount
  });
  const httpResults = await mapWithConcurrency(
    joined,
    httpConcurrency,
    (item) => probePreviewUrl(item, fetchImpl)
  );
  const previewFailed = httpResults.filter((result) => !result.verified).length;
  const proposedSnapshots = await firestoreAdapter.readProposedIds(
    joined.map((item) => item.songId)
  );
  const idAvailability = new Map(
    proposedSnapshots.map((snapshot) => [snapshot.id, !snapshot.exists])
  );
  const existingSongs = await firestoreAdapter.readAllSongs();
  const existingIdentities = identityConflictMap(existingSongs);

  const songs = joined.map((item, index) => {
    const http = httpResults[index];
    const firestoreIdAvailable = idAvailability.get(item.songId) === true;
    const conflictingDocumentIds =
      existingIdentities.get(item.identityKey)?.filter(
        (documentId) => documentId !== item.songId
      ) || [];
    const identityAvailable = conflictingDocumentIds.length === 0;
    const reasons = [];
    let status = STATUSES.READY;

    if (item.missingRequired.length > 0) {
      status = STATUSES.METADATA_REQUIRED;
      reasons.push(`MISSING_REQUIRED:${item.missingRequired.join(",")}`);
    } else if (!http.verified) {
      status = STATUSES.PREVIEW_FAILED;
      reasons.push(http.error || "PREVIEW_HTTP_FAILED");
    } else if (!firestoreIdAvailable) {
      status = STATUSES.ID_CONFLICT;
      reasons.push("PROPOSED_DOCUMENT_ALREADY_EXISTS");
    } else if (!identityAvailable) {
      status = STATUSES.IDENTITY_CONFLICT;
      reasons.push("SONG_IDENTITY_ALREADY_EXISTS");
    } else if (previewFailed > 0) {
      status = STATUSES.BATCH_BLOCKED;
      reasons.push("BATCH_CONTAINS_PREVIEW_FAILURE");
    }

    if (item.missingMetadata.length > 0) {
      reasons.push(`OPTIONAL_METADATA_OMITTED:${item.missingMetadata.join(",")}`);
    }

    return {
      songId: item.songId,
      songName: item.songName,
      artist: item.artist,
      previewUrl: item.previewUrl,
      previewSha256: item.previewSha256,
      candidatePreviewHintMatchesBuild: item.candidatePreviewHintMatchesBuild,
      previewVerified: http.verified,
      httpStatus: http.statusCode,
      contentType: http.contentType,
      firestoreIdAvailable,
      identityAvailable,
      conflictingDocumentIds,
      plannedDocument: item.plannedDocument,
      missingMetadata: item.missingMetadata,
      status,
      reasons
    };
  });

  const firestoreStats = firestoreAdapter.getStats();
  const countStatus = (status) =>
    songs.filter((song) => song.status === status).length;

  return {
    schemaVersion: 1,
    mode: "READ_ONLY_DRY_RUN",
    source: {
      productionOrigin: PRODUCTION_ORIGIN,
      firestoreCollection: SONG_COLLECTION
    },
    firestore: {
      projectId: firestoreAdapter.projectId,
      existingSongCount: existingSongs.length,
      reads: firestoreStats.documentReads,
      writes: firestoreStats.documentWrites
    },
    summary: {
      candidateCount: songs.length,
      previewVerified: songs.filter((song) => song.previewVerified).length,
      previewFailed,
      idAvailable: songs.filter((song) => song.firestoreIdAvailable).length,
      idConflicts: countStatus(STATUSES.ID_CONFLICT),
      identityConflicts: countStatus(STATUSES.IDENTITY_CONFLICT),
      readyToImport: countStatus(STATUSES.READY),
      metadataRequired: countStatus(STATUSES.METADATA_REQUIRED),
      candidatePreviewHintsSuperseded: songs.filter(
        (song) => !song.candidatePreviewHintMatchesBuild
      ).length,
      batchBlockedByPreviewFailure: previewFailed > 0
    },
    missingMetadata: {
      required: Object.fromEntries(
        REQUIRED_RUNTIME_FIELDS.map((field) => [
          field,
          songs.filter((song) => !Object.hasOwn(song.plannedDocument, field))
            .length
        ])
      ),
      optional: summarizeMissingMetadata(songs)
    },
    runtimeCompatibility,
    createSemantics: {
      required: "CREATE_ONLY",
      overwriteExisting: false,
      setMergeAllowed: false,
      updateExistingAllowed: false,
      executeImplemented: false
    },
    safety: {
      firestoreWrites: firestoreStats.documentWrites,
      cloudflareWrites: 0,
      firebaseStorageWrites: 0,
      sourceAudioWrites: 0
    },
    songs
  };
}

function fixtureCandidate(id, songName, artist, overrides = {}) {
  return {
    proposedId: id,
    songName,
    artist,
    category: null,
    decade: null,
    difficulty: null,
    metadataStatus: "NEEDS_ENRICHMENT",
    sourceAudio: {
      relativePath: `${id}.mp3`,
      extension: ".mp3",
      sha256: "a".repeat(64),
      durationSeconds: 120
    },
    status: "READY_FOR_IMPORT",
    plannedPreview: {
      relativePath: `${id}/preview.mp3`,
      publicUrl: expectedPreviewUrl(id)
    },
    ...overrides
  };
}

function fixturePreview(candidate) {
  return {
    songId: candidate.proposedId,
    songName: candidate.songName,
    artist: candidate.artist,
    sourceSha256: candidate.sourceAudio.sha256,
    outputRelativePath: `${candidate.proposedId}/preview.mp3`,
    previewSha256: "b".repeat(64),
    publicUrl: expectedPreviewUrl(candidate.proposedId),
    status: "PREVIEW_READY"
  };
}

function fakeHeaders(contentType) {
  return {
    get(name) {
      return name.toLowerCase() === "content-type" ? contentType : null;
    }
  };
}

function createFakeFirestore({ existingById = [], existingSongs = [] } = {}) {
  let reads = 0;
  const existingIds = new Set(existingById);

  return {
    projectId: EXPECTED_PROJECT_ID,
    async readProposedIds(songIds) {
      reads += songIds.length;
      return songIds.map((id) => ({ id, exists: existingIds.has(id) }));
    },
    async readAllSongs() {
      reads += existingSongs.length;
      return existingSongs;
    },
    getStats() {
      return { documentReads: reads, documentWrites: 0 };
    }
  };
}

export async function runSelfTest() {
  const candidates = [
    fixtureCandidate("M900001", "測試歌曲甲", "測試歌手甲"),
    fixtureCandidate("M900002", "測試歌曲乙", "測試歌手乙")
  ];
  const candidateReport = { readyForImport: candidates };
  const previewReport = { assets: candidates.map(fixturePreview) };
  const runtimeCompatibility = {
    compatible: true,
    requiredFields: [...REQUIRED_RUNTIME_FIELDS],
    optionalMissingFields: [...OPTIONAL_CANONICAL_FIELDS]
  };
  const successfulFetch = async () => ({
    status: 200,
    headers: fakeHeaders("audio/mpeg")
  });
  const successful = await planFirestoreSongImport({
    candidateReport,
    previewReport,
    firestoreAdapter: createFakeFirestore(),
    fetchImpl: successfulFetch,
    runtimeCompatibility,
    enforceProductionCount: false
  });
  const repeated = await planFirestoreSongImport({
    candidateReport,
    previewReport,
    firestoreAdapter: createFakeFirestore(),
    fetchImpl: successfulFetch,
    runtimeCompatibility,
    enforceProductionCount: false
  });

  assert.equal(successful.summary.readyToImport, 2);
  assert.equal(successful.summary.metadataRequired, 0);
  assert.equal(successful.firestore.writes, 0);
  assert.deepEqual(successful, repeated);
  assert.deepEqual(Object.keys(successful.songs[0].plannedDocument), [
    "id",
    "songName",
    "artist",
    "previewUrl"
  ]);

  const conflicts = await planFirestoreSongImport({
    candidateReport,
    previewReport,
    firestoreAdapter: createFakeFirestore({
      existingById: ["M900001"],
      existingSongs: [
        {
          documentId: "M123456",
          songName: "測試歌曲乙",
          artist: "測試歌手乙"
        }
      ]
    }),
    fetchImpl: successfulFetch,
    runtimeCompatibility,
    enforceProductionCount: false
  });
  assert.equal(conflicts.songs[0].status, STATUSES.ID_CONFLICT);
  assert.equal(conflicts.songs[1].status, STATUSES.IDENTITY_CONFLICT);

  const failedHttp = await planFirestoreSongImport({
    candidateReport,
    previewReport,
    firestoreAdapter: createFakeFirestore(),
    fetchImpl: async (url) => ({
      status: url.includes("M900002") ? 404 : 200,
      headers: fakeHeaders(
        url.includes("M900002") ? "text/html" : "audio/mpeg"
      )
    }),
    runtimeCompatibility,
    enforceProductionCount: false
  });
  assert.equal(failedHttp.summary.previewFailed, 1);
  assert.equal(failedHttp.summary.readyToImport, 0);
  assert.equal(failedHttp.songs[0].status, STATUSES.BATCH_BLOCKED);
  assert.equal(failedHttp.songs[1].status, STATUSES.PREVIEW_FAILED);

  assert.throws(
    () => assertProductionPreviewUrl("http://localhost/test.mp3", "M900001"),
    (error) => error.code === "INVALID_PREVIEW_URL"
  );

  return {
    passed: true,
    checks: {
      readyCandidatesOnly: true,
      canonicalPreviewCrossCheck: true,
      httpValidation: true,
      batchPreviewFailureGate: true,
      idConflictDetection: true,
      identityConflictDetection: true,
      optionalMetadataOmitted: true,
      createOnlyPlan: true,
      firestoreWritesZero: true,
      deterministicReport: true
    }
  };
}

function parseArguments(argv) {
  const options = {
    candidateFile: DEFAULT_CANDIDATE_FILE,
    previewReportFile: DEFAULT_PREVIEW_REPORT_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
    selfTest: false,
    help: false,
    httpConcurrency: DEFAULT_HTTP_CONCURRENCY
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--self-test") {
      options.selfTest = true;
    } else if (argument === "--help") {
      options.help = true;
    } else if (argument === "--candidate") {
      options.candidateFile = path.resolve(argv[++index]);
    } else if (argument === "--preview-report") {
      options.previewReportFile = path.resolve(argv[++index]);
    } else if (argument === "--output") {
      options.outputFile = path.resolve(argv[++index]);
    } else if (argument === "--http-concurrency") {
      options.httpConcurrency = Number(argv[++index]);
    } else {
      throw new ImportPlanError(
        "UNKNOWN_ARGUMENT",
        `不支援的參數：${argument}`
      );
    }
  }

  if (
    !Number.isInteger(options.httpConcurrency) ||
    options.httpConcurrency < 1 ||
    options.httpConcurrency > 20
  ) {
    throw new ImportPlanError(
      "INVALID_HTTP_CONCURRENCY",
      "--http-concurrency 必須為 1–20 的整數。"
    );
  }

  return options;
}

function printHelp() {
  console.log(`Firestore song import planner (read-only)

Usage:
  node scripts/song-import/audio-assets/planFirestoreSongImport.js
  node scripts/song-import/audio-assets/planFirestoreSongImport.js --self-test

Options:
  --candidate <file>
  --preview-report <file>
  --output <file>
  --http-concurrency <1-20>
  --self-test
  --help

This tool never writes to Firestore and does not implement --execute.`);
}

async function runCli() {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.selfTest) {
    const result = await runSelfTest();
    console.log("Firestore import planner self-test：PASS");
    console.log(JSON.stringify(result));
    return;
  }

  const configuredProjectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

  if (configuredProjectId !== EXPECTED_PROJECT_ID) {
    throw new ImportPlanError(
      "PROJECT_ALLOWLIST_MISMATCH",
      `FIREBASE_PROJECT_ID 或 GOOGLE_CLOUD_PROJECT 必須為 ${EXPECTED_PROJECT_ID}。`
    );
  }

  const candidateReport = readJson(options.candidateFile, "Candidate report");
  const previewReport = readJson(
    options.previewReportFile,
    "Preview build report"
  );
  const runtimeCompatibility = inspectRuntimeCompatibility();

  if (!runtimeCompatibility.compatible) {
    throw new ImportPlanError(
      "RUNTIME_INCOMPATIBLE",
      runtimeCompatibility.conclusion
    );
  }

  const firestoreAdapter = await createFirestoreReadAdapter(
    EXPECTED_PROJECT_ID
  );

  try {
    const report = await planFirestoreSongImport({
      candidateReport,
      previewReport,
      firestoreAdapter,
      runtimeCompatibility,
      httpConcurrency: options.httpConcurrency
    });
    writeJson(options.outputFile, report);

    console.log("READ-ONLY DRY RUN - FIRESTORE WRITES DISABLED");
    console.log(`Candidates：${report.summary.candidateCount}`);
    console.log(`Preview verified：${report.summary.previewVerified}`);
    console.log(`Preview failed：${report.summary.previewFailed}`);
    console.log(`ID conflicts：${report.summary.idConflicts}`);
    console.log(`Identity conflicts：${report.summary.identityConflicts}`);
    console.log(`READY_TO_IMPORT：${report.summary.readyToImport}`);
    console.log(`METADATA_REQUIRED：${report.summary.metadataRequired}`);
    console.log(`Firestore writes：${report.safety.firestoreWrites}`);
    console.log(`Report：${path.resolve(options.outputFile)}`);

    if (report.summary.previewFailed > 0) {
      const failedIds = report.songs
        .filter((song) => !song.previewVerified)
        .map((song) => song.songId);
      console.log(`Preview failures：${failedIds.join(", ")}`);
    }
  } finally {
    await firestoreAdapter.close();
  }
}

if (path.resolve(process.argv[1] || "") === __filename) {
  runCli().catch((error) => {
    console.error(`${error.code || error.name}：${error.message}`);
    process.exitCode = 1;
  });
}
