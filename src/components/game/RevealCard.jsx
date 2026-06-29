import Card from "../ui/Card";

export default function RevealCard({
  song,
  correctPlayers,
  scoreGain
}) {
  return (
    <Card className="animate-fade-in space-y-5 text-center">
      <div className="rounded-3xl border border-yellow-400/40 bg-violet-950/60 p-5 shadow-xl">
        <div className="text-lg font-black text-yellow-300">
          🎉 正確答案
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl bg-slate-950/70 p-4">
            <div className="text-sm text-slate-400">
              🎵 歌名
            </div>

            <div className="mt-2 text-3xl font-black text-white">
              {song.songName}
            </div>
          </div>

          {song.artist && (
            <div className="rounded-2xl bg-slate-950/70 p-4">
              <div className="text-sm text-slate-400">
                👤 歌手
              </div>

              <div className="mt-2 text-2xl font-black text-yellow-300">
                {song.artist}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-3xl border border-yellow-400/30 bg-slate-950/70 p-5">
        {correctPlayers.length > 0 ? (
          <div className="space-y-4">
            <div className="text-lg font-black text-yellow-300">
              🏆 本題得分
            </div>

            <div className="space-y-3">
              {correctPlayers.map(
                (answerData) => (
                  <div
                    key={answerData.id}
                    className="rounded-2xl border border-violet-400/30 bg-violet-950/50 p-4"
                  >
                    <div className="text-2xl font-black text-white">
                      👑 {answerData.playerName}
                    </div>

                    <div className="mt-2 text-2xl font-black text-yellow-300">
                      +{scoreGain} 分
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        ) : (
          <div className="text-2xl font-black text-slate-300">
            😢 本題沒有人答對
          </div>
        )}
      </div>
    </Card>
  );
}
