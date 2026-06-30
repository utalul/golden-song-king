import { useEffect, useState } from "react";
import Button from "../ui/Button";

export default function SongEditor({ song }) {
  const [editingSong, setEditingSong] = useState(null);

  useEffect(() => {
    setEditingSong(song);
  }, [song]);

  if (!editingSong) {
    return (
      <div className="rounded-xl border border-slate-700 p-6 text-slate-400">
        👈 請先選擇一首歌曲
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-6">

      <h2 className="mb-6 text-xl font-bold">
        🎵 歌曲資訊
      </h2>

      <div className="space-y-5">

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            歌名
          </label>

          <input
  value={editingSong.songName}
  onChange={(e) =>
    setEditingSong({
      ...editingSong,
      songName: e.target.value,
    })
  }
  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
/>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            歌手
          </label>

          <input
  value={editingSong.artist}
  onChange={(e) =>
    setEditingSong({
      ...editingSong,
      artist: e.target.value,
    })
  }
  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
/>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            分類
          </label>

          <select
  value={editingSong.category}
  onChange={(e) =>
    setEditingSong({
      ...editingSong,
      category: e.target.value,
    })
  }
className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
>
            <option value="mandarin">華語</option>
            <option value="taiwanese">台語</option>
            <option value="western">西洋</option>
            <option value="kpop">K-POP</option>
            <option value="anime">動漫</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            年代
          </label>

          <select
            value={editingSong.decade}
            onChange={(e) =>
  setEditingSong({
    ...editingSong,
    decade: e.target.value,
  })
}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
          >
            <option value="1970">1970</option>
            <option value="1980">1980</option>
            <option value="1990">1990</option>
            <option value="2000">2000</option>
            <option value="2010">2010</option>
            <option value="2020">2020</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-400">
            難度
          </label>

          <select
            value={editingSong.difficulty}
            onChange={(e) =>
  setEditingSong({
    ...editingSong,
    difficulty: Number(e.target.value),
  })
}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </div>

        <Button
          disabled
          className="mt-6 w-full"
        >
          💾 儲存（開發中）
        </Button>

      </div>
    </div>
  );
}