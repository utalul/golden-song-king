import Card from "../ui/Card";

export default function WaitingCard({
  answersCount,
  playersCount
}) {
  return (
    <Card className="space-y-5 text-center">
      <div>
        <h2 className="text-2xl font-black text-white">
          已送出答案
        </h2>

        <p className="mt-2 text-slate-400">
          等待其他玩家作答
          <span className="ml-1 inline-block animate-pulse">
            ...
          </span>
        </p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-sm text-slate-400">
          <span>已作答</span>
          <span>{answersCount} / {playersCount}</span>
        </div>

        <progress
          className="h-3 w-full overflow-hidden rounded-full accent-yellow-400"
          value={answersCount}
          max={playersCount || 1}
        />
      </div>
    </Card>
  );
}
