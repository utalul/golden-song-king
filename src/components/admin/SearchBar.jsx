export default function SearchBar({
  value,
  onChange
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="搜尋歌名或歌手..."
      className="
        w-full
        rounded-xl
        border
        border-slate-700
        bg-slate-900
        px-4
        py-3
        text-white
        placeholder:text-slate-400
        focus:outline-none
        focus:ring-2
        focus:ring-sky-500
      "
    />
  );
}