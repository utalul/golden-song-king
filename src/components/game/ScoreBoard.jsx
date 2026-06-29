import Card from "../ui/Card";

export default function ScoreBoard({
  currentQuestion,
  modeText,
  currentScore
}) {
  return (
    <Card>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-2xl bg-slate-950/70 p-3">
          <div className="text-xs text-slate-400">
            目前題目
          </div>

          <div className="mt-1 text-2xl font-black text-yellow-300">
            {currentQuestion}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-950/70 p-3">
          <div className="text-xs text-slate-400">
            遊戲模式
          </div>

          <div className="mt-1 text-lg font-black text-yellow-300">
            {modeText}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-950/70 p-3">
          <div className="text-xs text-slate-400">
            目前分數
          </div>

          <div className="mt-1 text-2xl font-black text-yellow-300">
            {currentScore}
          </div>
        </div>
      </div>
    </Card>
  );
}
