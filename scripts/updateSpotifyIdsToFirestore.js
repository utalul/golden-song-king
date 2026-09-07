/* global process */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  collection,
  getDocs,
  query,
  terminate,
  updateDoc,
  where
} from "firebase/firestore";
import { db } from "../src/firebase/firebase.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const inputPath = path.join(
  projectRoot,
  "src",
  "data",
  "songs",
  "all_with_spotify.json"
);

let hasLoggedFirstQuery = false;

function readSongs() {
  return JSON.parse(
    fs.readFileSync(inputPath, "utf8")
  );
}

function getUpdateData(song) {
  const updateData = {
    spotifyId: song.spotifyId ?? ""
  };

  if (song.previewUrl) {
    updateData.previewUrl = song.previewUrl;
  }

  return updateData;
}

async function findSongDocument(song) {
  const snapshot = await getDocs(
    query(
      collection(db, "songs"),
      where("songName", "==", song.songName),
      where("artist", "==", song.artist)
    )
  );

  if (!hasLoggedFirstQuery) {
    console.log(song.songName, song.artist, snapshot.size);
    hasLoggedFirstQuery = true;
  }

  if (snapshot.size !== 1) {
    return null;
  }

  return snapshot.docs[0].ref;
}

async function main() {
  console.log("Project:", db.app.options.projectId);

  const songs = readSongs();
  let successCount = 0;
  let failedCount = 0;

  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index];
    const progress = `[${index + 1}/${songs.length}] ${song.songName ?? "UNKNOWN"}`;

    try {
      const songRef = await findSongDocument(song);

      if (!songRef) {
        failedCount += 1;
        console.log(`${progress} ✘`);
        continue;
      }

      await updateDoc(
        songRef,
        getUpdateData(song)
      );

      successCount += 1;
      console.log(`${progress} ✔`);
    } catch (error) {
      failedCount += 1;
      console.log(`${progress} ✘`);
      console.error(error);
    }
  }

  console.log(`成功：${successCount}`);
  console.log(`失敗：${failedCount}`);

  await terminate(db);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
