export default function SongEditor({ song }) {
  if (!song) {
    return (
      <div className="rounded-xl border border-slate-700 p-6 text-slate-400">
        👈 請先選擇一首歌曲
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 p-6">

      <h2 className="mb-6 text-xl font-bold">
        🎵 歌曲資訊
      </h2>

      <div className="space-y-4">

        <div>
          <div className="text-sm text-slate-400">
            歌名
          </div>

          <div className="font-semibold">
            {song.songName}
          </div>
        </div>

        <div>
          <div className="text-sm text-slate-400">
            歌手
          </div>

          <div className="font-semibold">
            {song.artist}
          </div>
        </div>

        <div>
          <div className="text-sm text-slate-400">
            分類
          </div>

          <div>{song.category}</div>
        </div>

        <div>
          <div className="text-sm text-slate-400">
            年代
          </div>

          <div>{song.decade}</div>
        </div>

        <div>
          <div className="text-sm text-slate-400">
            難度
          </div>

          <div>{song.difficulty}</div>
        </div>

      </div>

    </div>
  );
}