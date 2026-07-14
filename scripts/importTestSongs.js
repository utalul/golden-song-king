import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync(
    "./scripts/serviceAccountKey.json",
    "utf8"
  )
);

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();

const testSongs = [
  {
    id: "TEST001",
    songName: "測試歌1",
    artist: "ChatGPT",
    category: "mandarin",
    decade: "2020",
    difficulty: 1,
    spotifyId: "",
    previewUrl: "/audio/test.mp3",
    isTest: true,
  },
  {
    id: "TEST002",
    songName: "測試歌2",
    artist: "ChatGPT",
    category: "mandarin",
    decade: "2020",
    difficulty: 1,
    spotifyId: "",
    previewUrl: "/audio/test.mp3",
    isTest: true,
  },
];

async function main() {
  for (const song of testSongs) {
    const { id, ...data } = song;

    await db
      .collection("songs")
      .doc(id)
      .set(data, { merge: true });

    console.log(`✅ ${id} 匯入完成`);
  }

  console.log("🎉 全部完成");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });