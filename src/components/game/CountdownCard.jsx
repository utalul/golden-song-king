import Card from "../ui/Card";

export default function CountdownCard({
  timeLeft,
  questionTime,
  timeExpired
}) {
  const timerColor =
    timeLeft <= 5
      ? "accent-red-500"
      : timeLeft <= 10
        ? "accent-orange-500"
        : "accent-emerald-500";

  const timerTextColor =
    timeLeft <= 5
      ? "text-red-400"
      : timeLeft <= 10
        ? "text-orange-400"
        : "text-emerald-400";

  const timerPulse =
    timeLeft <= 5
      ? "animate-pulse"
      : "";

  return (
    <Card className="space-y-4 text-center">
      <div className="text-sm font-bold uppercase tracking-widest text-yellow-400">
        倒數計時
      </div>

      <div className={`text-6xl font-black ${timerTextColor} ${timerPulse}`}>
        {timeLeft}
      </div>

      <progress
        className={`
          h-4
          w-full
          overflow-hidden
          rounded-full
          bg-slate-950
          transition-all
          duration-1000
          ease-linear
          ${timerColor}
        `}
        value={timeLeft}
        max={questionTime}
      />

      {timeExpired && (
        <div className="rounded-2xl border border-red-400/30 bg-red-950/40 px-4 py-3 text-lg font-black text-red-300">
          ⏰ 作答時間結束
        </div>
      )}
    </Card>
  );
}
