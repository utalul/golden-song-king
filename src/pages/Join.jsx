import { useState } from "react";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs
} from "firebase/firestore";
import { Link } from "react-router-dom";

import { db } from "../firebase/firebase";

import Page from "../components/ui/Page";

export default function Join() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joining, setJoining] = useState(false);

  const joinRoom = async () => {
    if (joining) return;

    setJoining(true);

    if (!name.trim() || !roomId.trim()) {
      setJoining(false);
      alert("請輸入名稱與房號");
      return;
    }

    const roomQuery = query(
      collection(db, "rooms"),
      where("roomId", "==", roomId)
    );

    const roomSnapshot = await getDocs(roomQuery);

    if (roomSnapshot.empty) {
      setJoining(false);
      alert("房號不存在");
      return;
    }

    const playerQuery = query(
      collection(db, "players"),
      where("roomId", "==", roomId),
      where("name", "==", name)
    );

    const playerSnapshot =
      await getDocs(playerQuery);

    if (!playerSnapshot.empty) {
      setJoining(false);
      alert("此玩家名稱已加入房間");
      return;
    }

    await addDoc(
      collection(db, "players"),
      {
        name,
        roomId,
        score: 0,
        isHost: false,
        joinedAt: Date.now()
      }
    );

    localStorage.setItem("roomId", roomId);
    localStorage.setItem("playerName", name);
    localStorage.setItem("isHost", "false");

    window.location.href = "/lobby";
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
                加入房間
              </h1>

              <p className="mt-1 whitespace-nowrap text-xs text-[#8F839F]">
                輸入房號加入遊戲
              </p>
            </div>

            <div
              aria-hidden="true"
              className="flex size-10 items-center justify-center justify-self-end text-lg text-[#C15CFF]/70"
            >
              ♪
            </div>
          </header>

          <main className="mt-8 flex flex-1 flex-col">
            <section>
              <label
                htmlFor="player-name"
                className="text-base font-semibold text-white"
              >
                玩家名稱
              </label>

              <input
                id="player-name"
                type="text"
                placeholder="請輸入你的名稱"
                value={name}
                onChange={(e) =>
                  setName(e.target.value)
                }
                className="mt-2 h-[58px] w-full rounded-[16px] border border-[#A64DFF]/30 bg-[#12071E]/78 px-4 text-lg font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_18px_rgba(118,34,215,0.06)] outline-none transition placeholder:text-[#8F839F] hover:border-[#A64DFF]/45 focus:border-[#FFD95A]/65 focus:shadow-[inset_0_0_18px_rgba(118,34,215,0.12),0_0_0_3px_rgba(255,217,90,0.08)]"
              />
            </section>

            <section className="mt-6">
              <label
                htmlFor="room-code"
                className="text-base font-semibold text-white"
              >
                房號
              </label>

              <input
                id="room-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={roomId}
                onChange={(e) =>
                  setRoomId(
                    e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6)
                  )
                }
                className="mt-2 h-16 w-full rounded-[16px] border border-[#A64DFF]/34 bg-[#12071E]/82 px-4 text-center text-2xl font-bold tracking-[0.16em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_0_20px_rgba(118,34,215,0.07)] outline-none transition placeholder:text-[#8F839F] hover:border-[#A64DFF]/48 focus:border-[#FFD95A]/65 focus:shadow-[inset_0_0_18px_rgba(118,34,215,0.13),0_0_0_3px_rgba(255,217,90,0.08)]"
              />
            </section>
          </main>

          <div className="mt-auto pt-8">
            <button
              type="button"
              disabled={joining}
              onClick={joinRoom}
              className="flex h-[68px] w-full items-center justify-center gap-2 rounded-[18px] border border-[#C77DFF]/40 bg-[linear-gradient(180deg,#A848FF_0%,#7924D8_55%,#5212A8_100%)] text-xl font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-2px_0_rgba(43,6,94,0.3),0_8px_24px_rgba(126,40,220,0.28)] transition hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_11px_28px_rgba(126,40,220,0.38)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C77DFF] active:translate-y-px active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
            >
              <span aria-hidden="true">↗</span>
              {joining ? "加入中..." : "加入房間"}
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
