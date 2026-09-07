import Card from "../ui/Card";
import Button from "../ui/Button";

export default function HostControlCard({
  answerRevealed,
  onReveal,
  onNext,
  onRestart
}) {
  return (
    <Card className="space-y-4">
      <h2 className="text-center text-2xl font-black text-white">
        主持人控制
      </h2>

      {!answerRevealed ? (
        <Button onClick={onReveal}>
          公布答案
        </Button>
      ) : (
        <Button onClick={onNext}>
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
