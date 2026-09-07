import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  increment
} from "firebase/firestore";

import { db } from "../firebase/firebase";

import Page from "../components/ui/Page";
import Logo from "../components/ui/Logo";
import Card from "../components/ui/Card";
import DevModeBadge from "../components/game/DevModeBadge";
import ScoreBoard from "../components/game/ScoreBoard";
import QuestionCard from "../components/game/QuestionCard";
import CountdownCard from "../components/game/CountdownCard";
import AnswerInput from "../components/game/AnswerInput";
import WaitingCard from "../components/game/WaitingCard";
import AnswerStatusCard from "../components/game/AnswerStatusCard";
import RevealCard from "../components/game/RevealCard";
import RankingCard from "../components/game/RankingCard";
import WinnerDialog from "../components/game/WinnerDialog";
import DeveloperPanel from "../components/game/DeveloperPanel";
import HostControlCard from "../components/game/HostControlCard";
import LoadingCard from "../components/game/LoadingCard";
import AudioPlayer from "../components/game/AudioPlayer";
import { DEV_MODE } from "../constants/game";
import { GAME_PHASES } from "../constants/gamePhases";
import {
  GAME_CONFIG,
  SONG_COLLECTION
} from "../config/gameConfig";

const MODES = [
  "songName",
  "artist"
];

const REVEAL_TIME = 5;

function shuffleSongs(songs) {
  const shuffledSongs = [...songs];

  for (let index = shuffledSongs.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(
      Math.random() * (index + 1)
    );

    [
      shuffledSongs[index],
      shuffledSongs[randomIndex]
    ] = [
      shuffledSongs[randomIndex],
      shuffledSongs[index]
    ];
  }

  return shuffledSongs;
}

function getRandomMode() {
  return MODES[
    Math.floor(
      Math.random() * MODES.length
    )
  ];
}

function getPhaseTime(gamePhase) {
  if (gamePhase === GAME_PHASES.ANSWERING) {
    return GAME_CONFIG.ANSWER_TIME;
  }

  if (gamePhase === GAME_PHASES.REVEAL) {
    return REVEAL_TIME;
  }

  return GAME_CONFIG.PLAY_TIME;
}

export default function Game() {
  const roomId =
    localStorage.getItem("roomId") || "";

  const playerName =
    localStorage.getItem("playerName") || "";

  const isHost =
    localStorage.getItem("isHost") === "true";

  const nextQuestionTimerRef =
    useRef(null);

  const nextQuestionRef =
    useRef(null);

  const revealTimeoutKeyRef =
    useRef("");

  const queueInitRef =
    useRef(false);

  const phaseAdvanceRef =
    useRef("");

  const timerPhaseKeyRef =
    useRef("");

  const [answer, setAnswer] =
    useState("");

  const [submitted, setSubmitted] =
    useState(false);

  const [answers, setAnswers] =
    useState([]);

  const [players, setPlayers] =
    useState([]);

  const [roomData, setRoomData] =
    useState(null);

  const [roomDocId, setRoomDocId] =
    useState("");

  const [song, setSong] =
    useState(null);

  const [timeLeft, setTimeLeft] =
    useState(GAME_CONFIG.PLAY_TIME);

  const gamePhase =
    roomData?.gamePhase ||
    GAME_PHASES.PLAYING;

  const isPlayingPhase =
    gamePhase === GAME_PHASES.PLAYING;

  const isAnsweringPhase =
    gamePhase === GAME_PHASES.ANSWERING;

  const isRevealPhase =
    gamePhase === GAME_PHASES.REVEAL;

  const questionKey =
    roomData
      ? `${roomData.gameRound}-${roomData.currentQuestion}-${roomData.currentSongId}`
      : "";

  const phaseKey =
    `${questionKey}-${gamePhase}`;

  const currentAnswers =
    roomData
      ? answers.filter(
          (answerData) =>
            answerData.gameRound ===
              roomData.gameRound &&
            answerData.questionNumber ===
              roomData.currentQuestion
        )
      : [];

  const allAnswered =
    players.length > 0 &&
    currentAnswers.length >= players.length;

  const timeExpired =
    timeLeft <= 0;

  const resetPhaseTimer = useCallback((phase) => {
    setTimeLeft(
      getPhaseTime(phase)
    );
  }, []);

  const fetchSongQueue = useCallback(async () => {
    const songsRef =
      collection(db, SONG_COLLECTION);

    const snapshot =
      DEV_MODE
        ? await getDocs(
            query(
              songsRef,
              where("isTest", "==", true)
            )
          )
        : await getDocs(songsRef);

    const songs = [];

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if (
        !DEV_MODE &&
        data.isTest === true
      ) {
        return;
      }

      songs.push({
        id: docSnap.id,
        ...data
      });
    });

    return shuffleSongs(songs);
  }, []);

  const createQuestionState = useCallback((songQueue) => {
    const nextSong =
      songQueue.shift();

    if (!nextSong) {
      return null;
    }

    return {
      currentSongId: nextSong.id,
      currentMode: getRandomMode(),
      songQueue: songQueue.map(
        (queueSong) => queueSong.id
      ),
      gamePhase: GAME_PHASES.PLAYING,
      phaseStartedAt: Date.now(),
      answerRevealed: false,
      scored: false
    };
  }, []);

  useEffect(() => {
    if (!roomId) return;

    const roomQuery = query(
      collection(db, "rooms"),
      where("roomId", "==", roomId)
    );

    const unsubscribeRoom =
      onSnapshot(
        roomQuery,
        (snapshot) => {
          snapshot.forEach(
            async (docSnap) => {
              const room =
                docSnap.data();

              setRoomDocId(
                docSnap.id
              );

              setRoomData(room);

              if (
                room.currentSongId
              ) {
                const songRef = doc(
                  db,
                  SONG_COLLECTION,
                  room.currentSongId
                );

                const songSnap =
                  await getDoc(
                    songRef
                  );

                if (
                  songSnap.exists()
                ) {
                  setSong({
                    id:
                      songSnap.id,
                    ...songSnap.data()
                  });
                }
              } else {
                setSong(null);
              }
            }
          );
        }
      );

    const playerQuery = query(
      collection(db, "players"),
      where("roomId", "==", roomId)
    );

    const unsubscribePlayers =
      onSnapshot(
        playerQuery,
        (snapshot) => {
          const list = [];

          snapshot.forEach(
            (docSnap) => {
              list.push({
                id: docSnap.id,
                ...docSnap.data()
              });
            }
          );

          setPlayers(list);
        }
      );

    return () => {
      unsubscribeRoom();
      unsubscribePlayers();
    };
  }, [roomId]);

  useEffect(() => {
    if (!isHost)
      return;

    if (!roomDocId)
      return;

    if (!roomData)
      return;

    if (roomData.status !== "playing")
      return;

    if (
      Array.isArray(roomData.songQueue) &&
      roomData.gamePhase
    ) {
      return;
    }

    if (queueInitRef.current)
      return;

    queueInitRef.current = true;

    async function initializeSongQueue() {
      const songQueue =
        await fetchSongQueue();

      const questionState =
        createQuestionState(songQueue);

      if (!questionState)
        return;

      await updateDoc(
        doc(
          db,
          "rooms",
          roomDocId
        ),
        {
          ...questionState,
          currentQuestion:
            roomData.currentQuestion || 1
        }
      );
    }

    initializeSongQueue();
  }, [
    createQuestionState,
    fetchSongQueue,
    isHost,
    roomData,
    roomDocId
  ]);

  useEffect(() => {
    if (!roomData) return;

    const answerQuery = query(
      collection(db, "answers"),

      where(
        "roomId",
        "==",
        roomId
      ),

      where(
        "gameRound",
        "==",
        roomData.gameRound
      ),

      where(
        "questionNumber",
        "==",
        roomData.currentQuestion
      )
    );

    const unsubscribeAnswers =
      onSnapshot(
        answerQuery,
        (snapshot) => {
          const list = [];

          snapshot.forEach(
            (docSnap) => {
              list.push({
                id: docSnap.id,
                ...docSnap.data()
              });
            }
          );

          setAnswers(list);
        }
      );

    return () =>
      unsubscribeAnswers();
  }, [
    roomId,
    roomData
  ]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setSubmitted(false);
    setAnswer("");
    setAnswers([]);
    phaseAdvanceRef.current = "";
    timerPhaseKeyRef.current = "";
    revealTimeoutKeyRef.current = "";
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    questionKey
  ]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    timerPhaseKeyRef.current = "";
    resetPhaseTimer(gamePhase);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    gamePhase,
    phaseKey,
    resetPhaseTimer
  ]);

  useEffect(() => {
    if (timeLeft !== getPhaseTime(gamePhase))
      return;

    timerPhaseKeyRef.current = phaseKey;
  }, [
    gamePhase,
    phaseKey,
    timeLeft
  ]);

  useEffect(() => {
    if (isRevealPhase)
      return;

    if (roomData?.winner)
      return;

    if (timeLeft <= 0)
      return;

    const timer = window.setInterval(
      () => {
        setTimeLeft(
          (currentTime) => {
            const nextTime = Math.max(
              currentTime - 1,
              0
            );

            return nextTime;
          }
        );
      },
      1000
    );

    return () =>
      window.clearInterval(timer);
  }, [
    isRevealPhase,
    roomData?.winner,
    timeLeft
  ]);

  const submitAnswer =
    async () => {
      if (!answer) return;

      if (!isAnsweringPhase) return;

      if (submitted) return;

      if (!roomData) return;

      await addDoc(
        collection(
          db,
          "answers"
        ),
        {
          roomId,
          playerName,

          answer,

          gameRound:
            roomData.gameRound,

          questionNumber:
            roomData.currentQuestion,

          createdAt:
            Date.now()
        }
      );

      setSubmitted(true);
    };

  const revealAnswer = useCallback(async () => {
    if (!roomDocId)
      return;

    if (!roomData)
      return;

    if (!song)
      return;

    if (roomData.scored)
      return;

    if (
      roomData.gamePhase !== GAME_PHASES.ANSWERING &&
      !DEV_MODE
    )
      return;

    const correctAnswer =
      roomData.currentMode ===
      "artist"
        ? song.artist
        : song.songName;

    const scoreGain =
      DEV_MODE ? GAME_CONFIG.WIN_SCORE : 1;

    const answersForQuestion =
      answers.filter(
        (answerData) =>
          answerData.gameRound ===
            roomData.gameRound &&
          answerData.questionNumber ===
            roomData.currentQuestion
      );

    for (const answerData of answersForQuestion) {
      const userAnswer =
        answerData.answer
          .trim()
          .toLowerCase();

      const correct =
        correctAnswer
          .trim()
          .toLowerCase();

      if (
        userAnswer === correct
      ) {
        const targetPlayer =
          players.find(
            (player) =>
              player.name ===
              answerData.playerName
          );

        if (targetPlayer) {
          await updateDoc(
            doc(
              db,
              "players",
              targetPlayer.id
            ),
            {
              score:
                increment(scoreGain)
            }
          );

          const updatedScore =
            targetPlayer.score + scoreGain;

          if (
            updatedScore >= GAME_CONFIG.WIN_SCORE
          ) {
            await updateDoc(
              doc(
                db,
                "rooms",
                roomDocId
              ),
              {
                winner:
                  targetPlayer.name
              }
            );
          }
        }
      }
    }

    await updateDoc(
      doc(
        db,
        "rooms",
        roomDocId
      ),
      {
        answerRevealed: true,
        scored: true,
        gamePhase: GAME_PHASES.REVEAL,
        phaseStartedAt: Date.now()
      }
    );
  }, [
    answers,
    players,
    roomData,
    roomDocId,
    song
  ]);

  const nextQuestion = useCallback(async () => {
    if (!roomDocId)
      return;

    if (!roomData)
      return;

    if (
      roomData.gamePhase !== GAME_PHASES.REVEAL &&
      !DEV_MODE
    )
      return;

    const songQueue =
      [...(roomData.songQueue || [])];

    const nextSongId =
      songQueue.shift();

    if (!nextSongId)
      return;

    await updateDoc(
      doc(
        db,
        "rooms",
        roomDocId
      ),
      {
        currentQuestion:
          roomData.currentQuestion + 1,

        currentSongId:
          nextSongId,

        currentMode:
          getRandomMode(),

        songQueue,

        gamePhase:
          GAME_PHASES.PLAYING,

        phaseStartedAt:
          Date.now(),

        answerRevealed:
          false,

        scored: false
      }
    );

    setAnswer("");
    setSubmitted(false);
    resetPhaseTimer(GAME_PHASES.PLAYING);
  }, [
    resetPhaseTimer,
    roomData,
    roomDocId
  ]);

  const advanceToAnswering = useCallback(async () => {
    if (!roomDocId)
      return;

    if (!roomData)
      return;

    if (
      roomData.gamePhase !== GAME_PHASES.PLAYING
    )
      return;

    try {
      await updateDoc(
        doc(
          db,
          "rooms",
          roomDocId
        ),
        {
          gamePhase:
            GAME_PHASES.ANSWERING,
          phaseStartedAt:
            Date.now()
        }
      );
    } catch (error) {
      console.error(
        "advanceToAnswering failed",
        error
      );
    }
  }, [
    roomData,
    roomDocId
  ]);

  useEffect(() => {
    if (!isHost)
      return;

    if (!roomDocId)
      return;

    if (!roomData)
      return;

    if (roomData.winner)
      return;

    if (timeLeft > 0)
      return;

    if (timerPhaseKeyRef.current !== phaseKey)
      return;

    if (phaseAdvanceRef.current === phaseKey)
      return;

    phaseAdvanceRef.current = phaseKey;

    if (isPlayingPhase) {
      advanceToAnswering();
      return;
    }

    if (isAnsweringPhase) {
      revealAnswer();
    }
  }, [
    advanceToAnswering,
    gamePhase,
    isAnsweringPhase,
    isHost,
    isPlayingPhase,
    phaseKey,
    revealAnswer,
    roomData,
    roomDocId,
    timeLeft
  ]);

  useEffect(() => {
    nextQuestionRef.current = nextQuestion;
  }, [
    nextQuestion
  ]);

  useEffect(() => {
    if (!isHost)
      return;

    if (!isRevealPhase)
      return;

    if (roomData?.winner)
      return;

    if (
      revealTimeoutKeyRef.current === phaseKey
    )
      return;

    revealTimeoutKeyRef.current = phaseKey;

    if (nextQuestionTimerRef.current) {
      window.clearTimeout(
        nextQuestionTimerRef.current
      );
    }

    nextQuestionTimerRef.current = window.setTimeout(
      () => {
        nextQuestionTimerRef.current = null;
        nextQuestionRef.current?.();
      },
      REVEAL_TIME * 1000
    );

    return () => {
      if (nextQuestionTimerRef.current) {
        window.clearTimeout(
          nextQuestionTimerRef.current
        );

        nextQuestionTimerRef.current = null;
      }
    };
  }, [
    isHost,
    isRevealPhase,
    phaseKey,
    roomData?.winner
  ]);

  const restartGame = async () => {
    if (!roomDocId)
      return;

    if (nextQuestionTimerRef.current) {
      window.clearTimeout(
        nextQuestionTimerRef.current
      );

      nextQuestionTimerRef.current = null;
    }

    queueInitRef.current = false;
    phaseAdvanceRef.current = "";
    timerPhaseKeyRef.current = "";
    revealTimeoutKeyRef.current = "";

    setAnswer("");
    setSubmitted(false);
    setAnswers([]);
    resetPhaseTimer(GAME_PHASES.PLAYING);

    for (const player of players) {
      await updateDoc(
        doc(
          db,
          "players",
          player.id
        ),
        {
          score: 0
        }
      );
    }

    const songQueue =
      await fetchSongQueue();

    const questionState =
      createQuestionState(songQueue);

    if (!questionState)
      return;

    await updateDoc(
      doc(
        db,
        "rooms",
        roomDocId
      ),
      {
        winner: "",

        gameRound:
          (roomData.gameRound || 1) + 1,

        currentQuestion: 1,

        ...questionState
      }
    );
  };

  const devWinCurrentPlayer = async () => {
    if (!DEV_MODE)
      return;

    if (!roomDocId)
      return;

    const targetPlayer =
      players.find(
        (player) =>
          player.name === playerName
      );

    if (!targetPlayer)
      return;

    await updateDoc(
      doc(
        db,
        "players",
        targetPlayer.id
      ),
      {
        score:
          GAME_CONFIG.WIN_SCORE
      }
    );

    await updateDoc(
      doc(
        db,
        "rooms",
        roomDocId
      ),
      {
        winner:
          targetPlayer.name
      }
    );
  };

  const devAddPointToCurrentPlayer = async () => {
    if (!DEV_MODE)
      return;

    if (!roomDocId)
      return;

    const targetPlayer =
      players.find(
        (player) =>
          player.name === playerName
      );

    if (!targetPlayer)
      return;

    await updateDoc(
      doc(
        db,
        "players",
        targetPlayer.id
      ),
      {
        score:
          increment(1)
      }
    );

    const updatedScore =
      targetPlayer.score + 1;

    if (updatedScore >= GAME_CONFIG.WIN_SCORE) {
      await updateDoc(
        doc(
          db,
          "rooms",
          roomDocId
        ),
        {
          winner:
            targetPlayer.name
        }
      );
    }
  };

  const developerPanel = (
    <DeveloperPanel
      enabled={DEV_MODE}
      onAddPoint={devAddPointToCurrentPlayer}
      onWin={devWinCurrentPlayer}
      onReveal={revealAnswer}
      onNext={nextQuestion}
      onRestart={restartGame}
    />
  );

  if (!roomData || !song) {
    return (
      <Page>
        <Logo />

        <DevModeBadge enabled={DEV_MODE} />

        <LoadingCard />

        {developerPanel}
      </Page>
    );
  }

  const modeText =
    roomData.currentMode ===
    "artist"
      ? "猜歌手"
      : "猜歌名";

  const correctAnswer =
    roomData.currentMode ===
    "artist"
      ? song.artist
      : song.songName;

  const scoreGain =
    DEV_MODE ? GAME_CONFIG.WIN_SCORE : 1;

  const currentPlayer =
    players.find(
      (player) =>
        player.name === playerName
    );

  const sortedPlayers =
    [...players].sort(
      (a, b) =>
        b.score - a.score
    );

  const correctPlayers =
    currentAnswers.filter(
      (answerData) =>
        answerData.answer
          .trim()
          .toLowerCase() ===
        correctAnswer
          .trim()
          .toLowerCase()
    );

  const phaseLabel =
    isPlayingPhase
      ? "🎵 播放中"
      : isAnsweringPhase
        ? "✍️ 作答中"
        : "公布答案";

  const timerMax =
    getPhaseTime(gamePhase);

  if (roomData.winner) {
    return (
      <WinnerDialog
        winner={roomData.winner}
        players={sortedPlayers}
        isHost={isHost}
        devMode={DEV_MODE}
        onRestart={restartGame}
        developerPanel={developerPanel}
      />
    );
  }

  return (
    <Page>
      <Logo />

      <DevModeBadge enabled={DEV_MODE} />

      <div className="mt-8 space-y-5">
        <ScoreBoard
          currentQuestion={roomData.currentQuestion}
          modeText={modeText}
          currentScore={currentPlayer?.score || 0}
        />

        <QuestionCard
          currentQuestion={roomData.currentQuestion}
          modeText={modeText}
          playerName={playerName}
        />

        {!isRevealPhase && (
          <>
            <AudioPlayer
              key={
                `${roomData.gameRound}-${roomData.currentQuestion}-${roomData.currentSongId}`
              }
              spotifyId={song?.spotifyId}
            />

            <Card className="text-center text-2xl font-black text-yellow-300">
              {phaseLabel}
            </Card>

            <CountdownCard
              timeLeft={timeLeft}
              questionTime={timerMax}
              timeExpired={timeExpired}
            />
          </>
        )}

        {isPlayingPhase && (
          <WaitingCard
            answersCount={currentAnswers.length}
            playersCount={players.length}
          />
        )}

        {isAnsweringPhase && (
          !submitted ? (
            <AnswerInput
              answer={answer}
              onAnswerChange={(event) =>
                setAnswer(event.target.value)
              }
              onSubmit={submitAnswer}
              timeExpired={timeExpired}
            />
          ) : (
            <WaitingCard
              answersCount={currentAnswers.length}
              playersCount={players.length}
            />
          )
        )}

        {isAnsweringPhase && (
          <AnswerStatusCard
            answersCount={currentAnswers.length}
            playersCount={players.length}
            allAnswered={allAnswered}
          />
        )}

        {isRevealPhase && (
          <RevealCard
            song={song}
            correctPlayers={correctPlayers}
            scoreGain={scoreGain}
          />
        )}

        {isRevealPhase && (
          <RankingCard players={sortedPlayers} />
        )}

        {isHost && (
          <HostControlCard
            answerRevealed={isRevealPhase}
            allAnswered={allAnswered}
            timeExpired={timeExpired}
            onReveal={revealAnswer}
            onNext={nextQuestion}
            onRestart={restartGame}
          />
        )}
      </div>

      {developerPanel}
    </Page>
  );
}
