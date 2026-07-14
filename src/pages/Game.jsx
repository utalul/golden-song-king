import { useState, useEffect } from "react";
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
import useQuestionCountdown from "../hooks/useQuestionCountdown";
import { getRandomSong } from "../services/songService";
import AudioPlayer from "../components/game/AudioPlayer";
import { getAudioUrl } from "../services/audioService";
import { SONG_COLLECTION } from "../config/gameConfig";

export default function Game() {
  const roomId =
    localStorage.getItem("roomId") || "";

  const playerName =
    localStorage.getItem("playerName") || "";

  const isHost =
    localStorage.getItem("isHost") === "true";

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

  const {
    timeLeft,
    resetCountdown
  } = useQuestionCountdown({
    roomData,
    questionTime: QUESTION_TIME
  });

  useEffect(() => {
    if (!roomId) return;

    const roomQuery = query(
      collection(db, "rooms"),
      where("roomId", "==", roomId)
    );

    const unsubscribeRoom =
      onSnapshot(
        roomQuery,
        async (snapshot) => {
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
  }, [roomId, roomData]);

useEffect(() => {

  /* eslint-disable react-hooks/set-state-in-effect */
  setSubmitted(false);

  setAnswer("");

  setAnswers([]);

  resetCountdown();
  /* eslint-enable react-hooks/set-state-in-effect */

}, [
  roomData?.gameRound,
  roomData?.currentQuestion,
  roomData?.currentSongId,
  resetCountdown
]);  

const submitAnswer =
    async () => {
      if (!answer) return;

      if (submitted) return;

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

  const revealAnswer = async () => {

  if (!roomDocId)
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

  for (const answerData of answers) {

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
};

const nextQuestion = async () => {

console.log("nextQuestion 被呼叫");

  if (!roomDocId)
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

  setAnswer("");
  setSubmitted(false);
  resetCountdown();
};
const restartGame = async () => {

  if (!roomDocId)
    return;

  // ?身??摰嗅???
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

  // ??賣?
  const randomSong = await getRandomSong();

if (!randomSong) return;

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

  setAnswer("");
  setSubmitted(false);
  setAnswers([]);
  resetCountdown();
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
    answers.filter(
      (answerData) =>
        answerData.answer
          .trim()
          .toLowerCase() ===
        correctAnswer
          .trim()
          .toLowerCase()
    );

  const allAnswered =
    answers.length ===
    players.length;

  const timeExpired =
    timeLeft <= 0;

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

<AudioPlayer
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
            onAnswerChange={(e) =>
              setAnswer(e.target.value)
            }
            onSubmit={submitAnswer}
            timeExpired={timeExpired}
          />
        ) : (
          <WaitingCard
            answersCount={answers.length}
            playersCount={players.length}
          />
        )}

        <AnswerStatusCard
          answersCount={answers.length}
          playersCount={players.length}
          allAnswered={allAnswered}
        />

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
