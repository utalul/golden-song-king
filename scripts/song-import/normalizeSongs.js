export const CANONICAL_SONG_FIELDS = Object.freeze([
  "id",
  "songName",
  "artist",
  "category",
  "decade",
  "difficulty",
  "spotifyId",
  "previewUrl"
]);

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalizedValue = value.trim();

  return normalizedValue || undefined;
}

function normalizeDifficulty(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return value;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const numericValue = Number(normalizedValue);

  return Number.isFinite(numericValue)
    ? numericValue
    : normalizedValue;
}

export function normalizeSong(input) {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? input
      : {};

  const songName =
    normalizeOptionalString(source.songName) ??
    normalizeOptionalString(source.title);

  return {
    id: normalizeOptionalString(source.id),
    songName,
    artist: normalizeOptionalString(source.artist),
    category: normalizeOptionalString(source.category),
    decade: normalizeOptionalString(source.decade),
    difficulty: normalizeDifficulty(source.difficulty),
    spotifyId: normalizeOptionalString(source.spotifyId),
    previewUrl: normalizeOptionalString(source.previewUrl)
  };
}

export function normalizeSongs(inputs) {
  return inputs.map((input) => normalizeSong(input));
}

function normalizeIdentityPart(value) {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("zh-TW")
    : "";
}

export function getSongIdentityKey(song) {
  const songName = normalizeIdentityPart(song.songName);
  const artist = normalizeIdentityPart(song.artist);

  if (!songName || !artist) {
    return "";
  }

  return `${songName}\u0000${artist}`;
}

export function toSerializableSong(song) {
  return Object.fromEntries(
    CANONICAL_SONG_FIELDS
      .filter((field) => song[field] !== undefined)
      .map((field) => [field, song[field]])
  );
}
