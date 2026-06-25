import { collection, addDoc } from "firebase/firestore";
import { db } from "./firebase/firebase";

import songs from "../songs.json";

async function importSongs() {
  try {
    for (const song of songs) {
      await addDoc(
        collection(db, "songs"),
        song
      );

      console.log(
        `已新增：${song.songName}`
      );
    }

    console.log(
      "全部歌曲匯入完成"
    );
  } catch (error) {
    console.error(error);
  }
}

importSongs();