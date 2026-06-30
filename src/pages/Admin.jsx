import { useState } from "react";
import songsData from "../data/songs/all.json";
import Button from "../components/ui/Button";
import SearchBar from "../components/admin/SearchBar";
import SongTable from "../components/admin/SongTable";
import SongEditor from "../components/admin/SongEditor";

export default function Admin() {

  const [keyword, setKeyword] =
    useState("");
const [selectedSong, setSelectedSong] =
  useState(null);
const [songs, setSongs] = useState(songsData);
const handleSave = (updatedSong) => {
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
  return (
    <div>

      <h1>
        🎵 題庫管理中心
      </h1>

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