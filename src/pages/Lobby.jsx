import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";

import { useNavigate } from "react-router-dom";
import { db } from "../firebase/firebase";
import { ensureAnonymousAuth } from "../firebase/auth";

import Page from "../components/ui/Page";
import { GAME_MODE_LABELS, CATEGORY_LABELS, getEffectiveGameMode, getQuestionMode } from "../constants/gameMode";
import { getRandomSong } from "../services/songService";
import useFullscreen from "../hooks/useFullscreen";
import { clearActivityMode, getActivityMode, isIosBrowser, isStandaloneMode } from "../utils/activityMode";

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

  const isActivityMode = !isHost && roomData?.joinStatus !== "ENDED" && getActivityMode(roomId);
  const isStandalone = isStandaloneMode();
  const showIosInstallTip = isActivityMode && isIosBrowser() && !isStandalone;
  const { isFullscreen, enterFullscreen, error: fullscreenError } = useFullscreen();

  const [roomDocId, setRoomDocId] =
    useState("");

  const [copied, setCopied] =
    useState(false);

  const [verifiedHost, setVerifiedHost] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  useEffect(() => {
    let active = true;
    async function verifyHost() {
      try {
        const authUser = await ensureAnonymousAuth();
        if (active) setVerifiedHost(Boolean(roomData?.hostUid && authUser.uid === roomData.hostUid));
      } catch (error) {
        console.error("主持人身分驗證失敗：", error);
        if (active) setVerifiedHost(false);
      }
    }
    verifyHost();
    return () => { active = false; };
  }, [roomData?.hostUid]);

  useEffect(() => {
    if (roomData?.joinStatus === "ENDED") {
      clearActivityMode();
    }
  }, [roomData?.joinStatus]);

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
  if (!roomDocId || !roomData) return;
  if (roomData.joinStatus === "ENDED") return;
  if (roomData.expiresAt?.toMillis && roomData.expiresAt.toMillis() <= Date.now()) return;

  let authUser;

  try {
    authUser = await ensureAnonymousAuth();
  } catch (error) {
    console.error("匿名登入失敗：", error);
    return;
  }

  if (
    !roomData.hostUid ||
    roomData.hostUid !== authUser.uid
  ) {
    console.error("主持人身分驗證失敗");
    return;
  }

  const randomSong = await getRandomSong();

if (!randomSong) return;

  const startUpdate = {
      status: "playing",

      currentQuestion: 1,

      currentSongId:
        randomSong.id,

      currentMode:
        getQuestionMode(roomData.gameMode),

      answerRevealed:
        false,

      scored: false
    };

  if (roomData.joinStatus) {
    startUpdate.joinStatus = "LOCKED";
  }

  await updateDoc(
    doc(db, "rooms", roomDocId),
    startUpdate
  );
};

  const updateJoinStatus = async (nextStatus) => {
    if (!verifiedHost || !roomDocId || !roomData || lifecycleBusy || roomData.status !== "waiting") return;
    setLifecycleBusy(true);
    try {
      const authUser = await ensureAnonymousAuth();
      if (authUser.uid !== roomData.hostUid) return;
      await updateDoc(doc(db, "rooms", roomDocId), { joinStatus: nextStatus });
    } catch (error) {
      console.error("更新房間狀態失敗：", error);
    } finally {
      setLifecycleBusy(false);
    }
  };

  const endRoom = async () => {
    // Ending active gameplay requires a separate Game flow; v1 only ends waiting rooms.
    if (!verifiedHost || !roomDocId || !roomData || lifecycleBusy || roomData.status !== "waiting") return;
    setLifecycleBusy(true);
    try {
      const authUser = await ensureAnonymousAuth();
      if (authUser.uid !== roomData.hostUid) return;
      await updateDoc(doc(db, "rooms", roomDocId), { joinStatus: "ENDED" });
    } catch (error) {
      console.error("結束房間失敗：", error);
    } finally {
      setLifecycleBusy(false);
    }
  };

  const leaveLobby = () => {
    clearActivityMode();
    navigate("/");
  };

  const joinUrl = `${window.location.origin}/join?room=${encodeURIComponent(roomId)}`;

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
        url: joinUrl
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
              onClick={leaveLobby}
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

            {verifiedHost && (
              <section className="mt-3 rounded-[18px] border border-[#A64DFF]/25 bg-[#12071E]/75 p-4 text-center">
                <h2 className="text-base font-bold text-white">活動加入</h2>
                <div className="mx-auto mt-3 inline-flex rounded-xl bg-white p-2">
                  <QRCodeSVG value={joinUrl} size={144} level="M" includeMargin />
                </div>
                <p className="mt-2 text-sm font-semibold text-[#B8AEC8]">掃描 QR Code 加入遊戲</p>
                <p className="mt-2 text-sm text-[#8F839F]">
                  狀態：{roomData?.joinStatus === "OPEN" ? "開放加入" : roomData?.joinStatus === "LOCKED" ? "已鎖定" : roomData?.joinStatus === "ENDED" ? "已結束" : "舊版房間"}
                </p>
                {roomData?.joinStatus === "OPEN" && roomData?.status === "waiting" && (
                  <button type="button" disabled={lifecycleBusy} onClick={() => updateJoinStatus("LOCKED")} className="mt-3 min-h-11 rounded-full border border-[#FFD95A]/35 px-5 font-bold text-[#FFE58A] disabled:opacity-50">鎖定房間</button>
                )}
                {roomData?.joinStatus === "LOCKED" && roomData?.status === "waiting" && (
                  <button type="button" disabled={lifecycleBusy} onClick={() => updateJoinStatus("OPEN")} className="mt-3 min-h-11 rounded-full border border-[#A64DFF]/45 px-5 font-bold text-white disabled:opacity-50">解除鎖定</button>
                )}
                {roomData?.status === "waiting" && roomData?.joinStatus !== "ENDED" && (
                  <button type="button" disabled={lifecycleBusy} onClick={endRoom} className="ml-2 mt-3 min-h-11 rounded-full border border-red-400/35 px-5 font-bold text-red-200 disabled:opacity-50">結束房間</button>
                )}
              </section>
            )}

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
                  {GAME_MODE_LABELS[getEffectiveGameMode(roomData?.gameMode)]}
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
            {isActivityMode && !isHost && (
              <section className="mb-3 rounded-2xl border border-[#FFD95A]/30 bg-[#21152B]/90 p-4 text-center">
                <button
                  type="button"
                  onClick={enterFullscreen}
                  disabled={isFullscreen}
                  className="min-h-12 w-full rounded-full bg-[linear-gradient(180deg,#FFD957,#C88300)] px-5 font-extrabold text-[#211020] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#FFF3A6] disabled:cursor-default disabled:opacity-70"
                >
                  {isFullscreen ? "已進入全螢幕" : "進入全螢幕遊戲"}
                </button>
                {fullscreenError && <p role="status" className="mt-2 text-sm text-[#FFE58A]">{fullscreenError}</p>}
                {showIosInstallTip && (
                  <p className="mt-2 text-sm text-[#D8CBE6]">若希望遊戲時不顯示瀏覽器網址列，可將「金曲猜歌王」加入主畫面後開啟。使用 Safari 分享選單中的「加入主畫面」即可。</p>
                )}
              </section>
            )}
            {isHost ? (
              <button
                type="button"
                disabled={roomData?.joinStatus === "ENDED"}
                onClick={startGame}
                className="flex h-[68px] w-full items-center justify-center gap-2 rounded-[18px] border border-[#FFE58A]/55 bg-[linear-gradient(180deg,#FFD957_0%,#EFB01A_55%,#C88300_100%)] text-xl font-extrabold text-[#211020] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(112,61,0,0.24),0_8px_24px_rgba(230,160,0,0.22)] transition hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_11px_28px_rgba(230,160,0,0.3)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FFF3A6] active:translate-y-px active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true">▶</span>
                {roomData?.joinStatus === "ENDED" ? "活動已結束" : "開始遊戲"}
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
