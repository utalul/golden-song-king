export default function DevModeBadge({
  enabled
}) {
  if (!enabled) return null;

  return (
    <div className="mt-6 text-center">
      <span className="rounded-full border border-yellow-400/40 bg-violet-950/70 px-4 py-2 text-sm font-black text-yellow-300">
        🧪 開發模式
      </span>
    </div>
  );
}
