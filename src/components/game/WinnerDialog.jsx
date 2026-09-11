import DevModeBadge from "./DevModeBadge";

function getRankVisual(index) {
  if (index === 0) {
    return {
      icon: "\uD83D\uDC51",
      rowClass:
        "border-[#FFD95A]/60 bg-[linear-gradient(105deg,rgba(125,78,5,0.76),rgba(53,24,73,0.88))] shadow-[0_0_24px_rgba(245,197,66,0.16)]",
      iconClass:
        "border-[#FFE58A]/60 bg-[#5B3708]/85 text-[#FFE47A] shadow-[0_0_16px_rgba(245,197,66,0.22)]"
    };
  }

  if (index === 1) {
    return {
      icon: "\uD83E\uDD48",
      rowClass:
        "border-[#C9C5E8]/35 bg-[linear-gradient(105deg,rgba(62,55,93,0.78),rgba(28,15,52,0.88))]",
      iconClass:
        "border-[#DAD7EF]/45 bg-[#3C365F]/80 text-[#F1EFFF]"
    };
  }

  if (index === 2) {
    return {
      icon: "\uD83E\uDD49",
      rowClass:
        "border-[#C98755]/35 bg-[linear-gradient(105deg,rgba(79,43,39,0.74),rgba(31,16,48,0.88))]",
      iconClass:
        "border-[#D99A68]/45 bg-[#563126]/80 text-[#F3B783]"
    };
  }

  return {
    icon: `${index + 1}`,
    rowClass: "border-[#8B2CF5]/20 bg-[#1B0D30]/70",
    iconClass: "border-[#8B2CF5]/35 bg-[#291344]/80 text-[#CFA6FF]"
  };
}

export default function WinnerDialog({
  winner,
  players,
  isHost,
  devMode,
  onRestart,
  developerPanel
}) {
  const currentPlayerName =
    window.localStorage.getItem("playerName") || "";
  const winnerPlayer =
    players.find((player) => player.name === winner) || players[0];
  const winnerScore = winnerPlayer?.score ?? 0;

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[#07030D] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-4%,rgba(139,44,245,0.34),transparent_31%),radial-gradient(circle_at_50%_48%,rgba(245,197,66,0.08),transparent_32%),linear-gradient(180deg,#12051F_0%,#0B0414_48%,#07030D_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 -top-16 h-[34rem] w-44 origin-top rotate-[24deg] bg-[linear-gradient(180deg,rgba(193,92,255,0.18),rgba(139,44,245,0.03),transparent)] [clip-path:polygon(42%_0,68%_0,100%_100%,0_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-16 h-[34rem] w-44 origin-top -rotate-[24deg] bg-[linear-gradient(180deg,rgba(245,197,66,0.12),rgba(139,44,245,0.03),transparent)] [clip-path:polygon(32%_0,58%_0,100%_100%,0_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(circle_at_13%_16%,rgba(255,224,122,0.9)_0_1px,transparent_2px),radial-gradient(circle_at_84%_20%,rgba(193,92,255,0.9)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_22%_42%,rgba(255,255,255,0.55)_0_1px,transparent_2px),radial-gradient(circle_at_74%_38%,rgba(255,214,90,0.7)_0_1px,transparent_2px),radial-gradient(circle_at_91%_59%,rgba(193,92,255,0.55)_0_1px,transparent_2px)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-[radial-gradient(ellipse_at_bottom,rgba(139,44,245,0.24),transparent_68%)] before:absolute before:inset-x-[12%] before:bottom-7 before:h-px before:bg-[linear-gradient(90deg,transparent,rgba(193,92,255,0.6),rgba(245,197,66,0.4),rgba(193,92,255,0.6),transparent)]"
      />

      <main className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[460px] flex-col px-5 py-8 sm:px-6 sm:py-10">
        <DevModeBadge enabled={devMode} />

        <header className="relative text-center">
          <span
            aria-hidden="true"
            className="absolute left-[18%] top-4 text-xl text-[#FFD95A] drop-shadow-[0_0_8px_rgba(255,217,90,0.7)]"
          >
            ✦
          </span>
          <span
            aria-hidden="true"
            className="absolute right-[20%] top-10 text-sm text-[#C15CFF] drop-shadow-[0_0_7px_rgba(193,92,255,0.7)]"
          >
            ✦
          </span>
          <div
            aria-hidden="true"
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[#F5C542]/35 bg-[#2A133A]/75 text-3xl shadow-[0_0_28px_rgba(245,197,66,0.22)]"
          >
            🎉
          </div>
          <h1 className="mt-3 text-[clamp(1.75rem,7vw,1.875rem)] font-extrabold leading-tight">
            遊戲結束
          </h1>
          <p className="mt-1 text-base font-semibold text-[#D6C3EA]">
            最終結果
          </p>
        </header>

        <section className="relative mt-6 overflow-hidden rounded-[24px] border border-[#F5C542]/35 bg-[linear-gradient(155deg,rgba(64,31,81,0.88),rgba(18,7,31,0.94))] px-5 py-7 text-center shadow-[0_18px_55px_rgba(0,0,0,0.42),0_0_34px_rgba(245,197,66,0.1)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-10 -top-20 h-56 rounded-full bg-[radial-gradient(circle,rgba(245,197,66,0.26),rgba(139,44,245,0.1)_45%,transparent_70%)]"
          />
          <span
            aria-hidden="true"
            className="absolute left-7 top-10 text-sm text-[#FFE58A] drop-shadow-[0_0_8px_rgba(245,197,66,0.7)]"
          >
            ✦
          </span>
          <span
            aria-hidden="true"
            className="absolute right-7 top-20 text-lg text-[#FFD95A] drop-shadow-[0_0_10px_rgba(245,197,66,0.7)]"
          >
            ✦
          </span>

          <div className="relative">
            <div className="text-4xl drop-shadow-[0_0_16px_rgba(245,197,66,0.45)]">
              👑
            </div>
            <p className="mt-2 text-[21px] font-bold text-[#FFF1B0]">
              恭喜
            </p>
            <p className="mt-2 break-words bg-[linear-gradient(180deg,#FFF6BF_0%,#FFD95A_38%,#F2B51F_72%,#C98600_100%)] bg-clip-text text-[clamp(2.25rem,10vw,2.75rem)] font-extrabold leading-tight text-transparent [text-shadow:0_0_18px_rgba(255,196,45,0.16)]">
              {winner}
            </p>
            <p className="mt-2 text-[22px] font-bold">
              獲得勝利！
            </p>
            <div className="mx-auto mt-5 inline-flex min-h-12 items-center rounded-full border border-[#F5C542]/35 bg-black/25 px-6 text-[26px] font-extrabold text-[#FFD95A] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              {winnerScore} 分
            </div>
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-4 flex items-center justify-between px-1">
            <h2 className="text-[23px] font-extrabold">
              最終排行榜
            </h2>
            <span className="text-[15px] font-semibold text-[#B9AFCB]">
              共 {players.length} 人
            </span>
          </div>

          <div className="max-h-80 space-y-3 overflow-y-auto pr-1 [scrollbar-color:rgba(139,44,245,0.5)_transparent] [scrollbar-width:thin]">
            {players.map((player, index) => {
              const rankVisual = getRankVisual(index);
              const isCurrentPlayer =
                player.name === currentPlayerName;

              return (
                <div
                  key={player.id}
                  className={`flex min-h-16 items-center gap-3 rounded-2xl border px-3.5 py-3 ${rankVisual.rowClass}`}
                >
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl font-extrabold ${rankVisual.iconClass}`}
                  >
                    {rankVisual.icon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[19px] font-bold">
                        {player.name}
                      </span>
                      {isCurrentPlayer && (
                        <span className="shrink-0 rounded-full border border-[#C15CFF]/40 bg-[#8B2CF5]/20 px-2 py-0.5 text-sm font-bold text-[#E6C8FF]">
                          我
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[15px] font-medium text-[#B9AFCB]">
                      第 {index + 1} 名
                    </p>
                  </div>

                  <div className="shrink-0 text-xl font-extrabold text-[#FFD95A]">
                    {player.score} 分
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <div className="mt-7 space-y-3 pb-4">
          {isHost && (
            <button
              type="button"
              onClick={onRestart}
              className="min-h-16 w-full rounded-[18px] border border-[#FFE58A]/55 bg-[linear-gradient(180deg,#FFD957_0%,#EFB01A_55%,#C88300_100%)] px-5 text-xl font-bold text-[#241300] shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_8px_24px_rgba(230,160,0,0.24)] transition duration-200 hover:-translate-y-0.5 hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFF0A6] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090511] active:translate-y-px active:scale-[0.99]"
            >
              再來一局
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="min-h-[58px] w-full rounded-[18px] border border-[#8B2CF5]/50 bg-[#1B0D30]/70 px-5 text-lg font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition duration-200 hover:border-[#C15CFF]/75 hover:bg-[#2A1247]/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C15CFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#090511] active:translate-y-px"
          >
            返回首頁
          </button>
        </div>
      </main>

      {developerPanel}
    </div>
  );
}
