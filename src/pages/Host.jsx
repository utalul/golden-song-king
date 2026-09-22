import { useState } from "react";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { Link } from "react-router-dom";

import { db } from "../firebase/firebase";
import { ensureAnonymousAuth } from "../firebase/auth";

import Page from "../components/ui/Page";
import { clearActivityMode } from "../utils/activityMode";

export default function Host() {
  const [hostName, setHostName] = useState("");
  const [category, setCategory] = useState("all");

  const categories = [
    { value: "all", label: "🎵 全部歌曲" },
    { value: "mandarin", label: "🇹🇼 華語流行" },
    { value: "taiwanese", label: "🎤 台語經典" },
    { value: "western", label: "🌍 西洋歌曲" },
    { value: "anime", label: "🎌 動漫歌曲" },
    { value: "kpop", label: "🇰🇷 K-POP" },
  ];

  const createRoom = async () => {
    clearActivityMode();
    if (!hostName.trim()) {
      alert("請輸入房主名稱");
      return;
    }

    let authUser;

    try {
      authUser = await ensureAnonymousAuth();
    } catch (error) {
      console.error("匿名登入失敗：", error);
      alert("無法連線，請稍後再試");
      return;
    }

    const roomId = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    const modes = [
      "songName",
      "artist",
      "lyric"
    ];

    const randomMode =
      modes[
        Math.floor(
          Math.random() * modes.length
        )
      ];

    const roomRef = await addDoc(
  collection(db, "rooms"),
  {
    roomId,
    hostName,
    hostUid: authUser.uid,

    category,

    status: "waiting",

    joinStatus: "OPEN",

    expiresAt: Timestamp.fromMillis(
      Date.now() + 6 * 60 * 60 * 1000
    ),

        gameRound: 1,

        currentQuestion: 1,

        gameMode: randomMode,

        answerRevealed: false,

        scored: false,

        winner: "",

        createdAt: Date.now()
      }
    );

    await addDoc(
      collection(db, "players"),
      {
        name: hostName,

        roomId,
        roomDocId: roomRef.id,
        uid: authUser.uid,

        score: 0,

        isHost: true,

        joinedAt: Date.now()
      }
    );

    // This flag controls UI only; Firestore authorization must use Firebase Auth.
    localStorage.setItem(
      "roomId",
      roomId
    );

    localStorage.setItem(
      "playerName",
      hostName
    );

    localStorage.setItem(
      "isHost",
      "true"
    );

    window.location.href =
      "/lobby";
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
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_9%_14%,rgba(255,246,191,0.56)_0_1px,transparent_2px),radial-gradient(circle_at_22%_37%,rgba(166,77,255,0.42)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_88%_19%,rgba(255,217,90,0.5)_0_1px,transparent_2px),radial-gradient(circle_at_78%_43%,rgba(255,255,255,0.34)_0_1px,transparent_2px),radial-gradient(circle_at_13%_69%,rgba(255,217,90,0.3)_0_1px,transparent_2px)]"
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[8%] top-[25%] text-lg text-[#FFD95A] opacity-35 drop-shadow-[0_0_7px_rgba(255,205,70,0.65)]"
        >
          ✦
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[7%] top-[48%] text-base text-[#C15CFF] opacity-30 drop-shadow-[0_0_7px_rgba(193,92,255,0.7)]"
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

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-6 pb-5 pt-5">
          <header className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
            <Link
              to="/"
              className="flex min-h-10 items-center justify-self-start rounded-full px-2 text-sm font-bold text-[#B8AEC8] transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD95A] active:translate-y-px"
            >
              ← 返回
            </Link>

            <div className="pt-1 text-center">
              <h1 className="text-xl font-extrabold text-white">
                建立房間
              </h1>

              <p className="mt-1 whitespace-nowrap text-xs text-[#8F839F]">
                設定遊戲後邀請朋友加入
              </p>
            </div>

            <div
              aria-hidden="true"
              className="flex size-10 items-center justify-center justify-self-end text-lg text-[#FFD95A]/65"
            >
              ♪
            </div>
          </header>

          <main className="mt-7 flex flex-1 flex-col">
            <section>
              <label
                htmlFor="host-name"
                className="text-base font-bold text-white"
              >
                玩家名稱
              </label>

              <input
                id="host-name"
                type="text"
                placeholder="請輸入你的名稱"
                value={hostName}
                onChange={(e) =>
                  setHostName(e.target.value)
                }
                className="mt-2 h-[58px] w-full rounded-[16px] border border-[#A64DFF]/30 bg-[#12071E]/78 px-4 text-lg font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_18px_rgba(118,34,215,0.06)] outline-none transition placeholder:text-[#6F647C] hover:border-[#A64DFF]/45 focus:border-[#FFD95A]/65 focus:shadow-[inset_0_0_18px_rgba(118,34,215,0.12),0_0_0_3px_rgba(255,217,90,0.08)]"
              />
            </section>

            <section className="mt-5 rounded-[18px] border border-[#A64DFF]/22 bg-[linear-gradient(180deg,rgba(29,11,48,0.82),rgba(13,5,23,0.78))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="text-base font-bold text-[#B8AEC8]">
                遊戲模式
              </div>

              <div className="mt-2 text-[21px] font-extrabold text-white">
                🎲 經典隨機模式
              </div>

              <p className="mt-1 text-sm text-[#8F839F]">
                歌名、歌手與歌詞題型隨機出現
              </p>
            </section>

            <section className="mt-4">
              <label
                htmlFor="song-category"
                className="text-base font-bold text-white"
              >
                歌曲分類
              </label>

              <div className="relative mt-2">
                <select
                  id="song-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-[58px] w-full appearance-none rounded-[16px] border border-[#A64DFF]/30 bg-[#12071E]/82 px-4 pr-11 text-lg font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition hover:border-[#A64DFF]/48 focus:border-[#FFD95A]/65 focus:shadow-[0_0_0_3px_rgba(255,217,90,0.08)]"
                >
                  {categories.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>

                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#FFD95A]"
                >
                  ▼
                </span>
              </div>
            </section>
          </main>

          <div className="mt-auto pt-7">
            <button
              type="button"
              onClick={createRoom}
              className="flex h-[68px] w-full items-center justify-center gap-2 rounded-[18px] border border-[#FFE58A]/55 bg-[linear-gradient(180deg,#FFD957_0%,#EFB01A_55%,#C88300_100%)] text-[21px] font-extrabold text-[#211020] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(112,61,0,0.24),0_8px_24px_rgba(230,160,0,0.22)] transition hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),0_11px_28px_rgba(230,160,0,0.3)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FFF3A6] active:translate-y-px active:scale-[0.99]"
            >
              <span aria-hidden="true">🎮</span>
              建立房間
            </button>

            <div className="pt-4 text-center text-[11px] text-[#8F839F]/55">
              v2.0.0
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
