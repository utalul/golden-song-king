import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getEffectiveGameMode,
  getQuestionMode,
  PLAYABLE_GAME_MODES,
  PLAYABLE_GAME_MODE_VALUES
} from "../src/constants/gameMode.js";

test("fixed song title mode always selects songName", () => {
  assert.equal(
    getQuestionMode(PLAYABLE_GAME_MODES.SONG_NAME),
    PLAYABLE_GAME_MODES.SONG_NAME
  );
});

test("fixed artist mode always selects artist", () => {
  assert.equal(
    getQuestionMode(PLAYABLE_GAME_MODES.ARTIST),
    PLAYABLE_GAME_MODES.ARTIST
  );
});

test("random mode selects only playable question types", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.ok([
      PLAYABLE_GAME_MODES.SONG_NAME,
      PLAYABLE_GAME_MODES.ARTIST
    ].includes(getQuestionMode(PLAYABLE_GAME_MODES.RANDOM)));
  }
});

test("legacy and missing game modes safely fall back to random", () => {
  assert.equal(getEffectiveGameMode("lyric"), PLAYABLE_GAME_MODES.RANDOM);
  assert.equal(getEffectiveGameMode(undefined), PLAYABLE_GAME_MODES.RANDOM);
  assert.ok([
    PLAYABLE_GAME_MODES.SONG_NAME,
    PLAYABLE_GAME_MODES.ARTIST
  ].includes(getQuestionMode("lyric")));
});

test("playable game modes exclude lyric", () => {
  assert.deepEqual(PLAYABLE_GAME_MODE_VALUES, ["songName", "artist", "random"]);
  assert.equal(PLAYABLE_GAME_MODE_VALUES.includes("lyric"), false);
});
