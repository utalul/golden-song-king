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
import { ensureAnonymousAuth } from "../firebase/auth";

import Page from "../components/ui/Page";
import Logo from "../components/ui/Logo";
import DevModeBadge from "../components/game/DevModeBadge";
import AnswerInput from "../components/game/AnswerInput";
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

  const [hostControlsOpen, setHostControlsOpen] =
    useState(false);

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

  const roomHostUid =
    roomData?.hostUid || "";

  const authorizeHost = useCallback(async () => {
    let authUser;

    try {
      authUser = await ensureAnonymousAuth();
    } catch (error) {
      console.error("匿名登入失敗：", error);
      return null;
    }

    if (
      !roomHostUid ||
      roomHostUid !== authUser.uid
    ) {
      console.error("主持人身分驗證失敗");
      return null;
    }

    return authUser;
  }, [roomHostUid]);

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
      const authUser = await authorizeHost();

      if (!authUser)
        return;

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
    authorizeHost,
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

      let authUser;

      try {
        authUser = await ensureAnonymousAuth();
      } catch (error) {
        console.error("匿名登入失敗：", error);
        return;
      }

      const currentPlayer = players.find(
        (player) =>
          player.name === playerName &&
          player.roomDocId === roomDocId
      );

      if (
        !currentPlayer?.uid ||
        currentPlayer.uid !== authUser.uid
      ) {
        console.error("玩家身分驗證失敗");
        return;
      }

      await addDoc(
        collection(
          db,
          "answers"
        ),
        {
          roomId,
          playerName,
          uid: authUser.uid,

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

    const authUser = await authorizeHost();

    if (!authUser)
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

        if (
          targetPlayer?.uid &&
          answerData.uid === targetPlayer.uid &&
          targetPlayer.roomDocId === roomDocId
        ) {
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
    authorizeHost,
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

    const authUser = await authorizeHost();

    if (!authUser)
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
    authorizeHost,
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

    const authUser = await authorizeHost();

    if (!authUser)
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
    authorizeHost,
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

    const authUser = await authorizeHost();

    if (!authUser)
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
      if (
        !player.uid ||
        player.roomDocId !== roomDocId
      ) {
        console.error("玩家身分資料不完整，略過分數重設");
        continue;
      }

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

    const authUser = await authorizeHost();

    if (!authUser)
      return;

    const targetPlayer =
      players.find(
        (player) =>
          player.name === playerName
      );

    if (
      !targetPlayer ||
      targetPlayer.uid !== authUser.uid ||
      targetPlayer.roomDocId !== roomDocId
    )
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

    const authUser = await authorizeHost();

    if (!authUser)
      return;

    const targetPlayer =
      players.find(
        (player) =>
          player.name === playerName
      );

    if (
      !targetPlayer ||
      targetPlayer.uid !== authUser.uid ||
      targetPlayer.roomDocId !== roomDocId
    )
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

  const timerMax =
    getPhaseTime(gamePhase);

  const totalQuestions =
    roomData.currentQuestion +
    (
      Array.isArray(roomData.songQueue)
        ? roomData.songQueue.length
        : 0
    );

  const timerProgress =
    timerMax > 0
      ? Math.max(
          0,
          Math.min(
            360,
            (timeLeft / timerMax) * 360
          )
        )
      : 0;

  const modeIcon =
    roomData.currentMode === "artist"
      ? "🎤"
      : "🎵";

  const answerTypeText =
    roomData.currentMode === "artist"
      ? "歌手"
      : "歌名";

  const answeredPlayerNames =
    new Set(
      currentAnswers.map(
        (answerData) => answerData.playerName
      )
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
      <div className="relative -mx-6 -my-6 min-h-[100dvh] overflow-x-hidden bg-[#08040F]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(139,44,245,0.28),transparent_34%),linear-gradient(180deg,#140622_0%,#0D0618_48%,#08040F_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-28 -top-20 h-[560px] w-[310px] origin-top rotate-[18deg] bg-[linear-gradient(90deg,transparent_5%,rgba(166,77,255,0.04)_19%,rgba(166,77,255,0.2)_50%,rgba(166,77,255,0.04)_81%,transparent_95%)] opacity-75 [clip-path:polygon(42%_0,58%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.86)_48%,transparent_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-20 h-[560px] w-[310px] origin-top -rotate-[18deg] bg-[linear-gradient(90deg,transparent_5%,rgba(193,92,255,0.04)_19%,rgba(193,92,255,0.18)_50%,rgba(193,92,255,0.04)_81%,transparent_95%)] opacity-75 [clip-path:polygon(42%_0,58%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.86)_48%,transparent_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_13%,rgba(255,246,191,0.52)_0_1px,transparent_2px),radial-gradient(circle_at_21%_34%,rgba(166,77,255,0.42)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_88%_18%,rgba(255,217,90,0.5)_0_1px,transparent_2px),radial-gradient(circle_at_75%_39%,rgba(255,255,255,0.34)_0_1px,transparent_2px),radial-gradient(circle_at_12%_67%,rgba(255,217,90,0.3)_0_1px,transparent_2px),radial-gradient(circle_at_91%_73%,rgba(193,92,255,0.32)_0_1.5px,transparent_2.5px)]"
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[8%] top-[22%] text-lg text-[#FFD95A] opacity-30 drop-shadow-[0_0_7px_rgba(255,205,70,0.65)]"
        >
          ✦
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[7%] top-[46%] text-base text-[#C15CFF] opacity-28 drop-shadow-[0_0_7px_rgba(193,92,255,0.7)]"
        >
          ✦
        </span>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-18%] bottom-0 h-28 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,211,77,0.08)_0%,rgba(118,34,215,0.18)_34%,transparent_72%),linear-gradient(72deg,transparent_39%,rgba(139,44,245,0.1)_50%,transparent_61%),linear-gradient(108deg,transparent_39%,rgba(193,92,255,0.08)_50%,transparent_61%)] [clip-path:polygon(22%_0,78%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_30%,#000_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-8%] bottom-10 h-px bg-gradient-to-r from-transparent via-[#A848FF]/50 to-transparent shadow-[0_0_14px_rgba(168,72,255,0.34)]"
        />

        <div className="relative z-10 mx-auto flex min-h-[100dvh] max-w-[450px] flex-col px-5 pb-7 pt-4 sm:px-6 sm:pt-5">
          <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="text-lg font-bold text-[#FFD95A]">
              <span className="font-extrabold">
                {currentPlayer?.score || 0}
              </span>{" "}
              分
            </div>

            <div className="text-center">
              <div className="text-lg font-bold text-white">
                第 {roomData.currentQuestion} 題
              </div>

              <div className="mt-0.5 text-[15px] text-[#9F94AF]">
                共 {totalQuestions} 題
              </div>
            </div>

            {isHost ? (
              <button
                type="button"
                title="主持人控制"
                aria-label="開啟主持人控制"
                aria-expanded={hostControlsOpen}
                onClick={() =>
                  setHostControlsOpen(
                    (currentOpen) => !currentOpen
                  )
                }
                className="flex size-10 items-center justify-center justify-self-end rounded-full border border-[#FFD95A]/40 bg-[#10051E]/78 text-lg text-[#FFD95A] shadow-[inset_0_0_12px_rgba(255,205,70,0.08),0_0_12px_rgba(255,205,70,0.08)] transition hover:border-[#FFD95A]/70 hover:bg-[#FFD95A]/10 active:scale-95"
              >
                ♛
              </button>
            ) : (
              <span className="size-10 justify-self-end" />
            )}
          </header>

          <div className="mt-2">
            <DevModeBadge enabled={DEV_MODE} />
          </div>

          <main className="flex flex-1 flex-col">
            {!isRevealPhase && (
              <section className="mt-4 flex flex-col items-center text-center sm:mt-5">
                <div
                  role="timer"
                  aria-label={`倒數 ${timeLeft} 秒`}
                  className="relative flex size-[210px] items-center justify-center rounded-full p-[5px] shadow-[0_0_28px_rgba(139,44,245,0.2),0_0_16px_rgba(255,205,70,0.09)] sm:size-[220px]"
                  style={{
                    background: `conic-gradient(from -90deg, #FFD95A 0deg, #A848FF ${timerProgress}deg, rgba(124, 42, 232, 0.14) ${timerProgress}deg 360deg)`
                  }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute right-[19px] top-[24px] size-2 rounded-full bg-[#FFF6BF] shadow-[0_0_8px_rgba(255,217,90,0.8)]"
                  />

                  <div className="flex size-full flex-col items-center justify-center rounded-full border border-white/8 bg-[radial-gradient(circle_at_50%_42%,#160925_0%,#0D0618_62%,#08040F_100%)] shadow-[inset_0_0_32px_rgba(124,42,232,0.16),inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <div
                      className={`text-[72px] font-semibold leading-none text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.08)] sm:text-[76px] ${
                        timeLeft <= 5
                          ? "animate-pulse"
                          : ""
                      }`}
                    >
                      {timeLeft}
                    </div>

                    <div className="mt-2 text-[15px] font-bold text-[#B8AEC8]">
                      秒
                    </div>
                  </div>
                </div>

                <div className={`mt-4 rounded-full border px-5 py-2 text-base font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${
                  isPlayingPhase
                    ? "border-[#FFE58A]/45 bg-[linear-gradient(180deg,#FFD957,#D99513)] text-[#211020] shadow-[0_5px_18px_rgba(230,160,0,0.16)]"
                    : "border-[#C77DFF]/40 bg-[linear-gradient(180deg,#A848FF,#6719C5)] text-white shadow-[0_5px_18px_rgba(126,40,220,0.2)]"
                }`}
                >
                  {isPlayingPhase ? "播放中..." : "作答中"}
                </div>

                <div className="mt-3 text-base text-[#B8AEC8]">
                  {isPlayingPhase ? (
                    <>
                      本題請猜
                      <span className="ml-1 text-[17px] font-bold text-[#FFD95A]">
                        {modeText.replace("猜", "")}
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="text-[21px] font-bold text-white">
                        這首歌是？
                      </div>

                      <div className="mt-1 text-lg font-bold text-[#FFD95A]">
                        {modeIcon} {answerTypeText}
                      </div>
                    </>
                  )}
                </div>
              </section>
            )}

            {!isRevealPhase && (
              <section
                className={`mt-4 w-full ${
                  isPlayingPhase ? "block" : "hidden"
                }`}
              >
                <div className="relative mx-auto size-32">
                  <div
                    aria-hidden="true"
                    className="absolute -inset-7 rounded-full bg-[radial-gradient(circle,rgba(255,217,90,0.16)_0%,rgba(139,44,245,0.12)_42%,transparent_70%)]"
                  />

                  <div
                    aria-hidden="true"
                    className={`absolute inset-0 rounded-full border border-[#FFD95A]/35 bg-[conic-gradient(from_30deg,#140622,#7924D8,#FFD95A,#140622)] p-[3px] shadow-[0_0_24px_rgba(124,42,232,0.24),0_0_12px_rgba(255,205,70,0.1)] ${
                      isPlayingPhase
                        ? "animate-spin [animation-duration:8s]"
                        : ""
                    }`}
                  />

                  <div
                    aria-hidden="true"
                    className="absolute inset-[8px] rounded-full border border-dashed border-[#C15CFF]/32"
                  />

                  <div className="absolute inset-[17px] flex flex-col items-center justify-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_50%_35%,#1D0B30,#0D0618_68%)] text-white shadow-[inset_0_0_24px_rgba(163,66,255,0.24),0_0_12px_rgba(255,205,70,0.08)]">
                    <span className="text-[46px] leading-none text-[#FFF6BF] drop-shadow-[0_0_10px_rgba(255,205,70,0.35)]">
                      ♪
                    </span>

                    <div
                      aria-hidden="true"
                      className="mt-1 flex h-4 items-end gap-1"
                    >
                      <span className="h-2 w-1 rounded-full bg-[#A848FF]" />
                      <span className="h-4 w-1 rounded-full bg-[#FFD95A]" />
                      <span className="h-3 w-1 rounded-full bg-[#C15CFF]" />
                      <span className="h-2.5 w-1 rounded-full bg-[#FFD95A]" />
                      <span className="h-1.5 w-1 rounded-full bg-[#A848FF]" />
                    </div>
                  </div>
                </div>

                <div className="mt-3 [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div>div:first-of-type]:hidden [&>div>div:nth-of-type(2)]:h-2 [&>div>div:nth-of-type(2)]:bg-[#211331] [&>div>div:nth-of-type(2)>div]:bg-[linear-gradient(90deg,#A848FF,#FFD95A)] [&>div>div:nth-of-type(3)]:text-[#B8AEC8] [&>div>button]:mx-auto [&>div>button]:mt-3 [&>div>button]:max-w-40 [&>div>button]:rounded-[16px] [&>div>button]:border [&>div>button]:border-[#C77DFF]/35 [&>div>button]:bg-[linear-gradient(180deg,#A848FF,#6719C5)] [&>div>button]:py-3 [&>div>button]:text-base [&>div>button]:font-bold [&>div>button]:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_7px_18px_rgba(126,40,220,0.22)]">
                  <AudioPlayer
                    key={
                      `${roomData.gameRound}-${roomData.currentQuestion}-${roomData.currentSongId}`
                    }
                    previewUrl={song?.previewUrl}
                    spotifyId={song?.spotifyId}
                  />
                </div>

                <p className="mt-3 text-center text-lg font-bold text-white">
                  仔細聽，猜猜這首歌！
                </p>
              </section>
            )}

            {isAnsweringPhase && (
              <section className="mt-4 w-full">
                {!submitted ? (
                  <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div]:backdrop-blur-none [&>div>div>div:first-child]:text-base [&>div>div>div:first-child]:font-bold [&>div>div>div:first-child]:text-[#B8AEC8] [&_input]:h-[58px] [&_input]:rounded-[16px] [&_input]:border-[#A848FF]/45 [&_input]:bg-[rgba(27,13,48,0.78)] [&_input]:text-lg [&_input]:font-semibold [&_input]:text-white [&_input]:placeholder:text-[17px] [&_input]:placeholder:text-[#8F839F] [&_input:focus]:border-[#FFD95A]/70 [&_input:focus]:shadow-[0_0_0_3px_rgba(168,72,255,0.14),inset_0_0_18px_rgba(118,34,215,0.08)] [&_button]:h-[60px] [&_button]:rounded-[16px] [&_button]:border [&_button]:border-[#C77DFF]/40 [&_button]:bg-[linear-gradient(180deg,#A848FF_0%,#7924D8_55%,#5212A8_100%)] [&_button]:py-0 [&_button]:text-xl [&_button]:font-bold [&_button]:shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-2px_0_rgba(43,6,94,0.3),0_8px_24px_rgba(126,40,220,0.28)] [&_button:active]:translate-y-px [&_button:active]:scale-[0.99]">
                  <AnswerInput
                    answer={answer}
                    onAnswerChange={(event) =>
                      setAnswer(event.target.value)
                    }
                    onSubmit={submitAnswer}
                    timeExpired={timeExpired}
                  />
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-[#A848FF]/20 bg-[#12071E]/55 py-4 text-center">
                    <div className="text-lg font-extrabold text-white">
                      答案已送出
                    </div>

                    <div className="mt-1 text-[15px] text-[#B8AEC8]">
                      等待其他玩家作答
                    </div>
                  </div>
                )}

                <div className="mt-4 flex flex-col items-center gap-3">
                  <div className="text-base text-[#9F94AF]">
                    已答題
                    <span className="mx-1 text-lg font-bold text-white">
                      {currentAnswers.length} / {players.length}
                    </span>
                    人
                  </div>

                  <div className="flex max-w-full flex-wrap justify-center gap-2">
                    {players.map((player) => {
                      const hasAnswered =
                        answeredPlayerNames.has(player.name);

                      return (
                        <span
                          key={player.id}
                          title={
                            hasAnswered
                              ? `${player.name} 已答題`
                              : `${player.name} 尚未答題`
                          }
                          aria-label={
                            hasAnswered
                              ? `${player.name} 已答題`
                              : `${player.name} 尚未答題`
                          }
                          className={`size-3.5 rounded-full border ${
                            hasAnswered
                              ? "border-[#FFE58A] bg-[linear-gradient(135deg,#FFD95A,#A848FF)] shadow-[0_0_10px_rgba(245,197,66,0.38)]"
                              : "border-[#A848FF]/28 bg-[#211331]"
                          }`}
                        />
                      );
                    })}
                  </div>

                  {allAnswered && (
                    <div className="text-sm font-bold text-[#FFD95A]">
                      所有玩家都已作答
                    </div>
                  )}
                </div>
              </section>
            )}

            {isRevealPhase && (
              <section className="mt-6 rounded-[22px] border border-[#FFD95A]/24 bg-[linear-gradient(180deg,rgba(31,12,48,0.86),rgba(11,4,20,0.88))] px-5 py-6 text-center shadow-[inset_0_1px_0_rgba(255,246,191,0.08),0_16px_40px_rgba(0,0,0,0.32),0_0_24px_rgba(255,205,70,0.06)] sm:px-6">
                <div
                  className="text-4xl drop-shadow-[0_0_12px_rgba(255,205,70,0.28)]"
                  aria-hidden="true"
                >
                  ✦
                </div>

                <div className="mt-2 bg-[linear-gradient(180deg,#FFF6BF,#FFD95A_58%,#D99A0B)] bg-clip-text text-xl font-bold text-transparent [text-shadow:0_0_10px_rgba(255,205,70,0.18)]">
                  正確答案
                </div>

                <div className="mt-6 text-base font-bold text-[#9F94AF]">
                  歌名
                </div>

                <h1 className="mt-2 break-words text-[36px] font-extrabold leading-tight text-white drop-shadow-[0_0_12px_rgba(255,255,255,0.07)] sm:text-[40px]">
                  {song.songName}
                </h1>

                {song.artist && (
                  <div className="mt-3 break-words bg-[linear-gradient(180deg,#FFF3A6,#FFD95A_58%,#D99A0B)] bg-clip-text text-2xl font-bold text-transparent">
                    {song.artist}
                  </div>
                )}

                <div className="mt-7 border-t border-[#A848FF]/18 pt-5">
                  <div className="text-base font-bold text-[#9F94AF]">
                    本題結果
                  </div>

                  {correctPlayers.length > 0 ? (
                    <div className="mt-3 divide-y divide-white/8">
                      {correctPlayers.map(
                        (answerData) => (
                          <div
                            key={answerData.id}
                            className="flex items-center justify-between gap-4 py-3.5"
                          >
                            <span className="min-w-0 truncate text-lg font-bold text-white">
                              {answerData.playerName}
                            </span>

                            <span className="shrink-0 text-lg font-extrabold text-[#FFD95A]">
                              +{scoreGain} 分
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 text-lg font-semibold text-[#B8AEC8]">
                      本題沒有人答對
                    </div>
                  )}
                </div>
              </section>
            )}

            {isRevealPhase && (
              <div className="mt-4 rounded-[20px] border border-[#A848FF]/20 bg-[#0D0618]/68 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_32px_rgba(0,0,0,0.24)] [&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div]:backdrop-blur-none [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-extrabold [&>div>div>div]:min-h-[64px] [&>div>div>div]:rounded-[14px] [&>div>div>div]:border-[#A848FF]/16 [&>div>div>div]:bg-[rgba(27,13,48,0.58)] [&>div>div>div]:px-3.5 [&>div>div>div]:py-3 [&>div>div>div:first-child]:border-[#FFD95A]/42 [&>div>div>div:first-child]:bg-[#FFD95A]/9 [&>div>div>div>div:first-child]:bg-[#4B176F] [&>div>div>div>div:first-child]:text-[#FFD95A] [&>div>div>div>div:nth-child(2)>div:first-child]:text-xl [&>div>div>div>div:nth-child(2)>div:first-child]:font-bold [&>div>div>div>div:nth-child(2)>div:last-child]:text-base [&>div>div>div>div:last-child]:text-xl [&>div>div>div>div:last-child]:font-extrabold [&>div>div>div>div:last-child]:text-[#FFD95A]">
                <RankingCard players={sortedPlayers} />
              </div>
            )}
          </main>
        </div>

        {isHost && hostControlsOpen && (
          <div
            className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 px-4 pt-20 backdrop-blur-sm"
            onClick={() => setHostControlsOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="主持人控制"
              className="w-full max-w-sm rounded-[20px] border border-[#A342FF]/30 bg-[#10071D]/95 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.55)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <div className="font-extrabold text-white">
                  主持人控制
                </div>

                <button
                  type="button"
                  title="關閉"
                  aria-label="關閉主持人控制"
                  onClick={() => setHostControlsOpen(false)}
                  className="flex size-9 items-center justify-center rounded-full bg-white/8 text-xl text-[#B8AEC8] transition hover:bg-white/12 hover:text-white"
                >
                  ×
                </button>
              </div>

              <div className="[&>div]:border-0 [&>div]:bg-transparent [&>div]:p-0 [&>div]:shadow-none [&>div]:backdrop-blur-none [&_h2]:hidden [&_button]:py-3 [&_button]:text-base">
                <HostControlCard
                  answerRevealed={isRevealPhase}
                  allAnswered={allAnswered}
                  timeExpired={timeExpired}
                  onReveal={revealAnswer}
                  onNext={nextQuestion}
                  onRestart={restartGame}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {developerPanel}
    </Page>
  );
}
