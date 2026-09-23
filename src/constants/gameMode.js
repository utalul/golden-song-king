export const PLAYABLE_GAME_MODES = Object.freeze({
  SONG_NAME: "songName",
  ARTIST: "artist",
  RANDOM: "random",
});

export const PLAYABLE_GAME_MODE_VALUES = Object.freeze([
  PLAYABLE_GAME_MODES.SONG_NAME,
  PLAYABLE_GAME_MODES.ARTIST,
  PLAYABLE_GAME_MODES.RANDOM,
]);

export const GAME_MODE_LABELS = {
  [PLAYABLE_GAME_MODES.SONG_NAME]: "🎵 猜歌名",
  [PLAYABLE_GAME_MODES.ARTIST]: "🎤 猜歌手",
  [PLAYABLE_GAME_MODES.RANDOM]: "🎲 隨機模式",
};

export function getEffectiveGameMode(gameMode) {
  return Object.hasOwn(GAME_MODE_LABELS, gameMode)
    ? gameMode
    : PLAYABLE_GAME_MODES.RANDOM;
}

export function getQuestionMode(gameMode) {
  const effectiveMode = getEffectiveGameMode(gameMode);

  if (effectiveMode === PLAYABLE_GAME_MODES.SONG_NAME) {
    return PLAYABLE_GAME_MODES.SONG_NAME;
  }

  if (effectiveMode === PLAYABLE_GAME_MODES.ARTIST) {
    return PLAYABLE_GAME_MODES.ARTIST;
  }

  return Math.random() < 0.5
    ? PLAYABLE_GAME_MODES.SONG_NAME
    : PLAYABLE_GAME_MODES.ARTIST;
}

export const CATEGORY_LABELS = {
  all: "🎵 全部歌曲",
  mandarin: "🇹🇼 華語流行",
  taiwanese: "🎤 台語經典",
  western: "🌍 西洋歌曲",
  anime: "🎌 動漫歌曲",
  kpop: "🇰🇷 K-POP",
};
