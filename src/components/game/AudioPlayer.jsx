import { useRef } from "react";
import Button from "../ui/Button";

export default function AudioPlayer({ url }) {

  const audioRef = useRef(null);

  const handlePlay = () => {
    if (!audioRef.current) return;
    audioRef.current.play();
  };

  const handlePause = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
  };

  return (
    <div className="rounded-xl border border-slate-700 p-4">

      <audio
        ref={audioRef}
        src={url}
      />

      <div className="flex gap-3">

        <Button
          onClick={handlePlay}
        >
          ▶️ 播放
        </Button>

        <Button
          onClick={handlePause}
        >
          ⏸️ 暫停
        </Button>

      </div>

    </div>
  );
}