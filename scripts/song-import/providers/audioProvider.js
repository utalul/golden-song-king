export function assertAudioProvider(provider) {
  if (
    !provider ||
    typeof provider.name !== "string" ||
    typeof provider.searchTrack !== "function"
  ) {
    throw new TypeError(
      "Audio provider 必須提供 name 與 async searchTrack()。"
    );
  }

  return provider;
}

export function normalizeProviderCandidate(providerName, candidate) {
  if (candidate === null) {
    return null;
  }

  if (!candidate || typeof candidate !== "object") {
    throw new TypeError(
      "Provider result 必須是 object 或 null。"
    );
  }

  const requiredStringFields = [
    "providerTrackId",
    "matchedSongName",
    "matchedArtist"
  ];

  requiredStringFields.forEach((field) => {
    if (
      typeof candidate[field] !== "string" ||
      !candidate[field].trim()
    ) {
      throw new TypeError(
        `Provider result 缺少有效的 ${field}。`
      );
    }
  });

  if (
    candidate.previewUrl !== null &&
    candidate.previewUrl !== undefined &&
    typeof candidate.previewUrl !== "string"
  ) {
    throw new TypeError(
      "Provider result previewUrl 必須是字串或 null。"
    );
  }

  if (
    candidate.duration !== null &&
    candidate.duration !== undefined &&
    (
      typeof candidate.duration !== "number" ||
      !Number.isFinite(candidate.duration)
    )
  ) {
    throw new TypeError(
      "Provider result duration 必須是有限數字或 null。"
    );
  }

  return {
    provider: candidate.provider || providerName,
    providerTrackId: candidate.providerTrackId.trim(),
    matchedSongName: candidate.matchedSongName.trim(),
    matchedArtist: candidate.matchedArtist.trim(),
    previewUrl: candidate.previewUrl?.trim() || null,
    duration: candidate.duration ?? null,
    metadata:
      candidate.metadata && typeof candidate.metadata === "object"
        ? candidate.metadata
        : {}
  };
}
