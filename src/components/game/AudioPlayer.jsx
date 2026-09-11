import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { formatTime } from "../../utils/time";

const PREVIEW_TIME = 30;

export default function AudioPlayer({
  previewUrl,
  spotifyId,
  url
}) {
  const audioRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioUrl = previewUrl || url || "";

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio || !audioUrl)
      return;

    audio.currentTime = 0;

    audio.play().catch(() => {
      // Browsers may require the player to be started manually.
    });

    return () => {
      audio.pause();
    };
  }, [audioUrl]);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;

    if (!audio)
      return;

    if (audio.currentTime >= PREVIEW_TIME) {
      audio.pause();
      if (audio.currentTime !== PREVIEW_TIME) {
        audio.currentTime = PREVIEW_TIME;
      }

      setCurrentTime(PREVIEW_TIME);
      return;
    }

    setCurrentTime(
      Math.min(audio.currentTime, PREVIEW_TIME)
    );
  };

  const handleTogglePlayback = () => {
    const audio = audioRef.current;

    if (!audio)
      return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    if (
      audio.currentTime >= PREVIEW_TIME ||
      audio.ended
    ) {
      audio.currentTime = 0;
    }

    audio.play().catch(() => {
      // Playback remains paused when the browser blocks it.
    });
  };

  if (audioUrl) {
    const playbackDuration = Math.min(
      duration || PREVIEW_TIME,
      PREVIEW_TIME
    );

    const progress = playbackDuration
      ? Math.min(
          (currentTime / playbackDuration) * 100,
          100
        )
      : 0;

    return (
      <div className="rounded-xl border border-violet-500/40 bg-slate-950 p-4">
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="auto"
          onLoadedMetadata={(event) =>
            setDuration(event.currentTarget.duration || 0)
          }
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
        />

        <div className="text-center">
          <div
            aria-hidden="true"
            className="text-4xl text-yellow-300"
          >
            ♪
          </div>

          <div
            aria-live="polite"
            className="mt-2 font-bold text-white"
          >
            {isPlaying ? "正在播放" : "等待播放"}
          </div>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full bg-violet-500 transition-[width] duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="mt-2 text-center text-sm text-slate-300">
          {formatTime(currentTime)} / {formatTime(playbackDuration)}
        </div>

        <Button
          className="mt-4"
          onClick={handleTogglePlayback}
        >
          {isPlaying ? "暫停" : "播放"}
        </Button>
      </div>
    );
  }

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
