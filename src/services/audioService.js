export function getAudioUrl(song) {

  if (!song) return "";

  // 優先使用 previewUrl
  if (song.previewUrl) {
    return song.previewUrl;
  }

  // 預留 Spotify
  if (song.spotifyId) {
    return "";
  }

  return "";
}