import { getSongIdentityKey } from "./normalizeSongs.js";

const CANONICAL_ID_PATTERN = /^M\d{6}$/;

function issue(code, message) {
  return { code, message };
}

function validateOptionalString(song, field, errors) {
  if (
    song[field] !== undefined &&
    typeof song[field] !== "string"
  ) {
    errors.push(
      issue(
        "INVALID_FIELD_TYPE",
        `${field} 必須是字串。`
      )
    );
  }
}

export function validateSong(song, rawInput) {
  const warnings = [];
  const errors = [];

  if (
    !rawInput ||
    typeof rawInput !== "object" ||
    Array.isArray(rawInput)
  ) {
    errors.push(
      issue(
        "INVALID_RECORD_TYPE",
        "歌曲資料必須是 JSON object。"
      )
    );
  }

  if (
    typeof song.songName !== "string" ||
    !song.songName
  ) {
    errors.push(
      issue("MISSING_SONG_NAME", "songName 不可空白。")
    );
  }

  if (
    typeof song.artist !== "string" ||
    !song.artist
  ) {
    errors.push(
      issue("MISSING_ARTIST", "artist 不可空白。")
    );
  }

  validateOptionalString(song, "id", errors);
  validateOptionalString(song, "category", errors);
  validateOptionalString(song, "decade", errors);
  validateOptionalString(song, "spotifyId", errors);
  validateOptionalString(song, "previewUrl", errors);

  if (
    song.difficulty !== undefined &&
    (
      typeof song.difficulty !== "number" ||
      !Number.isFinite(song.difficulty)
    )
  ) {
    errors.push(
      issue(
        "INVALID_DIFFICULTY",
        "difficulty 必須是有限數字。"
      )
    );
  }

  if (
    typeof song.id === "string" &&
    !CANONICAL_ID_PATTERN.test(song.id)
  ) {
    warnings.push(
      issue(
        "NON_CANONICAL_ID",
        "id 不符合目前 M000001 格式，已保留原值。"
      )
    );
  }

  return { warnings, errors };
}

export function findDuplicateGroups(records, keySelector) {
  const groups = new Map();

  records.forEach((record, index) => {
    const key = keySelector(record);

    if (!key) {
      return;
    }

    const indexes = groups.get(key) || [];
    indexes.push(index);
    groups.set(key, indexes);
  });

  return new Map(
    [...groups.entries()].filter(
      ([, indexes]) => indexes.length > 1
    )
  );
}

export function findIncomingDuplicates(songs) {
  return {
    id: findDuplicateGroups(
      songs,
      (song) => song.id || ""
    ),
    identity: findDuplicateGroups(
      songs,
      getSongIdentityKey
    ),
    spotifyId: findDuplicateGroups(
      songs,
      (song) => song.spotifyId || ""
    ),
    previewUrl: findDuplicateGroups(
      songs,
      (song) => song.previewUrl || ""
    )
  };
}

export function indexesForDuplicateGroups(groups) {
  return new Set(
    [...groups.values()].flat()
  );
}
