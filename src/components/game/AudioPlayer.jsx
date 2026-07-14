import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { formatTime } from "../../utils/time";

export default function AudioPlayer({ url }) {
  const audioRef = useRef(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const handlePlay = () => {
    if (!audioRef.current) return;

    audioRef.current.play().catch((err) => {
      console.log(err);
    });
  };

  const handlePause = () => {
    if (!audioRef.current) return;

    audioRef.current.pause();
  };

  const handleStop = () => {
    if (!audioRef.current) return;

    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  };

  // 監聽播放時間
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    audio.addEventListener(
      "timeupdate",
      handleTimeUpdate
    );

    audio.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata
    );

    return () => {
      audio.removeEventListener(
        "timeupdate",
        handleTimeUpdate
      );

      audio.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata
      );
    };
  }, []);

  // 換歌自動播放
  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) return;

    if (!url) return;

    audio.pause();
    audio.currentTime = 0;

    audio.load();

    audio
      .play()
      .catch((err) => {
        console.log(
          "Auto Play:",
          err.message
        );
      });
  }, [url]);

  return (
    <div className="rounded-xl border border-slate-700 p-4">

      <audio
        ref={audioRef}
        src={url}
        preload="auto"
      />

      <div className="mb-4 text-center text-sm text-slate-300">
        {formatTime(currentTime)} / {formatTime(duration)}
      </div>

      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{
            width: duration
              ? `${(currentTime / duration) * 100}%`
              : "0%",
          }}
        />
      </div>

      <div className="flex gap-3">
        <Button onClick={handlePlay}>
          ▶️ 播放
        </Button>

        <Button onClick={handlePause}>
          ⏸️ 暫停
        </Button>

        <Button onClick={handleStop}>
          ⏹️ 停止
        </Button>
      </div>

    </div>
  );
}