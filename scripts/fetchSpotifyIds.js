/* global process */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import {
  searchTrack,
  sleep
} from "../src/services/spotifyService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({
  path: path.join(projectRoot, ".env.local"),
  quiet: true
});

const INPUT_FILE = process.argv[2] ?? "src/data/songs/all.json";
const OUTPUT_FILE = process.argv[3] ?? "src/data/songs/all_with_spotify.json";
const inputPath = path.resolve(projectRoot, INPUT_FILE);
const outputPath = path.resolve(projectRoot, OUTPUT_FILE);
const retryStatusCodes = new Set([429, 500, 502, 503]);
const maxRetryCount = 3;

function readSongs(filePath) {
  return JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );
}

function writeSongs(filePath, songs) {
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(songs, null, 2)}\n`,
    "utf8"
  );
}

function getRetryStatus(error) {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:failed:|失敗：)\s*(\d{3})/);

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

async function searchTrackWithRetry(songName, artist) {
  for (let attempt = 0; attempt <= maxRetryCount; attempt += 1) {
    try {
      return await searchTrack(songName, artist);
    } catch (error) {
      const status = getRetryStatus(error);
      const shouldRetry = retryStatusCodes.has(status) && attempt < maxRetryCount;

      if (!shouldRetry) {
        throw error;
      }

      await sleep(1000);
    }
  }

  return null;
}

async function main() {
  const songsPath = fs.existsSync(outputPath) ? outputPath : inputPath;
  const songs = readSongs(songsPath);

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index];
    const songName = song.songName ?? "";
    const artist = song.artist ?? "";
    const progress = `[${index + 1}/${songs.length}] ${songName}`;

    if (song.spotifyId) {
      skippedCount += 1;
      console.log(`${progress} 略過`);
      continue;
    }

    try {
      const track = await searchTrackWithRetry(songName, artist);

      if (track?.id) {
        song.spotifyId = track.id;
        successCount += 1;
        console.log(`${progress} ✔`);
      } else {
        failedCount += 1;
        console.log(`${progress} 找不到 ✘`);
      }
    } catch (error) {
      failedCount += 1;
      console.log(`${progress} 找不到 ✘`);
      console.error(error);
    }

    writeSongs(outputPath, songs);
    await sleep(150);
  }

  console.log(`成功：${successCount}`);
  console.log(`失敗：${failedCount}`);
  console.log(`略過：${skippedCount}`);
  console.log(`總共：${songs.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
