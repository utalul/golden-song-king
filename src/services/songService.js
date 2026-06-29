import {
  collection,
  getDocs
} from "firebase/firestore";

import { db } from "../firebase/firebase";

export async function getRandomSong() {

  const snapshot =
    await getDocs(
      collection(db, "songs")
    );

  const songs = [];

  snapshot.forEach((docSnap) => {
    songs.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  if (songs.length === 0) {
    return null;
  }

  return songs[
    Math.floor(
      Math.random() *
      songs.length
    )
  ];
}