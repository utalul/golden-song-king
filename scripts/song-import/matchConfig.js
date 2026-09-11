export const MATCH_CONFIG = Object.freeze({
  titleWeight: 0.65,
  artistWeight: 0.35,
  autoApproveThreshold: 0.95,
  reviewThreshold: 0.72,
  defaultConcurrency: 4
});

export const AUDIO_MATCH_STATUSES = Object.freeze({
  AUTO_APPROVED: "AUTO_APPROVED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  NOT_FOUND: "NOT_FOUND",
  PROVIDER_ERROR: "PROVIDER_ERROR"
});
