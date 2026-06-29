import Card from "../ui/Card";
import Button from "../ui/Button";
import Input from "../ui/Input";

export default function AnswerInput({
  answer,
  onAnswerChange,
  onSubmit,
  timeExpired
}) {
  return (
    <Card className="space-y-5">
      <div>
        <div className="mb-2 text-sm text-slate-400">
          輸入答案
        </div>

        <Input
          value={answer}
          onChange={onAnswerChange}
          placeholder="請輸入你的答案"
          disabled={timeExpired}
        />
      </div>

      <Button
        disabled={timeExpired}
        onClick={onSubmit}
      >
        送出答案
      </Button>

      {timeExpired && (
        <div className="text-center text-lg font-black text-red-300">
          ⏰ 作答時間結束
        </div>
      )}
    </Card>
  );
}
