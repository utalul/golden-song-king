/* global process */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import dotenv from "dotenv";

import {
  classifyTrackMatch,
  scoreTrackMatch
} from "./matchEngine.js";
import {
  normalizeProviderCandidate
} from "./providers/audioProvider.js";
import { jamendoProbeProvider } from "./providers/jamendoProbeProvider.js";
import { sevenDigitalProbeProvider } from "./providers/sevenDigitalProbeProvider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const FIXTURE_FILE = path.join(
  __dirname,
  "fixtures/provider-test.json"
);
const OUTPUT_FILE = path.join(
  __dirname,
  "output/provider-feasibility-report.json"
);
const REQUEST_DELAY_MS = 300;

dotenv.config({
  path: path.join(projectRoot, ".env.local"),
  quiet: true
});

const providerProfiles = [
  {
    provider: sevenDigitalProbeProvider,
    displayName: "7digital / MassiveMusic",
    accessStatusWhenAvailable: "COMMERCIAL_CREDENTIALS_AVAILABLE",
    credentialRequired: [
      "SEVENDIGITAL_API_KEY",
      "SEVENDIGITAL_API_SECRET"
    ],
    previewSupported: true,
    previewDuration: "ABOUT_30_SECONDS",
    apiSuitability: "TECHNICALLY_SUITABLE_REQUIRES_PARTNER_ACCESS",
    urlPersistence: "SIGNED_TEMPORARY",
    licensingClassification: "B",
    productionRecommendation:
      "CONSIDER_ONLY_AFTER_COMMERCIAL_AGREEMENT_AND_CATALOG_TEST",
    requiresBackendProxy: true,
    missingResult: "NOT_FOUND",
    documentation: [
      "https://docs.massivemusic.com/reference/authentication",
      "https://docs.massivemusic.com/reference/play-preview-clip"
    ]
  },
  {
    provider: jamendoProbeProvider,
    displayName: "Jamendo",
    accessStatusWhenAvailable: "READ_API_CREDENTIAL_AVAILABLE",
    credentialRequired: ["JAMENDO_CLIENT_ID"],
    previewSupported: "FULL_TRACK_STREAM_NOT_FIXED_30_SECOND_PREVIEW",
    previewDuration: "TRACK_DURATION_CLIENT_MUST_LIMIT_PLAYBACK",
    apiSuitability: "TECHNICALLY_COMPATIBLE_CATALOG_MISMATCH_LIKELY",
    urlPersistence: "UNKNOWN",
    licensingClassification: "B",
    productionRecommendation:
      "NOT_RECOMMENDED_FOR_MAINSTREAM_MANDARIN_LIBRARY_WITHOUT_COVERAGE_PROOF",
    requiresBackendProxy: true,
    missingResult: "CATALOG_COVERAGE_FAILURE",
    documentation: [
      "https://developer.jamendo.com/v3.0/authentication",
      "https://developer.jamendo.com/v3.0/tracks",
      "https://devportal.jamendo.com/api_terms_of_use"
    ]
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readFixture() {
  const songs = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8"));

  if (!Array.isArray(songs) || songs.length !== 5) {
    throw new Error("Provider fixture 必須包含 5 首歌曲。");
  }

  return songs;
}

function corsStatus(response) {
  const allowOrigin = response.headers.get(
    "access-control-allow-origin"
  );

  if (allowOrigin === "*") {
    return "ALLOWED_WILDCARD";
  }

  if (allowOrigin) {
    return "ALLOWED_EXPLICIT_ORIGIN";
  }

  return "HEADER_MISSING";
}

function browserPlaybackStatus(contentType) {
  if (!contentType) {
    return "UNKNOWN_CONTENT_TYPE";
  }

  return /^(audio\/|application\/ogg)/i.test(contentType)
    ? "SUPPORTED_AUDIO_CONTENT_TYPE"
    : "UNEXPECTED_CONTENT_TYPE";
}

async function minimalGet(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: { range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(10000)
  });

  await response.body?.cancel();
  return { response, method: "GET_RANGE_0_0" };
}

async function probePreview(url, preferredMethod) {
  if (preferredMethod === "GET_RANGE_0_0") {
    const { response, method } = await minimalGet(url);
    const contentType = response.headers.get("content-type");

    return {
      attempted: true,
      method,
      httpStatus: response.status,
      httpOk: response.ok,
      contentType,
      browserPlayback: browserPlaybackStatus(contentType),
      corsStatus: corsStatus(response)
    };
  }

  let response = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    signal: AbortSignal.timeout(10000)
  });
  let method = "HEAD";

  if (response.status === 405 || response.status === 501) {
    ({ response, method } = await minimalGet(url));
  }

  const contentType = response.headers.get("content-type");

  return {
    attempted: true,
    method,
    httpStatus: response.status,
    httpOk: response.ok,
    contentType,
    browserPlayback: browserPlaybackStatus(contentType),
    corsStatus: corsStatus(response)
  };
}

function unavailableSongResult(song) {
  return {
    id: song.id,
    songName: song.songName,
    artist: song.artist,
    found: false,
    confidence: null,
    titleScore: null,
    artistScore: null,
    status: "PROVIDER_UNAVAILABLE",
    matchedSongName: null,
    matchedArtist: null,
    previewAvailable: false,
    urlPersistence: "UNKNOWN",
    previewProbe: { attempted: false },
    result: "PROVIDER_UNAVAILABLE_MISSING_CREDENTIALS"
  };
}

async function probeSong(song, profile) {
  try {
    const rawCandidate = await profile.provider.searchTrack(song);
    const candidate = normalizeProviderCandidate(
      profile.provider.name,
      rawCandidate
    );

    if (!candidate) {
      return {
        id: song.id,
        songName: song.songName,
        artist: song.artist,
        found: false,
        confidence: 0,
        titleScore: 0,
        artistScore: 0,
        status: "NOT_FOUND",
        matchedSongName: null,
        matchedArtist: null,
        previewAvailable: false,
        urlPersistence: "UNKNOWN",
        previewProbe: { attempted: false },
        result: profile.missingResult
      };
    }

    const score = scoreTrackMatch(song, candidate);
    const classification = classifyTrackMatch(score, candidate);
    const previewProbe = candidate.previewUrl
      ? await probePreview(
          candidate.previewUrl,
          candidate.metadata.previewProbeMethod
        )
      : { attempted: false };

    return {
      id: song.id,
      songName: song.songName,
      artist: song.artist,
      found: true,
      confidence: score.confidence,
      titleScore: score.titleScore,
      artistScore: score.artistScore,
      status: classification.status,
      matchedSongName: candidate.matchedSongName,
      matchedArtist: candidate.matchedArtist,
      previewAvailable: Boolean(candidate.previewUrl),
      previewDuration: candidate.duration,
      urlPersistence: profile.urlPersistence,
      previewProbe,
      result:
        candidate.previewUrl
          ? "CANDIDATE_WITH_PLAYABLE_SOURCE"
          : "CANDIDATE_WITHOUT_PLAYABLE_SOURCE"
    };
  } catch (error) {
    return {
      id: song.id,
      songName: song.songName,
      artist: song.artist,
      found: false,
      confidence: null,
      titleScore: null,
      artistScore: null,
      status: "PROVIDER_ERROR",
      matchedSongName: null,
      matchedArtist: null,
      previewAvailable: false,
      urlPersistence: "UNKNOWN",
      previewProbe: { attempted: false },
      result: "PROVIDER_REQUEST_FAILED",
      errorMessage:
        error instanceof Error ? error.message : "Unknown provider error"
    };
  }
}

async function probeProvider(profile, songs) {
  const available = profile.provider.isAvailable();
  const results = [];

  if (available) {
    for (const song of songs) {
      results.push(await probeSong(song, profile));
      await sleep(REQUEST_DELAY_MS);
    }
  } else {
    results.push(...songs.map(unavailableSongResult));
  }

  const attempted = available ? results.length : 0;
  const found = results.filter((song) => song.found).length;
  const previews = results.filter(
    (song) => song.previewAvailable
  ).length;
  const corsResults = results
    .map((song) => song.previewProbe?.corsStatus)
    .filter(Boolean);

  return {
    provider: profile.displayName,
    implementation: "EXPERIMENTAL_NOT_REGISTERED",
    accessStatus:
      available
        ? profile.accessStatusWhenAvailable
        : "UNAVAILABLE_MISSING_CREDENTIALS",
    credentialRequired: profile.credentialRequired,
    credentialPresent: available,
    previewSupported: profile.previewSupported,
    previewDuration: profile.previewDuration,
    catalogCoverage:
      available
        ? `${found}/${attempted}`
        : "NOT_TESTED_MISSING_CREDENTIALS",
    apiSuitability: profile.apiSuitability,
    urlPersistence: profile.urlPersistence,
    corsStatus:
      corsResults.length > 0
        ? [...new Set(corsResults)]
        : "NOT_TESTED",
    licensingClassification: profile.licensingClassification,
    productionRecommendation: profile.productionRecommendation,
    requiresBackendProxy: profile.requiresBackendProxy,
    documentation: profile.documentation,
    summary: {
      requested: songs.length,
      attempted,
      found,
      previewAvailable: previews
    },
    songs: results
  };
}

function appleResearchRecord() {
  return {
    provider: "Apple iTunes Search API",
    implementation: "RESEARCH_ONLY_NO_PROVIDER_IMPLEMENTATION",
    accessStatus: "PUBLIC_SEARCH_API",
    credentialRequired: [],
    credentialPresent: true,
    previewSupported: "TECHNICALLY_POSSIBLE",
    previewDuration: "APPROXIMATELY_30_SECONDS",
    catalogCoverage: "NOT_TESTED_BY_POLICY",
    apiSuitability: "TECHNICALLY_POSSIBLE_PRODUCTION_UNSUITABLE",
    urlPersistence: "NOT_EVALUATED",
    corsStatus: "NOT_TESTED",
    licensingClassification: "C",
    productionRecommendation: "DO_NOT_USE_FOR_GAMEPLAY",
    requiresBackendProxy: false,
    documentation: [
      "https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/index.html"
    ],
    summary: {
      requested: 0,
      attempted: 0,
      found: 0,
      previewAvailable: 0
    },
    songs: []
  };
}

export async function runProviderFeasibilityProbe() {
  const songs = readFixture();
  const providers = [];

  for (const profile of providerProfiles) {
    providers.push(await probeProvider(profile, songs));
  }

  providers.push(appleResearchRecord());

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    purpose: "SPRINT_23D_FEASIBILITY_ONLY",
    sourceFixture: path.relative(projectRoot, FIXTURE_FILE),
    constraints: {
      writesFormalSongData: false,
      writesFirestore: false,
      downloadsAudio: false,
      registersProductionProvider: false,
      maximumSongsPerProvider: 5,
      concurrency: 1,
      requestDelayMs: REQUEST_DELAY_MS
    },
    testSongs: songs,
    providers,
    recommendation: {
      forMainstreamMandarinCatalog:
        "SEEK_COMMERCIAL_CATALOG_AND_PLAYBACK_AGREEMENT",
      preferredCandidate:
        "7DIGITAL_MASSIVEMUSIC_AFTER_COMMERCIAL_ACCESS",
      fallbackCandidate:
        "LICENSED_AUDIO_ASSETS_IN_CONTROLLED_STORAGE",
      jamendo:
        "TECHNICALLY_COMPATIBLE_BUT_CATALOG_COVERAGE_UNPROVEN",
      apple:
        "TECHNICALLY_POSSIBLE_PRODUCTION_UNSUITABLE"
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );

  providers.forEach((provider) => {
    console.log(
      `${provider.provider}: ${provider.accessStatus}; ` +
      `found ${provider.summary.found}/${provider.summary.attempted}`
    );
  });
  console.log(
    `Report: ${path.relative(projectRoot, OUTPUT_FILE)}`
  );

  return report;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  runProviderFeasibilityProbe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
