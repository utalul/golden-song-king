import { useState } from "react";
import Button from "../components/ui/Button";
import SearchBar from "../components/admin/SearchBar";
import SongTable from "../components/admin/SongTable";

export default function Admin() {

  const [keyword, setKeyword] =
    useState("");

  return (
    <div>

      <h1>
        🎵 題庫管理中心
      </h1>

      <SearchBar
        value={keyword}
        onChange={setKeyword}
      />

      <SongTable
        keyword={keyword}
      />

      <Button>
        同步題庫
      </Button>

    </div>
  );
}