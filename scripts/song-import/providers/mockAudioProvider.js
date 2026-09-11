import { normalizeMatchText } from "../matchEngine.js";

const VALID_PREVIEW_URL =
  "https://example.invalid/audio/mock-preview.mp3";

function scenarioKey(songName, artist) {
  return `${normalizeMatchText(songName)}\u0000${normalizeMatchText(artist)}`;
}

function candidate({
  id,
  songName,
  artist,
  previewUrl = VALID_PREVIEW_URL,
  metadata = {}
}) {
  return {
    provider: "mock",
    providerTrackId: id,
    matchedSongName: songName,
    matchedArtist: artist,
    previewUrl,
    duration: 30,
    metadata
  };
}

const scenarios = new Map([
  [
    scenarioKey("精準配對測試", "測試歌手甲"),
    candidate({
      id: "mock-exact",
      songName: "精準配對測試",
      artist: "測試歌手甲"
    })
  ],
  [
    scenarioKey("月亮代表我的心", "鄧麗君"),
    candidate({
      id: "mock-exact-no-preview",
      songName: "月亮代表我的心",
      artist: "鄧麗君",
      previewUrl: null
    })
  ],
  [
    scenarioKey("歌手不符測試", "正確歌手"),
    candidate({
      id: "mock-artist-mismatch",
      songName: "歌手不符測試",
      artist: "其他歌手"
    })
  ],
  [
    scenarioKey("微小差異測試", "測試歌手丙"),
    candidate({
      id: "mock-similar-title",
      songName: "微小差異測試（現場版）",
      artist: "測試歌手丙"
    })
  ],
  [
    scenarioKey("模糊配對測試", "測試歌手丁"),
    candidate({
      id: "mock-ambiguous",
      songName: "模糊配對測試",
      artist: "測試歌手丁",
      metadata: {
        ambiguous: true,
        candidateCount: 3
      }
    })
  ],
  [
    scenarioKey("找不到測試", "測試歌手戊"),
    null
  ]
]);

export const mockAudioProvider = {
  name: "mock",

  async searchTrack({ songName, artist }) {
    const key = scenarioKey(songName, artist);

    if (key === scenarioKey("Provider 錯誤測試", "測試歌手己")) {
      throw new Error("Mock provider lookup failed");
    }

    return scenarios.get(key) ?? null;
  }
};
