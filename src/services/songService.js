import {
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";

import { db } from "../firebase/firebase";
import { DEV_MODE } from "../constants/game";

export async function getRandomSong() {

  let songsRef = collection(db, "songs");

  let snapshot;

  if (DEV_MODE) {

    console.log("🧪 DEV MODE");

    snapshot = await getDocs(
      query(
        songsRef,
        where("isTest", "==", true)
      )
    );

  } else {

    console.log("🎵 NORMAL MODE");

    snapshot = await getDocs(songsRef);

  }

  const songs = [];

  snapshot.forEach((docSnap) => {

    const data = docSnap.data();

    // 正式模式排除測試歌曲
    if (
      !DEV_MODE &&
      data.isTest === true
    ) {
      return;
    }

    songs.push({
      id: docSnap.id,
      ...data
    });

  });

  console.log("歌曲數量 =", songs.length);

  if (songs.length === 0) {

    console.log("找不到歌曲");

    return null;

  }

  return songs[
    Math.floor(
      Math.random() *
      songs.length
    )
  ];

}