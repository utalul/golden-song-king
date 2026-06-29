import Card from "../ui/Card";

export default function QuestionCard({
  currentQuestion,
  modeText,
  playerName
}) {
  return (
    <Card className="text-center">
      <div className="text-sm text-slate-400">
        第 {currentQuestion} 題
      </div>

      <h1 className="mt-3 text-4xl font-black text-white">
        {modeText}
      </h1>

      <div className="mt-4 rounded-2xl border border-violet-400/30 bg-violet-950/40 px-4 py-3 text-sm font-bold text-yellow-300">
        玩家：{playerName}
      </div>
    </Card>
  );
}
