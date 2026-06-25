import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase/firebase";

import songs from "../../songs.json";

export default function ImportSongs() {

  const importData = async () => {

    for (const song of songs) {

      await addDoc(
        collection(db, "songs"),
        song
      );
    }

    alert("匯入完成");
  };

  return (
    <div style={{ padding: 30 }}>
      <h1>
        歌曲匯入
      </h1>

      <button
        onClick={importData}
      >
        匯入50首歌曲
      </button>
    </div>
  );
}
