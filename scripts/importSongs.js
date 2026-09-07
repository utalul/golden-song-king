import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { db } from "../src/firebase/firebase.js";
import { doc, setDoc } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(
  __dirname,
  "../src/data/songs/all_with_spotify.json"
);

const songs = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

let success = 0;
let failed = 0;

async function importSongs() {
  console.log(`開始匯入 ${songs.length} 首歌曲...\n`);

  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];

    try {
      const docRef = doc(db, "songs", song.id);

      const data = {
        id: song.id,
        songName: song.songName,
        artist: song.artist,
        category: song.category,
        decade: song.decade,
        difficulty: song.difficulty,
        spotifyId: song.spotifyId,
      };

      if (song.previewUrl) {
        data.previewUrl = song.previewUrl;
      }

      await setDoc(docRef, data);

      success++;

      console.log(
        `[${i + 1}/${songs.length}] ${song.id} ${song.songName} ✔`
      );
    } catch (err) {
      failed++;

      console.error(
        `[${i + 1}/${songs.length}] ${song.id} ${song.songName} ✖`
      );
      console.error(err.message);
    }
  }

  console.log("\n======================");
  console.log(`成功：${success}`);
  console.log(`失敗：${failed}`);
  console.log(`總數：${songs.length}`);
  console.log("======================");
}

importSongs().catch(console.error);