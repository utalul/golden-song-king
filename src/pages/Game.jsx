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
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

const DEV_MODE = true;

const QUESTION_TIME =
  DEV_MODE ? 999 : 20;

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

  const [timeLeft, setTimeLeft] =
    useState(QUESTION_TIME);

  const [developerPanelOpen, setDeveloperPanelOpen] =
    useState(false);

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
                  "songs",
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

  setTimeLeft(QUESTION_TIME);
  /* eslint-enable react-hooks/set-state-in-effect */

}, [
  roomData?.gameRound,
  roomData?.currentQuestion,
  roomData?.currentSongId
]);  

useEffect(() => {

  if (!roomData) return;

  if (roomData.answerRevealed)
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
  roomData,
  timeLeft
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

  if (!roomDocId)
    return;

  const songsSnapshot =
    await getDocs(
      collection(db, "songs")
    );

  const songs = [];

  songsSnapshot.forEach(
    (docSnap) => {
      songs.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    }
  );

  if (songs.length === 0)
    return;

  const randomSong =
    songs[
      Math.floor(
        Math.random() *
          songs.length
      )
    ];

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
  const songsSnapshot =
    await getDocs(
      collection(db, "songs")
    );

  const songs = [];

  songsSnapshot.forEach(
    (docSnap) => {
      songs.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    }
  );

  const randomSong =
    songs[
      Math.floor(
        Math.random() *
        songs.length
      )
    ];

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
  setTimeLeft(QUESTION_TIME);
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

const developerPanel =
  DEV_MODE ? (
    <div className="fixed bottom-5 right-5 z-50 w-[min(18rem,calc(100vw-2.5rem))]">
      {developerPanelOpen && (
        <Card className="mb-3 space-y-3 border-yellow-400/40 bg-slate-900/95 p-4 shadow-2xl">
          <div className="text-center text-sm font-black text-yellow-300">
            🧪 開發模式
          </div>

          <Button
            variant="warning"
            onClick={devAddPointToCurrentPlayer}
            className="py-3 text-base"
          >
            ➕ +1 分
          </Button>

          <Button
            variant="warning"
            onClick={devWinCurrentPlayer}
            className="py-3 text-base"
          >
            🏆 直接獲勝
          </Button>

          <Button
            onClick={revealAnswer}
            className="py-3 text-base"
          >
            🎵 公布答案
          </Button>

          <Button
            variant="success"
            onClick={nextQuestion}
            className="py-3 text-base"
          >
            ➡ 下一題
          </Button>

          <Button
            variant="danger"
            onClick={restartGame}
            className="py-3 text-base"
          >
            🔄 重新開始
          </Button>
        </Card>
      )}

      <button
        type="button"
        onClick={() =>
          setDeveloperPanelOpen(
            (open) => !open
          )
        }
        className="
          w-full
          rounded-full
          border
          border-yellow-400/50
          bg-violet-700
          px-5
          py-4
          text-base
          font-black
          text-yellow-100
          shadow-2xl
          transition
          active:scale-95
        "
      >
        🧪 開發工具
      </button>
    </div>
  ) : null;

  if (!roomData || !song) {
  return (
    <Page>
      <Logo />

      {DEV_MODE && (
        <div className="mt-6 text-center">
          <span className="rounded-full border border-yellow-400/40 bg-violet-950/70 px-4 py-2 text-sm font-black text-yellow-300">
            🧪 開發模式
          </span>
        </div>
      )}

      <div className="mt-10">
        <Card className="text-center">
          <div className="text-2xl font-black text-yellow-400">
            載入中...
          </div>

          <div className="mt-4 h-3 rounded-full bg-slate-950">
            <div className="h-3 w-1/2 animate-pulse rounded-full bg-yellow-400" />
          </div>
        </Card>
      </div>

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

  const timerColor =
    timeLeft <= 5
      ? "accent-red-500"
      : timeLeft <= 10
        ? "accent-orange-500"
        : "accent-emerald-500";

  const timerTextColor =
    timeLeft <= 5
      ? "text-red-400"
      : timeLeft <= 10
        ? "text-orange-400"
        : "text-emerald-400";

  const timerPulse =
    timeLeft <= 5
      ? "animate-pulse"
      : "";

  const rankingIcon = (index) => {
    if (index === 0)
      return "\uD83D\uDC51";

    if (index === 1)
      return "\uD83E\uDD48";

    if (index === 2)
      return "\uD83E\uDD49";

    return `${index + 1}`;
  };

  const rankingList = (
    <div className="space-y-3">
      {sortedPlayers.map(
        (player, index) => (
          <div
            key={player.id}
            className="
              flex
              items-center
              gap-3
              rounded-2xl
              border
              border-slate-700
              bg-slate-950/70
              px-4
              py-3
            "
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-900 text-xl font-black text-yellow-300">
              {rankingIcon(index)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold text-white">
                {player.name}
              </div>

              <div className="text-sm text-slate-400">
                第 {index + 1} 名
              </div>
            </div>

            <div className="text-xl font-black text-yellow-300">
              {player.score} 分
            </div>
          </div>
        )
      )}
    </div>
  );

if (roomData.winner) {
  return (
    <div className="min-h-screen bg-black">
      <div className="min-h-screen bg-gradient-to-b from-violet-950/90 via-slate-950/95 to-black px-6 py-8 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
          <div className="animate-victory-pop space-y-5">
            <Card className="border-yellow-400/40 bg-slate-900/95 text-center shadow-2xl">
              {DEV_MODE && (
                <div className="mb-4">
                  <span className="rounded-full border border-yellow-400/40 bg-violet-950/70 px-4 py-2 text-sm font-black text-yellow-300">
                    🧪 開發模式
                  </span>
                </div>
              )}

              <div className="text-5xl">
                🏆
              </div>

              <h1 className="mt-4 text-4xl font-black text-yellow-300">
                恭喜！
              </h1>

              <div className="mt-6 rounded-3xl border border-yellow-400/30 bg-violet-950/60 p-5">
                <div className="text-lg font-bold text-slate-300">
                  👑
                </div>

                <div className="mt-2 text-4xl font-black text-white">
                  {roomData.winner}
                </div>
              </div>

              <div className="mt-6 text-xl font-bold text-slate-200">
                率先獲得
              </div>

              <div className="mt-2 text-5xl font-black text-yellow-300">
                10 分！
              </div>

              <div className="mt-8 space-y-4">
                {isHost && (
                  <Button
                    variant="warning"
                    onClick={
                      restartGame
                    }
                  >
                    🎮 再玩一場
                  </Button>
                )}

                <Button
                  onClick={() => {
                    window.location.href = "/";
                  }}
                >
                  🏠 回首頁
                </Button>
              </div>
            </Card>

            <Card className="animate-fade-in">
              <h2 className="mb-4 text-center text-2xl font-black text-white">
                最終排行
              </h2>

              {rankingList}
            </Card>
          </div>
        </div>
      </div>

      {developerPanel}
    </div>
  );
}

  return (
    <Page>
      <Logo />

      {DEV_MODE && (
        <div className="mt-6 text-center">
          <span className="rounded-full border border-yellow-400/40 bg-violet-950/70 px-4 py-2 text-sm font-black text-yellow-300">
            🧪 開發模式
          </span>
        </div>
      )}

      <div className="mt-8 space-y-5">
        <Card>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl bg-slate-950/70 p-3">
              <div className="text-xs text-slate-400">
                目前題目
              </div>

              <div className="mt-1 text-2xl font-black text-yellow-300">
                {roomData.currentQuestion}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950/70 p-3">
              <div className="text-xs text-slate-400">
                遊戲模式
              </div>

              <div className="mt-1 text-lg font-black text-yellow-300">
                {modeText}
              </div>
            </div>

            <div className="rounded-2xl bg-slate-950/70 p-3">
              <div className="text-xs text-slate-400">
                目前分數
              </div>

              <div className="mt-1 text-2xl font-black text-yellow-300">
                {currentPlayer?.score || 0}
              </div>
            </div>
          </div>
        </Card>

        <Card className="text-center">
          <div className="text-sm text-slate-400">
            第 {roomData.currentQuestion} 題
          </div>

          <h1 className="mt-3 text-4xl font-black text-white">
            {modeText}
          </h1>

          <div className="mt-4 rounded-2xl border border-violet-400/30 bg-violet-950/40 px-4 py-3 text-sm font-bold text-yellow-300">
            玩家：{playerName}
          </div>
        </Card>

        <Card className="space-y-4 text-center">
          <div className="text-sm font-bold uppercase tracking-widest text-yellow-400">
            倒數計時
          </div>

          <div className={`text-6xl font-black ${timerTextColor} ${timerPulse}`}>
            {timeLeft}
          </div>

          <progress
            className={`
              h-4
              w-full
              overflow-hidden
              rounded-full
              bg-slate-950
              transition-all
              duration-1000
              ease-linear
              ${timerColor}
            `}
            value={timeLeft}
            max={QUESTION_TIME}
          />

          {timeExpired && (
            <div className="rounded-2xl border border-red-400/30 bg-red-950/40 px-4 py-3 text-lg font-black text-red-300">
              ⏰ 作答時間結束
            </div>
          )}
        </Card>

        {!submitted ? (
          <Card className="space-y-5">
            <div>
              <div className="mb-2 text-sm text-slate-400">
                輸入答案
              </div>

              <Input
                value={answer}
                onChange={(e) =>
                  setAnswer(e.target.value)
                }
                placeholder="請輸入你的答案"
                disabled={timeExpired}
              />
            </div>

            <Button
              disabled={timeExpired}
              onClick={
                submitAnswer
              }
            >
              送出答案
            </Button>

            {timeExpired && (
              <div className="text-center text-lg font-black text-red-300">
                ⏰ 作答時間結束
              </div>
            )}
          </Card>
        ) : (
          <Card className="space-y-5 text-center">
            <div>
              <h2 className="text-2xl font-black text-white">
                已送出答案
              </h2>

              <p className="mt-2 text-slate-400">
                等待其他玩家作答
                <span className="ml-1 inline-block animate-pulse">
                  ...
                </span>
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-sm text-slate-400">
                <span>已作答</span>
                <span>{answers.length} / {players.length}</span>
              </div>

              <progress
                className="h-3 w-full overflow-hidden rounded-full accent-yellow-400"
                value={answers.length}
                max={players.length || 1}
              />
            </div>
          </Card>
        )}

        <Card className="text-center">
          <div className="text-sm text-slate-400">
            已作答：{answers.length} / {players.length}
          </div>

          {allAnswered ? (
            <div className="mt-2 text-lg font-black text-emerald-400">
              所有玩家都已作答
            </div>
          ) : (
            <div className="mt-2 text-lg font-bold text-yellow-300">
              等待玩家作答中...
            </div>
          )}
        </Card>

        {roomData.answerRevealed && (
          <Card className="animate-fade-in space-y-5 text-center">
            <div className="rounded-3xl border border-yellow-400/40 bg-violet-950/60 p-5 shadow-xl">
              <div className="text-lg font-black text-yellow-300">
                🎉 正確答案
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl bg-slate-950/70 p-4">
                  <div className="text-sm text-slate-400">
                    🎵 歌名
                  </div>

                  <div className="mt-2 text-3xl font-black text-white">
                    {song.songName}
                  </div>
                </div>

                {song.artist && (
                  <div className="rounded-2xl bg-slate-950/70 p-4">
                    <div className="text-sm text-slate-400">
                      👤 歌手
                    </div>

                    <div className="mt-2 text-2xl font-black text-yellow-300">
                      {song.artist}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-yellow-400/30 bg-slate-950/70 p-5">
              {correctPlayers.length > 0 ? (
                <div className="space-y-4">
                  <div className="text-lg font-black text-yellow-300">
                    🏆 本題得分
                  </div>

                  <div className="space-y-3">
                    {correctPlayers.map(
                      (answerData) => (
                        <div
                          key={answerData.id}
                          className="rounded-2xl border border-violet-400/30 bg-violet-950/50 p-4"
                        >
                          <div className="text-2xl font-black text-white">
                            👑 {answerData.playerName}
                          </div>

                          <div className="mt-2 text-2xl font-black text-yellow-300">
                            +{scoreGain} 分
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-2xl font-black text-slate-300">
                  😢 本題沒有人答對
                </div>
              )}
            </div>
          </Card>
        )}

        {roomData.answerRevealed && (
          <Card>
            <h2 className="mb-4 text-center text-2xl font-black text-white">
              排行榜
            </h2>

            {rankingList}
          </Card>
        )}

        {isHost && (
          <Card className="space-y-4">
            <h2 className="text-center text-2xl font-black text-white">
              房主控制
            </h2>

            {!roomData.answerRevealed && (
              <>
                <Button
                  variant="warning"
                  disabled={
                    !allAnswered &&
                    !timeExpired
                  }
                  onClick={
                    revealAnswer
                  }
                >
                  公布答案
                </Button>

                {!allAnswered && !timeExpired && (
                  <div className="text-center text-sm text-slate-400">
                    等待所有玩家作答後即可公布答案
                  </div>
                )}

                {!allAnswered && timeExpired && (
                  <div className="text-center text-sm text-red-300">
                    作答時間已結束，房主可以公布答案
                  </div>
                )}
              </>
            )}

            {roomData.answerRevealed && (
              <Button
                variant="success"
                onClick={
                  nextQuestion
                }
              >
                下一題
              </Button>
            )}

            <Button
              variant="danger"
              onClick={
                restartGame
              }
            >
              重新開始遊戲
            </Button>
          </Card>
        )}
      </div>

      {developerPanel}
    </Page>
  );
}
