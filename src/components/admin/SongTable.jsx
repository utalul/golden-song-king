export default function SongTable({
  songs,
  keyword = "",
  selectedSong,
  onSelectSong,
  onDeleteSong
}) {
const filteredSongs = songs.filter((song) => {
  const text = `${song.songName}${song.artist}`.toLowerCase();

  return text.includes(keyword.toLowerCase());
});  
return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-slate-700">
      <table className="min-w-full divide-y divide-slate-700">
        <thead className="bg-slate-800">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-semibold text-white">
              歌名
            </th>

            <th className="px-4 py-3 text-left text-sm font-semibold text-white">
              歌手
            </th>

            <th className="px-4 py-3 text-center text-sm font-semibold text-white">
              分類
            </th>

            <th className="px-4 py-3 text-center text-sm font-semibold text-white">
              年代
            </th>

            <th className="px-4 py-3 text-center text-sm font-semibold text-white">
              難度
            </th>

<th className="px-4 py-3 text-center text-sm font-semibold text-white">
  操作
</th>
          </tr>
        </thead>

        <tbody className="divide-y divide-slate-700 bg-slate-900">
  {filteredSongs.map((song, index) => (
    <tr
  key={index}
  onClick={() => onSelectSong(song)}
  className={`
    cursor-pointer
    transition-colors
    hover:bg-slate-800
    ${
      selectedSong?.songName === song.songName &&
      selectedSong?.artist === song.artist
        ? "bg-slate-700"
        : ""
    }
  `}
>
      <td className="px-4 py-3">
        {song.songName}
      </td>

      <td className="px-4 py-3">
        {song.artist}
      </td>

      <td className="px-4 py-3 text-center">
        {song.category}
      </td>

      <td className="px-4 py-3 text-center">
        {song.decade}
      </td>

      <td className="px-4 py-3 text-center">
        {song.difficulty}
      </td>

<td className="px-4 py-3 text-center">
  <button
  className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
  onClick={(e) => {
    e.stopPropagation();
    onDeleteSong(song);
  }}
>
  🗑 刪除
</button>
</td>

    </tr>
  ))}
</tbody>
      </table>

      <div className="border-t border-slate-700 bg-slate-800 px-4 py-3 text-sm text-slate-300">
        共 {filteredSongs.length} / {songs.length} 首歌曲
      </div>
    </div>
  );
}