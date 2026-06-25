import { useState } from "react";
import {
  collection,
  addDoc,
  query,
  where,
  getDocs
} from "firebase/firestore";

import { db } from "../firebase/firebase";

import Page from "../components/ui/Page";
import Logo from "../components/ui/Logo";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

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

      <Logo />

      <div className="mt-10">

        <Card>

          <h2 className="mb-6 text-center text-2xl font-bold text-white">
            🚪 加入房間
          </h2>

          <div className="mb-2 text-sm text-slate-400">
            玩家名稱
          </div>

          <Input
            placeholder="請輸入你的名稱"
            value={name}
            onChange={(e) =>
              setName(e.target.value)
            }
          />

          <div className="mt-5 mb-2 text-sm text-slate-400">
            房號
          </div>

          <Input
            placeholder="例如：123456"
            value={roomId}
            onChange={(e) =>
              setRoomId(
                e.target.value
                  .replace(/\D/g, "")
                  .slice(0, 6)
              )
            }
          />

          <div className="mt-8">

            <Button
              variant="success"
              disabled={joining}
              onClick={joinRoom}
            >
              {joining
                ? "加入中..."
                : "🚪 加入房間"}
            </Button>

          </div>

        </Card>

        <div className="mt-6 text-center text-sm text-slate-500">

          黃金歌王

          <br />

          加入版本 2.0

        </div>

      </div>

    </Page>
  );
}
