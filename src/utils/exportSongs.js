export function exportSongs(songs) {
  const json = JSON.stringify(songs, null, 2);

  const blob = new Blob([json], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = "all.json";

  link.click();

  URL.revokeObjectURL(url);
}