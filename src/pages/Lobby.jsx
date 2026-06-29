import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";

import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebase";

import Page from "../components/ui/Page";
import Logo from "../components/ui/Logo";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import { GAME_MODE_LABELS, CATEGORY_LABELS } from "../constants/gameMode";
import { getRandomSong } from "../services/songService";

export default function Lobby() {
  const navigate = useNavigate();

  const roomId =
    localStorage.getItem("roomId") || "";

  const playerName =
    localStorage.getItem("playerName") || "";

  const isHost =
    localStorage.getItem("isHost") === "true";

  const [players, setPlayers] =
    useState([]);

  const [roomData, setRoomData] =
    useState(null);

  const [roomDocId, setRoomDocId] =
    useState("");

  const [copied, setCopied] =
    useState(false);

  useEffect(() => {
    if (!roomId) return;

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

    const roomQuery = query(
      collection(db, "rooms"),
      where("roomId", "==", roomId)
    );

    const unsubscribeRoom =
      onSnapshot(
        roomQuery,
        (snapshot) => {
          snapshot.forEach(
            (docSnap) => {
              setRoomDocId(
                docSnap.id
              );

              const room =
                docSnap.data();

              setRoomData(room);

              if (
                room.status ===
                "playing"
              ) {
                navigate(
                  "/game"
                );
              }
            }
          );
        }
      );

    return () => {
      unsubscribePlayers();
      unsubscribeRoom();
    };
  }, [roomId, navigate]);

  const startGame = async () => {
  if (!roomDocId) return;

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
      status: "playing",

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

  const copyRoomId = async () => {
    if (!roomId) return;

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(
        roomId
      );
    }

    setCopied(true);

    window.setTimeout(
      () => setCopied(false),
      1500
    );
  };

  return (
    <Page>
      <Logo />

        <div className="mt-8 space-y-5">

          <Card className="space-y-5">

            <div>

              <div className="text-sm font-bold uppercase tracking-widest text-yellow-400">
                房間代碼
              </div>

              <div className="mt-2 rounded-2xl border border-yellow-400/30 bg-slate-950/70 px-5 py-4 text-center text-4xl font-black tracking-[0.18em] text-white">
                {roomId}
              </div>

            </div>

            <Button
              variant="warning"
              onClick={copyRoomId}
            >
              {copied
                ? "已複製！"
                : "複製房間代碼"}
            </Button>

            <div className="rounded-2xl border border-violet-400/30 bg-violet-950/40 p-4">

              <div className="text-sm text-slate-400">
                目前遊戲模式
              </div>

              <div className="mt-1 text-xl font-bold text-yellow-300">
                {GAME_MODE_LABELS[roomData?.gameMode] || "等待中..."}
              </div>

<div className="rounded-2xl border border-violet-400/30 bg-violet-950/40 p-4">

  <div className="text-sm text-slate-400">
    歌曲分類
  </div>

  <div className="mt-1 text-xl font-bold text-yellow-300">
    {CATEGORY_LABELS[roomData?.category] || "🎵 全部歌曲"}
  </div>

</div>

            </div>

          </Card>

          <Card>

            <div className="mb-4 flex items-center justify-between gap-4">

              <h2 className="text-2xl font-black text-white">
                玩家
              </h2>

              <div className="rounded-full bg-yellow-400 px-4 py-2 text-sm font-black text-slate-950">
                {players.length} 人已加入
              </div>

            </div>

            <div className="space-y-3">
              {players.map(
                (player) => (
                  <div
                    key={
                      player.id
                    }
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
                    <div className="text-2xl">
                      {player.isHost
                        ? "\uD83D\uDC51"
                        : "\uD83D\uDC64"}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-lg font-bold text-white">
                        {player.name}
                      </div>

                      <div className="text-sm text-slate-400">
                        {player.isHost
                          ? "房主"
                          : "玩家"}
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>

          </Card>

          <Card className="space-y-5 text-center">

            <div>

              <div className="text-sm text-slate-400">
                你的玩家名稱
              </div>

              <div className="mt-1 text-xl font-bold text-white">
                {playerName}
              </div>

            </div>

            {isHost ? (
              <Button
                onClick={
                  startGame
                }
              >
                開始遊戲
              </Button>
            ) : (
              <div className="rounded-2xl border border-violet-400/30 bg-violet-950/40 px-4 py-5 text-lg font-bold text-yellow-300">
                等待房主...
              </div>
            )}

          </Card>

          <div className="pt-1 text-center text-sm text-slate-500">
            大廳版本 2.0
          </div>

        </div>
    </Page>
  );
}
