import { useState } from "react";
import { collection, addDoc } from "firebase/firestore";

import { db } from "../firebase/firebase";

import Page from "../components/ui/Page";
import Logo from "../components/ui/Logo";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

export default function Host() {
  const [hostName, setHostName] = useState("");

  const createRoom = async () => {
    if (!hostName.trim()) {
      alert("請輸入房主名稱");
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

    await addDoc(
      collection(db, "rooms"),
      {
        roomId,
        hostName,

        status: "waiting",

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

        score: 0,

        isHost: true,

        joinedAt: Date.now()
      }
    );

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

      <Logo />

      <div className="mt-10">

        <Card>

          <h2 className="mb-6 text-center text-2xl font-bold text-white">

            🎮 建立房間

          </h2>

          <div className="mb-2 text-sm text-slate-400">

            玩家名稱

          </div>

          <Input
            placeholder="請輸入你的名稱"
            value={hostName}
            onChange={(e) =>
              setHostName(e.target.value)
            }
          />

          <div className="mt-6 space-y-3">

            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">

              <div className="text-sm text-slate-400">

                遊戲模式

              </div>

              <div className="mt-2 font-bold text-white">

                🎲 經典隨機模式

              </div>

              <div className="mt-1 text-xs text-slate-500">

                （歌名／歌手／歌詞隨機）

              </div>

            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4">

              <div className="text-sm text-slate-400">

                歌曲分類

              </div>

              <div className="mt-2 font-bold text-white">

                🎵 全部歌曲

              </div>

              <div className="mt-1 text-xs text-slate-500">

                （分類功能即將推出）

              </div>

            </div>

          </div>

          <div className="mt-8">

            <Button
              onClick={createRoom}
            >
              🎮 建立房間
            </Button>

          </div>

        </Card>

        <div className="mt-6 text-center text-sm text-slate-500">

          黃金歌王

          <br />

          房主版本 2.0

        </div>

      </div>

    </Page>
  );
}
