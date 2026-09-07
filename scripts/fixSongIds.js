import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, "../src/data/songs/all.json");

const songs = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

let kept = 0;
let added = 0;

const formatId = (num) => `M${String(num).padStart(6, "0")}`;

songs.forEach((song, index) => {
  if (song.id) {
    kept++;
    console.log(`[${index + 1}/${songs.length}] 保留 ${song.id}`);
    return;
  }

  song.id = formatId(index + 1);
  added++;

  console.log(`[${index + 1}/${songs.length}] 新增 ${song.id}`);
});

fs.writeFileSync(
  jsonPath,
  JSON.stringify(songs, null, 2),
  "utf8"
);

console.log("\n======================");
console.log(`保留：${kept}`);
console.log(`新增：${added}`);
console.log(`總數：${songs.length}`);
console.log("======================");