import Card from "../ui/Card";

export default function LoadingCard() {
  return (
    <div className="mt-10">
      <Card className="text-center">
        <div className="text-2xl font-black text-yellow-400">
          載入中...
        </div>

        <div className="mt-4 h-3 rounded-full bg-slate-950">
          <div className="h-3 w-1/2 animate-pulse rounded-full bg-yellow-400" />
        </div>
      </Card>
    </div>
  );
}
