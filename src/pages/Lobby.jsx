import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc
} from "firebase/firestore";

import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebase";

import Page from "../components/ui/Page";
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

  const shareRoom = async () => {
    if (!roomId) return;

    if (!navigator.share) {
      await copyRoomId();
      return;
    }

    try {
      await navigator.share({
        title: "金曲猜歌王",
        text: `加入房間 ${roomId}，一起來猜歌！`,
        url: `${window.location.origin}/join`
      });
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("分享房間失敗：", error);
      }
    }
  };

  return (
    <Page>
      <div className="relative -mx-6 -my-6 min-h-[100dvh] overflow-hidden bg-[#07030D]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(139,44,245,0.3),transparent_34%),linear-gradient(180deg,#12051F_0%,#0B0414_48%,#07030D_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-28 -top-20 h-[560px] w-[310px] origin-top rotate-[18deg] bg-[linear-gradient(90deg,transparent_5%,rgba(166,77,255,0.04)_19%,rgba(166,77,255,0.22)_50%,rgba(166,77,255,0.04)_81%,transparent_95%)] opacity-80 [clip-path:polygon(42%_0,58%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.88)_48%,transparent_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-20 h-[560px] w-[310px] origin-top -rotate-[18deg] bg-[linear-gradient(90deg,transparent_5%,rgba(193,92,255,0.04)_19%,rgba(193,92,255,0.2)_50%,rgba(193,92,255,0.04)_81%,transparent_95%)] opacity-80 [clip-path:polygon(42%_0,58%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.88)_48%,transparent_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_9%_14%,rgba(255,246,191,0.58)_0_1px,transparent_2px),radial-gradient(circle_at_21%_31%,rgba(166,77,255,0.46)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_88%_18%,rgba(255,217,90,0.54)_0_1px,transparent_2px),radial-gradient(circle_at_76%_36%,rgba(255,255,255,0.36)_0_1px,transparent_2px),radial-gradient(circle_at_11%_64%,rgba(255,217,90,0.32)_0_1px,transparent_2px),radial-gradient(circle_at_91%_72%,rgba(193,92,255,0.34)_0_1.5px,transparent_2.5px)]"
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[8%] top-[21%] text-xl text-[#FFD95A] opacity-35 drop-shadow-[0_0_8px_rgba(255,205,70,0.6)]"
        >
          ✦
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[7%] top-[39%] text-base text-[#C15CFF] opacity-30 drop-shadow-[0_0_7px_rgba(193,92,255,0.7)]"
        >
          ✦
        </span>

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-18%] bottom-0 h-28 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,211,77,0.09)_0%,rgba(118,34,215,0.19)_34%,transparent_72%),linear-gradient(72deg,transparent_39%,rgba(139,44,245,0.1)_50%,transparent_61%),linear-gradient(108deg,transparent_39%,rgba(193,92,255,0.08)_50%,transparent_61%)] [clip-path:polygon(22%_0,78%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_30%,#000_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-8%] bottom-10 h-px bg-gradient-to-r from-transparent via-[#A848FF]/55 to-transparent shadow-[0_0_14px_rgba(168,72,255,0.38)]"
        />

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-6 pb-4 pt-5">
          <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="flex min-h-10 items-center justify-self-start rounded-full px-2 text-sm font-bold text-[#B8AEC8] transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD95A] active:translate-y-px"
            >
              ← 離開
            </button>

            <div className="pt-1 text-center">
              <h1 className="text-lg font-extrabold text-white">
                等待中...
              </h1>

              <p className="mt-0.5 whitespace-nowrap text-xs text-[#8F839F]">
                等朋友加入一起開唱！
              </p>
            </div>

            <button
              type="button"
              disabled
              title="設定尚未開放"
              aria-label="設定尚未開放"
              className="flex size-10 items-center justify-center justify-self-end rounded-full border border-[#A64DFF]/20 bg-[#10051E]/55 text-base text-[#8F839F] opacity-60"
            >
              ⚙
            </button>
          </header>

          <main className="mt-4 flex flex-1 flex-col">
            <section className="relative overflow-hidden rounded-[20px] border border-[#FFD95A]/30 bg-[linear-gradient(180deg,rgba(31,12,48,0.9),rgba(11,4,20,0.9))] px-5 pb-4 pt-3.5 text-center shadow-[inset_0_1px_0_rgba(255,246,191,0.1),0_12px_34px_rgba(0,0,0,0.34),0_0_24px_rgba(255,205,70,0.08)] backdrop-blur-md">
              <span
                aria-hidden="true"
                className="absolute left-4 top-3 text-xs text-[#FFD95A] drop-shadow-[0_0_6px_rgba(255,205,70,0.7)]"
              >
                ✦
              </span>

              <span
                aria-hidden="true"
                className="absolute right-4 top-12 text-[9px] text-[#C15CFF] drop-shadow-[0_0_5px_rgba(193,92,255,0.7)]"
              >
                ✦
              </span>

              <div className="text-xs font-bold text-[#B8AEC8]">
                房號
              </div>

              <div className="mt-1 bg-[linear-gradient(180deg,#FFF6BF_0%,#FFD95A_42%,#D99A0B_100%)] bg-clip-text text-[46px] font-black leading-none tracking-[0.12em] text-transparent [text-shadow:0_0_10px_rgba(255,205,70,0.25)]">
                {roomId}
              </div>

              <div className="mt-3 flex justify-center gap-2.5">
                <button
                  type="button"
                  onClick={copyRoomId}
                  className="flex h-10 min-w-28 items-center justify-center gap-1.5 rounded-full border border-[#FFD95A]/28 bg-[#FFD95A]/8 px-4 text-sm font-bold text-[#FFE58A] transition hover:border-[#FFD95A]/48 hover:bg-[#FFD95A]/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD95A] active:translate-y-px"
                >
                  <span aria-hidden="true">▣</span>
                  {copied ? "已複製" : "複製房號"}
                </button>

                <button
                  type="button"
                  onClick={shareRoom}
                  className="flex h-10 min-w-24 items-center justify-center gap-1.5 rounded-full border border-[#A64DFF]/32 bg-[#A64DFF]/10 px-4 text-sm font-bold text-white transition hover:border-[#C15CFF]/55 hover:bg-[#A64DFF]/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C15CFF] active:translate-y-px"
                >
                  <span aria-hidden="true">↗</span>
                  分享
                </button>
              </div>
            </section>

            <section className="mt-3 flex items-center gap-3 rounded-[16px] border border-[#FFD95A]/16 bg-[#12071E]/72 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#FFD95A]/28 bg-[#FFD95A]/8 text-xl shadow-[inset_0_0_12px_rgba(255,205,70,0.08)]">
                👑
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-base font-bold text-[#FFD95A]">
                  房主
                </div>

                <div className="truncate text-xl font-bold text-white">
                  {roomData?.hostName || "等待房主"}
                </div>
              </div>

              {isHost && (
                <span className="rounded-full border border-[#A64DFF]/30 bg-[#A64DFF]/12 px-2.5 py-1 text-xs font-bold text-[#D7A4FF]">
                  我
                </span>
              )}
            </section>

            <section className="mt-4 min-h-0">
              <div className="mb-2.5 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">
                  玩家
                </h2>

                <span className="rounded-full border border-[#FFD95A]/20 bg-[#FFD95A]/8 px-3 py-1 text-sm font-bold text-[#FFE58A]">
                  {players.length} 人已加入
                </span>
              </div>

              <div className="max-h-[174px] space-y-2 overflow-y-auto pr-1">
                {players.map((player) => {
                  const isCurrentPlayer =
                    player.name === playerName;

                  return (
                    <div
                      key={player.id}
                      className={`flex min-h-[60px] items-center gap-3 rounded-[14px] border px-3 py-2.5 ${
                        isCurrentPlayer
                          ? "border-[#A64DFF]/35 bg-[#A64DFF]/12 shadow-[inset_3px_0_0_rgba(255,217,90,0.65)]"
                          : "border-white/6 bg-[#12071E]/58"
                      }`}
                    >
                      <div className={`flex size-10 shrink-0 items-center justify-center rounded-full border text-base font-black ${
                        player.isHost
                          ? "border-[#FFD95A]/35 bg-[#FFD95A]/10 text-[#FFD95A]"
                          : "border-[#A64DFF]/28 bg-[#A64DFF]/10 text-[#D7A4FF]"
                      }`}
                      >
                        {player.isHost
                          ? "♛"
                          : player.name?.trim().charAt(0) || "玩"}
                      </div>

                      <div className="min-w-0 flex-1 truncate text-lg font-bold text-white">
                        {player.name}
                      </div>

                      <span className={`shrink-0 text-sm font-bold ${
                        player.isHost
                          ? "text-[#FFD95A]"
                          : isCurrentPlayer
                            ? "text-[#D7A4FF]"
                            : "text-[#786D88]"
                      }`}
                      >
                        {player.isHost
                          ? "房主"
                          : isCurrentPlayer
                            ? "我"
                            : "已加入"}
                      </span>
                    </div>
                  );
                })}

                <div className="flex h-10 items-center justify-center rounded-[12px] border border-dashed border-[#A64DFF]/14 text-xs text-[#6F647C]">
                  等待玩家加入...
                </div>
              </div>
            </section>

            <section className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="flex min-h-[68px] flex-col justify-center rounded-[14px] border border-[#A64DFF]/18 bg-[#12071E]/65 px-3 py-2.5">
                <div className="text-sm text-[#8F839F]">
                  遊戲模式
                </div>

                <div className="mt-0.5 truncate text-lg font-bold text-white">
                  {GAME_MODE_LABELS[roomData?.gameMode] || "等待中..."}
                </div>
              </div>

              <div className="flex min-h-[68px] flex-col justify-center rounded-[14px] border border-[#A64DFF]/18 bg-[#12071E]/65 px-3 py-2.5">
                <div className="text-sm text-[#8F839F]">
                  歌曲分類
                </div>

                <div className="mt-0.5 truncate text-lg font-bold text-white">
                  {CATEGORY_LABELS[roomData?.category] || "🎵 全部歌曲"}
                </div>
              </div>
            </section>
          </main>

          <div className="mt-auto pt-4">
            {isHost ? (
              <button
                type="button"
                onClick={startGame}
                className="flex h-[68px] w-full items-center justify-center gap-2 rounded-[18px] border border-[#FFE58A]/55 bg-[linear-gradient(180deg,#FFD957_0%,#EFB01A_55%,#C88300_100%)] text-xl font-extrabold text-[#211020] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(112,61,0,0.24),0_8px_24px_rgba(230,160,0,0.22)] transition hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_11px_28px_rgba(230,160,0,0.3)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FFF3A6] active:translate-y-px active:scale-[0.99]"
              >
                <span aria-hidden="true">▶</span>
                開始遊戲
              </button>
            ) : (
              <div className="flex h-[68px] items-center justify-center gap-2 rounded-[18px] border border-[#A64DFF]/22 bg-[#12071E]/72 text-sm font-bold text-[#D7A4FF] shadow-[inset_0_0_20px_rgba(118,34,215,0.08)]">
                等待房主開始遊戲
                <span aria-hidden="true" className="tracking-[0.2em]">
                  ···
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Page>
  );
}
