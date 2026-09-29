import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { GAME_CONFIG } from "../src/config/gameConfig.js";
import { GAME_PHASES } from "../src/constants/gamePhases.js";

const gameSource = readFileSync(
  new URL("../src/pages/Game.jsx", import.meta.url),
  "utf8"
);

function sourceBetween(start, end) {
  const startIndex = gameSource.indexOf(start);
  const endIndex = gameSource.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);

  return gameSource.slice(startIndex, endIndex);
}

test("Sprint21 phase durations remain 30s, 30s, and 5s", () => {
  assert.equal(GAME_CONFIG.PLAY_TIME, 30);
  assert.equal(GAME_CONFIG.ANSWER_TIME, 30);
  assert.match(gameSource, /const REVEAL_TIME = 5/);
});

test("phase transition implementation preserves the authoritative flow", () => {
  const revealAnswer = sourceBetween(
    "const revealAnswer = useCallback",
    "const nextQuestion = useCallback"
  );
  const nextQuestion = sourceBetween(
    "const nextQuestion = useCallback",
    "  useEffect(() => {"
  );

  assert.match(revealAnswer, /roomData\.gamePhase !== GAME_PHASES\.ANSWERING/);
  assert.match(revealAnswer, /gamePhase:\s*GAME_PHASES\.REVEAL/);
  assert.match(nextQuestion, /roomData\.gamePhase !== GAME_PHASES\.REVEAL/);
  assert.match(nextQuestion, /gamePhase:\s*GAME_PHASES\.PLAYING/);
  assert.equal(GAME_PHASES.PLAYING, "PLAYING");
  assert.equal(GAME_PHASES.ANSWERING, "ANSWERING");
  assert.equal(GAME_PHASES.REVEAL, "REVEAL");
});

test("stale timer race protection remains present", () => {
  assert.match(gameSource, /timerPhaseKeyRef/);
  assert.match(gameSource, /phaseAdvanceRef/);
  assert.match(gameSource, /revealTimeoutKeyRef/);
  assert.match(gameSource, /phaseAdvanceRef\.current\s*===\s*phaseKey/);
  assert.match(gameSource, /timerPhaseKeyRef\.current\s*!==\s*phaseKey/);
});

test("phase transitions are host-authoritative and deduplicated", () => {
  const revealAnswer = sourceBetween(
    "const revealAnswer = useCallback",
    "const nextQuestion = useCallback"
  );
  const nextQuestion = sourceBetween(
    "const nextQuestion = useCallback",
    "  useEffect(() => {"
  );

  assert.match(revealAnswer, /authorizeHost\(\)/);
  assert.match(nextQuestion, /authorizeHost\(\)/);
  assert.match(gameSource, /phaseAdvanceRef\.current/);
  assert.match(gameSource, /revealTimeoutKeyRef\.current/);
});

test("next-question flow preserves queue semantics and avoids per-question random selection", () => {
  const nextQuestion = sourceBetween(
    "const nextQuestion = useCallback",
    "  useEffect(() => {"
  );

  assert.match(nextQuestion, /roomData\.songQueue/);
  assert.match(nextQuestion, /songQueue\s*=\s*\n?\s*\[\.\.\.\(roomData\.songQueue/);
  assert.match(nextQuestion, /songQueue\.shift\(\)/);
  assert.match(nextQuestion, /getQuestionMode\(roomData\.gameMode\)/);
  assert.doesNotMatch(nextQuestion, /Math\.random/);
});

test("scoring implementation is outside the regression change and remains present", () => {
  assert.match(gameSource, /scored/);
  assert.match(gameSource, /increment\(1\)/);
});
