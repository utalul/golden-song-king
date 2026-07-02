import { useState } from "react";
import songsData from "../data/songs/all.json";
import Button from "../components/ui/Button";
import SearchBar from "../components/admin/SearchBar";
import SongTable from "../components/admin/SongTable";
import SongEditor from "../components/admin/SongEditor";
import { exportSongs } from "../utils/exportSongs";

export default function Admin() {

  const [keyword, setKeyword] =
    useState("");
const [selectedSong, setSelectedSong] =
  useState(null);
const [songs, setSongs] = useState(songsData);
const handleSave = (updatedSong) => {

  // 新增歌曲
  if (updatedSong.isNew) {

    const newSong = {
      ...updatedSong,
    };

    delete newSong.isNew;

    setSongs([
      ...songs,
      newSong,
    ]);

    setSelectedSong(newSong);

    return;
  }

  // 編輯歌曲
  setSongs(
    songs.map((song) => {

      if (
        song.songName === selectedSong.songName &&
        song.artist === selectedSong.artist
      ) {
        return updatedSong;
      }

      return song;
    })
  );

  setSelectedSong(updatedSong);

};
  
const handleExport = () => {
  exportSongs(songs);
};

const handleDelete = (songToDelete) => {

  if (!confirm(`確定要刪除「${songToDelete.songName}」嗎？`)) {
    return;
  }

  setSongs(
    songs.filter(
      (song) =>
        !(
          song.songName === songToDelete.songName &&
          song.artist === songToDelete.artist
        )
    )
  );

  if (
    selectedSong &&
    selectedSong.songName === songToDelete.songName &&
    selectedSong.artist === songToDelete.artist
  ) {
    setSelectedSong(null);
  }
};

return (
    <div>

      <h1>
        🎵 題庫管理中心
      </h1>

<div className="my-4 flex gap-3">

  <button
    className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700"
    onClick={() =>
      setSelectedSong({
        songName: "",
        artist: "",
        category: "mandarin",
        decade: "2000",
        difficulty: 1,
        isNew: true,
      })
    }
  >
    ➕ 新增歌曲
  </button>

  <button
    onClick={handleExport}
    className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
  >
    📥 匯出 JSON
  </button>

</div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

  <div className="lg:col-span-2">

    <SearchBar
      value={keyword}
      onChange={setKeyword}
    />

    <SongTable
  songs={songs}
  keyword={keyword}
  selectedSong={selectedSong}
  onSelectSong={setSelectedSong}
  onDeleteSong={handleDelete}
/>

  </div>

  <SongEditor
  song={selectedSong}
  onSave={handleSave}
/>

</div>

<Button className="mt-6">
  同步題庫
</Button>

    </div>
  );
}