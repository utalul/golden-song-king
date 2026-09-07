export default function AudioPlayer({ spotifyId }) {
  if (!spotifyId) {
    return (
      <div className="rounded-xl border border-slate-700 p-4 text-center text-sm text-slate-300">
        找不到 Spotify Preview
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <iframe
        title="Spotify Preview"
        src={`https://open.spotify.com/embed/track/${spotifyId}`}
        width="100%"
        height="152"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="block w-full"
      />
    </div>
  );
}
