import {
  AUDIO_MATCH_STATUSES,
  MATCH_CONFIG
} from "./matchConfig.js";

const BRACKET_PATTERN = /[()[\]{}<>\u3008-\u3011\u3014-\u301B]/g;

export function normalizeMatchText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(BRACKET_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(left, right) {
  if (!left) return right.length;
  if (!right) return left.length;

  let previousRow = Array.from(
    { length: right.length + 1 },
    (_, index) => index
  );

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const currentRow = [leftIndex];

    for (
      let rightIndex = 1;
      rightIndex <= right.length;
      rightIndex += 1
    ) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? 0
          : 1;

      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + substitutionCost
      );
    }

    previousRow = currentRow;
  }

  return previousRow[right.length];
}

function textSimilarity(left, right) {
  const normalizedLeft = normalizeMatchText(left);
  const normalizedRight = normalizeMatchText(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  const maximumLength = Math.max(
    normalizedLeft.length,
    normalizedRight.length
  );
  const distance = levenshteinDistance(
    normalizedLeft,
    normalizedRight
  );

  return Math.max(0, 1 - distance / maximumLength);
}

function scoreReason(field, score) {
  if (score === 1) {
    return `${field}_EXACT`;
  }

  if (score >= 0.6) {
    return `${field}_SIMILAR`;
  }

  return `${field}_WEAK`;
}

function roundScore(score) {
  return Number(score.toFixed(4));
}

export function scoreTrackMatch(requestedSong, candidate) {
  const titleScore = textSimilarity(
    requestedSong.songName,
    candidate.matchedSongName
  );
  const artistScore = textSimilarity(
    requestedSong.artist,
    candidate.matchedArtist
  );
  const confidence =
    titleScore * MATCH_CONFIG.titleWeight +
    artistScore * MATCH_CONFIG.artistWeight;

  return {
    confidence: roundScore(confidence),
    titleScore: roundScore(titleScore),
    artistScore: roundScore(artistScore),
    reasons: [
      scoreReason("TITLE", titleScore),
      scoreReason("ARTIST", artistScore)
    ]
  };
}

export function classifyTrackMatch(score, candidate) {
  const reasons = [...score.reasons];
  const hasPreviewUrl =
    typeof candidate.previewUrl === "string" &&
    candidate.previewUrl.trim() !== "";
  const isAmbiguous = candidate.metadata?.ambiguous === true;

  if (isAmbiguous) {
    reasons.push("PROVIDER_RESULT_AMBIGUOUS");
  }

  if (!hasPreviewUrl) {
    reasons.push("PREVIEW_URL_MISSING");
  }

  if (
    score.confidence >= MATCH_CONFIG.autoApproveThreshold &&
    hasPreviewUrl &&
    !isAmbiguous
  ) {
    return {
      status: AUDIO_MATCH_STATUSES.AUTO_APPROVED,
      reasons
    };
  }

  if (
    score.confidence >= MATCH_CONFIG.reviewThreshold ||
    isAmbiguous
  ) {
    return {
      status: AUDIO_MATCH_STATUSES.REVIEW_REQUIRED,
      reasons
    };
  }

  reasons.push("CONFIDENCE_BELOW_REVIEW_THRESHOLD");

  return {
    status: AUDIO_MATCH_STATUSES.NOT_FOUND,
    reasons
  };
}
