/* global process */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  AUDIO_MATCH_STATUSES,
  MATCH_CONFIG
} from "./matchConfig.js";
import {
  classifyTrackMatch,
  scoreTrackMatch
} from "./matchEngine.js";
import {
  normalizeProviderCandidate
} from "./providers/audioProvider.js";
import {
  getProvider,
  listProviders
} from "./providers/providerRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const DEFAULT_IMPORT_REPORT =
  "scripts/song-import/output/import-report.json";
const DEFAULT_OUTPUT_FILE =
  "scripts/song-import/output/audio-match-report.json";
const MATCHABLE_IMPORT_STATUSES = new Set(["NEW", "EXISTING"]);

function readImportReport(filePath) {
  const report = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );

  if (!Array.isArray(report.records)) {
    throw new Error("Import report 缺少 records array。");
  }

  return report;
}

export async function mapWithConcurrency(
  items,
  concurrency,
  mapper
) {
  const workerCount = Math.max(
    1,
    Math.min(concurrency, items.length || 1)
  );
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(
        items[currentIndex],
        currentIndex
      );
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, () => worker())
  );

  return results;
}

function emptyAudioMatch(status, provider, reasons) {
  return {
    status,
    provider,
    confidence: 0,
    titleScore: 0,
    artistScore: 0,
    providerTrackId: null,
    matchedSongName: null,
    matchedArtist: null,
    previewUrl: null,
    duration: null,
    reasons
  };
}

async function matchRecord(record, provider) {
  if (!MATCHABLE_IMPORT_STATUSES.has(record.status)) {
    return {
      inputIndex: record.inputIndex,
      importStatus: record.status,
      song: record.song,
      skippedReason: `IMPORT_STATUS_${record.status}`,
      audioMatch: null
    };
  }

  if (!record.song?.songName || !record.song?.artist) {
    return {
      inputIndex: record.inputIndex,
      importStatus: record.status,
      song: record.song,
      skippedReason: "MISSING_SONG_IDENTITY",
      audioMatch: null
    };
  }

  try {
    const rawCandidate = await provider.searchTrack({
      songName: record.song.songName,
      artist: record.song.artist
    });
    const candidate = normalizeProviderCandidate(
      provider.name,
      rawCandidate
    );

    if (!candidate) {
      return {
        inputIndex: record.inputIndex,
        importStatus: record.status,
        song: record.song,
        skippedReason: null,
        audioMatch: emptyAudioMatch(
          AUDIO_MATCH_STATUSES.NOT_FOUND,
          provider.name,
          ["PROVIDER_NO_RESULT"]
        )
      };
    }

    const score = scoreTrackMatch(record.song, candidate);
    const classification = classifyTrackMatch(score, candidate);

    return {
      inputIndex: record.inputIndex,
      importStatus: record.status,
      song: record.song,
      skippedReason: null,
      audioMatch: {
        status: classification.status,
        provider: candidate.provider,
        confidence: score.confidence,
        titleScore: score.titleScore,
        artistScore: score.artistScore,
        providerTrackId: candidate.providerTrackId,
        matchedSongName: candidate.matchedSongName,
        matchedArtist: candidate.matchedArtist,
        previewUrl: candidate.previewUrl,
        duration: candidate.duration,
        reasons: classification.reasons,
        metadata: candidate.metadata
      }
    };
  } catch (error) {
    return {
      inputIndex: record.inputIndex,
      importStatus: record.status,
      song: record.song,
      skippedReason: null,
      audioMatch: {
        ...emptyAudioMatch(
          AUDIO_MATCH_STATUSES.PROVIDER_ERROR,
          provider.name,
          ["PROVIDER_LOOKUP_ERROR"]
        ),
        errorMessage:
          error instanceof Error
            ? error.message
            : "Unknown provider error"
      }
    };
  }
}

export async function buildAudioMatchReport(
  importReport,
  provider,
  options = {}
) {
  const concurrency =
    options.concurrency || MATCH_CONFIG.defaultConcurrency;
  const records = await mapWithConcurrency(
    importReport.records,
    concurrency,
    (record) => matchRecord(record, provider)
  );
  const countStatus = (status) =>
    records.filter(
      (record) => record.audioMatch?.status === status
    ).length;
  const skipped = records.filter(
    (record) => record.skippedReason
  ).length;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: options.source || {},
    provider: provider.name,
    concurrency,
    thresholds: {
      autoApprove: MATCH_CONFIG.autoApproveThreshold,
      review: MATCH_CONFIG.reviewThreshold
    },
    summary: {
      total: records.length,
      processed: records.length - skipped,
      autoApproved: countStatus(
        AUDIO_MATCH_STATUSES.AUTO_APPROVED
      ),
      reviewRequired: countStatus(
        AUDIO_MATCH_STATUSES.REVIEW_REQUIRED
      ),
      notFound: countStatus(AUDIO_MATCH_STATUSES.NOT_FOUND),
      providerErrors: countStatus(
        AUDIO_MATCH_STATUSES.PROVIDER_ERROR
      ),
      skipped
    },
    records
  };
}

export async function runAudioMatchDryRun({
  importReportFile,
  outputFile,
  providerName,
  concurrency = MATCH_CONFIG.defaultConcurrency
}) {
  const importReport = readImportReport(importReportFile);
  const provider = getProvider(providerName);
  const report = await buildAudioMatchReport(
    importReport,
    provider,
    {
      concurrency,
      source: {
        importReportFile: path.relative(
          projectRoot,
          importReportFile
        )
      }
    }
  );

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(
    outputFile,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  console.log(`Total: ${report.summary.total}`);
  console.log(`Processed: ${report.summary.processed}`);
  console.log(`Auto approved: ${report.summary.autoApproved}`);
  console.log(`Review required: ${report.summary.reviewRequired}`);
  console.log(`Not found: ${report.summary.notFound}`);
  console.log(`Provider errors: ${report.summary.providerErrors}`);
  console.log(`Skipped: ${report.summary.skipped}`);

  report.records
    .filter(
      (record) =>
        record.audioMatch?.status ===
        AUDIO_MATCH_STATUSES.PROVIDER_ERROR
    )
    .forEach((record) => {
      console.log(
        `[${record.inputIndex + 1}] PROVIDER_ERROR ${record.song.songName}`
      );
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
  const importReportFile = resolveProjectPath(
    process.argv[2] || DEFAULT_IMPORT_REPORT
  );
  const providerName = process.argv[3] || "mock";
  const outputFile = resolveProjectPath(
    process.argv[4] || DEFAULT_OUTPUT_FILE
  );
  const concurrency = Number(
    process.argv[5] || MATCH_CONFIG.defaultConcurrency
  );

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    console.error("Concurrency 必須是大於 0 的整數。");
    process.exitCode = 1;
  } else {
    runAudioMatchDryRun({
      importReportFile,
      outputFile,
      providerName,
      concurrency
    }).catch((error) => {
      console.error(error);
      console.error(
        `可用 providers：${listProviders().join(", ")}`
      );
      process.exitCode = 1;
    });
  }
}
