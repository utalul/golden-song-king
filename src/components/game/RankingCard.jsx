import Card from "../ui/Card";

function rankingIcon(index) {
  if (index === 0)
    return "\uD83D\uDC51";

  if (index === 1)
    return "\uD83E\uDD48";

  if (index === 2)
    return "\uD83E\uDD49";

  return `${index + 1}`;
}

export function RankingList({
  players
}) {
  return (
    <div className="space-y-3">
      {players.map(
        (player, index) => (
          <div
            key={player.id}
            className="
              flex
              items-center
              gap-3
              rounded-2xl
              border
              border-slate-700
              bg-slate-950/70
              px-4
              py-3
            "
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-900 text-xl font-black text-yellow-300">
              {rankingIcon(index)}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold text-white">
                {player.name}
              </div>

              <div className="text-sm text-slate-400">
                第 {index + 1} 名
              </div>
            </div>

            <div className="text-xl font-black text-yellow-300">
              {player.score} 分
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default function RankingCard({
  players
}) {
  return (
    <Card>
      <h2 className="mb-4 text-center text-2xl font-black text-white">
        排行榜
      </h2>

      <RankingList players={players} />
    </Card>
  );
}
