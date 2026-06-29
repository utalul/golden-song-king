import Card from "../ui/Card";
import Button from "../ui/Button";

export default function HostControlCard({
  answerRevealed,
  allAnswered,
  timeExpired,
  onReveal,
  onNext,
  onRestart
}) {
  return (
    <Card className="space-y-4">
      <h2 className="text-center text-2xl font-black text-white">
        房主控制
      </h2>

      {!answerRevealed && (
        <>
          <Button
            variant="warning"
            disabled={
              !allAnswered &&
              !timeExpired
            }
            onClick={onReveal}
          >
            公布答案
          </Button>

          {!allAnswered && !timeExpired && (
            <div className="text-center text-sm text-slate-400">
              等待所有玩家作答後即可公布答案
            </div>
          )}

          {!allAnswered && timeExpired && (
            <div className="text-center text-sm text-red-300">
              作答時間已結束，房主可以公布答案
            </div>
          )}
        </>
      )}

      {answerRevealed && (
        <Button
          variant="success"
          onClick={onNext}
        >
          下一題
        </Button>
      )}

      <Button
        variant="danger"
        onClick={onRestart}
      >
        重新開始遊戲
      </Button>
    </Card>
  );
}
