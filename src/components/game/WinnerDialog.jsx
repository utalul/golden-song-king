import Card from "../ui/Card";
import Button from "../ui/Button";
import DevModeBadge from "./DevModeBadge";
import { RankingList } from "./RankingCard";

export default function WinnerDialog({
  winner,
  players,
  isHost,
  devMode,
  onRestart,
  developerPanel
}) {
  return (
    <div className="min-h-screen bg-black">
      <div className="min-h-screen bg-gradient-to-b from-violet-950/90 via-slate-950/95 to-black px-6 py-8 text-white">
        <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center">
          <div className="animate-victory-pop space-y-5">
            <Card className="border-yellow-400/40 bg-slate-900/95 text-center shadow-2xl">
              <DevModeBadge enabled={devMode} />

              <div className="text-5xl">
                🏆
              </div>

              <h1 className="mt-4 text-4xl font-black text-yellow-300">
                恭喜！
              </h1>

              <div className="mt-6 rounded-3xl border border-yellow-400/30 bg-violet-950/60 p-5">
                <div className="text-lg font-bold text-slate-300">
                  👑
                </div>

                <div className="mt-2 text-4xl font-black text-white">
                  {winner}
                </div>
              </div>

              <div className="mt-6 text-xl font-bold text-slate-200">
                率先獲得
              </div>

              <div className="mt-2 text-5xl font-black text-yellow-300">
                10 分！
              </div>

              <div className="mt-8 space-y-4">
                {isHost && (
                  <Button
                    variant="warning"
                    onClick={onRestart}
                  >
                    🎮 再玩一場
                  </Button>
                )}

                <Button
                  onClick={() => {
                    window.location.href = "/";
                  }}
                >
                  🏠 回首頁
                </Button>
              </div>
            </Card>

            <Card className="animate-fade-in">
              <h2 className="mb-4 text-center text-2xl font-black text-white">
                最終排行
              </h2>

              <RankingList players={players} />
            </Card>
          </div>
        </div>
      </div>

      {developerPanel}
    </div>
  );
}
