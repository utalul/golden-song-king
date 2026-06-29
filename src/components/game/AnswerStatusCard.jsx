import Card from "../ui/Card";

export default function AnswerStatusCard({
  answersCount,
  playersCount,
  allAnswered
}) {
  return (
    <Card className="text-center">
      <div className="text-sm text-slate-400">
        已作答：{answersCount} / {playersCount}
      </div>

      {allAnswered ? (
        <div className="mt-2 text-lg font-black text-emerald-400">
          所有玩家都已作答
        </div>
      ) : (
        <div className="mt-2 text-lg font-bold text-yellow-300">
          等待玩家作答中...
        </div>
      )}
    </Card>
  );
}
