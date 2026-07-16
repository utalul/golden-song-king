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
import { DEV_MODE, QUESTION_TIME } from "../constants/game";
import { getRandomSong } from "../services/songService";
import AudioPlayer from "../components/game/AudioPlayer";
import { getAudioUrl } from "../services/audioService";
import { SONG_COLLECTION } from "../config/gameConfig";

const READY_TIME = 3;

export default function Game() {
  const roomId =
    localStorage.getItem("roomId") || "";

  const playerName =
    localStorage.getItem("playerName") || "";

  const isHost =
    localStorage.getItem("isHost") === "true";

  const autoRevealTriggeredRef =
    useRef(false);

  const nextQuestionTimerRef =
    useRef(null);

  const activeQuestionKeyRef =
    useRef("");

  const questionLiveRef =
    useRef(false);

  const debugStateRef =
    useRef({
      currentQuestion: null,
      timeLeft: null,
      ready: false,
      answerRevealed: false,
      answersLength: 0
    });

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

  const [readyLeft, setReadyLeft] =
    useState(READY_TIME);

  const [questionStarted, setQuestionStarted] =
    useState(false);

  const [countdownReady, setCountdownReady] =
    useState(false);

  const [timeLeft, setTimeLeft] =
    useState(QUESTION_TIME);

  const questionKey =
    roomData
      ? `${roomData.gameRound}-${roomData.currentQuestion}-${roomData.currentSongId}`
      : "";

  const isReady =
    !questionStarted &&
    readyLeft > 0 &&
    !roomData?.answerRevealed &&
    !roomData?.winner;

  const resetCountdown = useCallback(() => {
    setTimeLeft(QUESTION_TIME);
  }, []);

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
    questionStarted &&
    countdownReady &&
    timeLeft <= 0;

  const logDebugEvent = useCallback((eventName, data = {}) => {
    console.log(
      `[Game Debug] ${eventName}`,
      {
        ...debugStateRef.current,
        ...data
      }
    );
  }, []);

  useEffect(() => {
    debugStateRef.current = {
      currentQuestion:
        roomData?.currentQuestion ?? null,
      timeLeft,
      ready: isReady,
      answerRevealed:
        roomData?.answerRevealed ?? false,
      answersLength:
        answers.length
    };
  }, [
    answers.length,
    isReady,
    roomData?.answerRevealed,
    roomData?.currentQuestion,
    timeLeft
  ]);

  useEffect(() => {
    logDebugEvent(
      "timeLeft 變化"
    );
  }, [
    logDebugEvent,
    timeLeft
  ]);

  useEffect(() => {
    logDebugEvent(
      "answerRevealed 更新"
    );
  }, [
    logDebugEvent,
    roomData?.answerRevealed
  ]);

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
    activeQuestionKeyRef.current = questionKey;

    questionLiveRef.current = false;

    setSubmitted(false);

    setAnswer("");

    setAnswers([]);

    setReadyLeft(READY_TIME);

    setQuestionStarted(false);

    setCountdownReady(false);

    resetCountdown();

    logDebugEvent(
      "QUESTION_TIME reset"
    );

    logDebugEvent(
      "Ready 開始",
      {
        currentQuestion:
          roomData?.currentQuestion ?? null,
        ready: true
      }
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    logDebugEvent,
    questionKey,
    roomData?.currentQuestion,
    resetCountdown
  ]);

  useEffect(() => {
    autoRevealTriggeredRef.current = false;
  }, [
    roomData?.gameRound,
    roomData?.currentQuestion,
    roomData?.currentSongId
  ]);

  useEffect(() => {
    if (!roomData)
      return;

    if (roomData.answerRevealed)
      return;

    if (roomData.winner)
      return;

    if (readyLeft <= 0)
      return;

    const timer = window.setTimeout(
      () => {
        if (readyLeft <= 1) {
          resetCountdown();
          logDebugEvent(
            "QUESTION_TIME reset"
          );
          logDebugEvent(
            "Ready 結束",
            {
              ready: false
            }
          );
          setReadyLeft(0);
          setCountdownReady(false);
          questionLiveRef.current = true;
          setQuestionStarted(true);
          return;
        }

        setReadyLeft(readyLeft - 1);
      },
      1000
    );

    return () =>
      window.clearTimeout(timer);
  }, [
    logDebugEvent,
    resetCountdown,
    readyLeft,
    roomData
  ]);

  useEffect(() => {
    if (!questionStarted)
      return;

    if (roomData?.answerRevealed)
      return;

    if (roomData?.winner)
      return;

    if (timeLeft <= 0)
      return;

    const timer = window.setInterval(
      () => {
        setTimeLeft(
          (currentTime) =>
            Math.max(
              currentTime - 1,
              0
            )
        );
      },
      1000
    );

    return () =>
      window.clearInterval(timer);
  }, [
    questionStarted,
    roomData?.answerRevealed,
    roomData?.winner,
    timeLeft
  ]);

  useEffect(() => {
    if (!questionStarted)
      return;

    if (timeLeft <= 0)
      return;

    if (countdownReady)
      return;

    const timer = window.setTimeout(
      () => {
        setCountdownReady(true);
      },
      0
    );

    return () =>
      window.clearTimeout(timer);
  }, [
    countdownReady,
    questionStarted,
    timeLeft
  ]);

  const submitAnswer =
    async () => {
      if (!answer) return;

      if (isReady) return;

      if (!questionStarted) return;

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

    const correctAnswer =
      roomData.currentMode ===
      "artist"
        ? song.artist
        : song.songName;

    const scoreGain =
      DEV_MODE ? 10 : 1;

    const currentAnswers =
      answers.filter(
        (answerData) =>
          answerData.gameRound ===
            roomData.gameRound &&
          answerData.questionNumber ===
            roomData.currentQuestion
      );

    for (const answerData of currentAnswers) {
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
            updatedScore >= 10
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
        scored: true
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
    logDebugEvent(
      "nextQuestion 被呼叫"
    );

    if (!roomDocId)
      return;

    if (!roomData)
      return;

    const randomSong =
      await getRandomSong();

    if (!randomSong)
      return;

    const modes = [
      "songName",
      "artist"
    ];

    const randomMode =
      modes[
        Math.floor(
          Math.random() *
            modes.length
        )
      ];

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
          randomSong.id,

        currentMode:
          randomMode,

        answerRevealed:
          false,

        scored: false
      }
    );

    logDebugEvent(
      "currentQuestion 更新",
      {
        currentQuestion:
          roomData.currentQuestion + 1
      }
    );

    setAnswer("");
    setSubmitted(false);
    resetCountdown();
    logDebugEvent(
      "QUESTION_TIME reset"
    );
  }, [
    logDebugEvent,
    resetCountdown,
    roomData,
    roomDocId
  ]);

  useEffect(() => {
    logDebugEvent(
      "AutoReveal 判斷開始"
    );

    if (!isHost)
      return;

    if (!roomData)
      return;

    if (roomData.answerRevealed)
      return;

    if (roomData.winner)
      return;

    if (isReady)
      return;

    if (!questionStarted)
      return;

    if (autoRevealTriggeredRef.current)
      return;

    if (
      activeQuestionKeyRef.current !==
      questionKey
    )
      return;

    if (!questionLiveRef.current)
      return;

    if (
      !allAnswered &&
      !timeExpired
    )
      return;

    autoRevealTriggeredRef.current = true;

    logDebugEvent(
      "AutoReveal 真正執行"
    );

    revealAnswer();
  }, [
    allAnswered,
    isHost,
    isReady,
    questionKey,
    questionStarted,
    logDebugEvent,
    revealAnswer,
    roomData,
    timeExpired
  ]);

  useEffect(() => {
    if (!isHost)
      return;

    if (!roomData?.answerRevealed)
      return;

    if (roomData.winner)
      return;

    if (nextQuestionTimerRef.current) {
      window.clearTimeout(
        nextQuestionTimerRef.current
      );
    }

    nextQuestionTimerRef.current = window.setTimeout(
      () => {
        nextQuestionTimerRef.current = null;
        nextQuestion();
      },
      5000
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
    nextQuestion,
    roomData?.answerRevealed,
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

    autoRevealTriggeredRef.current = false;

    setAnswer("");
    setSubmitted(false);
    setAnswers([]);
    setReadyLeft(READY_TIME);
    setQuestionStarted(false);
    setCountdownReady(false);
    resetCountdown();

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

    const randomSong =
      await getRandomSong();

    if (!randomSong)
      return;

    const modes = [
      "songName",
      "artist"
    ];

    const randomMode =
      modes[
        Math.floor(
          Math.random() *
            modes.length
        )
      ];

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

        currentSongId:
          randomSong.id,

        currentMode:
          randomMode,

        answerRevealed:
          false,

        scored: false
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
        score: 10
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

    if (updatedScore >= 10) {
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
    DEV_MODE ? 10 : 1;

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

        {isReady ? (
          <Card className="space-y-5 text-center">
            <div className="text-3xl font-black text-yellow-300">
              第 {roomData.currentQuestion} 題
            </div>

            <div className="text-xl font-bold text-white">
              即將開始
            </div>

            <div className="text-7xl font-black text-yellow-400">
              {readyLeft}
            </div>
          </Card>
        ) : (
          <>
            <AudioPlayer
              key={
                `${roomData.gameRound}-${roomData.currentQuestion}-${roomData.currentSongId}`
              }
              url={getAudioUrl(song)}
            />

            <CountdownCard
              timeLeft={timeLeft}
              questionTime={QUESTION_TIME}
              timeExpired={timeExpired}
            />

            {!submitted ? (
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
            )}

            <AnswerStatusCard
              answersCount={currentAnswers.length}
              playersCount={players.length}
              allAnswered={allAnswered}
            />
          </>
        )}


        {roomData.answerRevealed && (
          <RevealCard
            song={song}
            correctPlayers={correctPlayers}
            scoreGain={scoreGain}
          />
        )}

        {roomData.answerRevealed && (
          <RankingCard players={sortedPlayers} />
        )}

        {isHost && (
          <HostControlCard
            answerRevealed={roomData.answerRevealed}
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
