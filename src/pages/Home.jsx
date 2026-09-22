import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import Page from "../components/ui/Page";

import { clearActivityMode } from "../utils/activityMode";

export default function Home() {
  useEffect(() => clearActivityMode(), []);
  const [instructionsOpen, setInstructionsOpen] =
    useState(false);

  const [menuOpen, setMenuOpen] =
    useState(false);

  return (
    <Page>
      <div className="relative -mx-6 -my-6 min-h-[100dvh] overflow-hidden bg-[#07030D]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgba(139,44,245,0.3),transparent_34%),linear-gradient(180deg,#12051F_0%,#0B0414_48%,#07030D_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-28 -top-20 h-[560px] w-[310px] origin-top rotate-[18deg] bg-[linear-gradient(90deg,transparent_5%,rgba(166,77,255,0.04)_19%,rgba(166,77,255,0.25)_50%,rgba(166,77,255,0.04)_81%,transparent_95%)] opacity-90 [clip-path:polygon(42%_0,58%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.88)_48%,transparent_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-20 h-[560px] w-[310px] origin-top -rotate-[18deg] bg-[linear-gradient(90deg,transparent_5%,rgba(193,92,255,0.04)_19%,rgba(193,92,255,0.23)_50%,rgba(193,92,255,0.04)_81%,transparent_95%)] opacity-90 [clip-path:polygon(42%_0,58%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,#000_0%,rgba(0,0,0,0.88)_48%,transparent_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(255,243,166,0.62)_0_1px,transparent_2px),radial-gradient(circle_at_19%_33%,rgba(166,77,255,0.48)_0_1.5px,transparent_2.5px),radial-gradient(circle_at_87%_17%,rgba(255,211,77,0.58)_0_1px,transparent_2px),radial-gradient(circle_at_73%_29%,rgba(255,255,255,0.42)_0_1px,transparent_2px),radial-gradient(circle_at_95%_46%,rgba(193,92,255,0.42)_0_2px,transparent_3px),radial-gradient(circle_at_13%_58%,rgba(255,211,77,0.38)_0_1px,transparent_2px),radial-gradient(circle_at_31%_71%,rgba(255,255,255,0.28)_0_1px,transparent_2px),radial-gradient(circle_at_84%_76%,rgba(166,77,255,0.36)_0_1.5px,transparent_2.5px)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-18%] bottom-0 h-28 bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,211,77,0.11)_0%,rgba(118,34,215,0.2)_34%,transparent_72%),linear-gradient(72deg,transparent_39%,rgba(139,44,245,0.12)_50%,transparent_61%),linear-gradient(108deg,transparent_39%,rgba(193,92,255,0.1)_50%,transparent_61%),linear-gradient(180deg,transparent_0%,rgba(118,34,215,0.09)_62%,rgba(80,19,166,0.25)_100%)] [clip-path:polygon(22%_0,78%_0,100%_100%,0_100%)] [mask-image:linear-gradient(to_bottom,transparent_0%,#000_30%,#000_100%)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-8%] bottom-12 h-px bg-gradient-to-r from-transparent via-[#A848FF]/60 to-transparent shadow-[0_0_14px_rgba(168,72,255,0.42)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[16%] bottom-8 h-px bg-gradient-to-r from-transparent via-[#FFD95A]/60 to-transparent shadow-[0_0_10px_rgba(255,205,70,0.35)]"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-16%] bottom-0 h-9 rounded-[50%_50%_0_0] border-t border-[#A64DFF]/45 bg-[linear-gradient(180deg,rgba(139,44,245,0.16),rgba(7,3,13,0.5))] shadow-[0_-12px_38px_rgba(139,44,245,0.2)]"
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[7%] top-[23%] rotate-[-18deg] text-5xl text-[#C15CFF] opacity-[0.07]"
        >
          ♪
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[6%] top-[37%] rotate-[16deg] text-4xl text-[#FFD34D] opacity-[0.08]"
        >
          ♫
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[12%] top-[13%] text-xl text-[#FFF6BF] opacity-55 drop-shadow-[0_0_7px_rgba(255,217,90,0.7)]"
        >
          ✦
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-[11%] top-[19%] text-2xl text-[#FFD95A] opacity-45 drop-shadow-[0_0_8px_rgba(255,190,40,0.68)]"
        >
          ✦
        </span>

        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[8%] top-[46%] text-base text-[#C15CFF] opacity-35 drop-shadow-[0_0_7px_rgba(193,92,255,0.75)]"
        >
          ✦
        </span>

        <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[430px] flex-col px-6 pb-4 pt-11">
          <button
            type="button"
            title="其他功能"
            aria-label="開啟其他功能"
            aria-expanded={menuOpen}
            aria-controls="home-secondary-menu"
            onClick={() =>
              setMenuOpen(
                (currentOpen) => !currentOpen
              )
            }
            className="absolute right-6 top-5 z-30 flex size-[42px] items-center justify-center rounded-full border border-[#A64DFF]/25 bg-[#10051E]/65 text-lg text-[#B8AEC8] shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition duration-200 hover:border-[#FFD34D]/45 hover:text-[#FFD34D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD34D] active:scale-95"
          >
            ⚙
          </button>

          {menuOpen && (
            <div
              id="home-secondary-menu"
              className="absolute right-6 top-[70px] z-30 w-52 rounded-[16px] border border-[#A64DFF]/30 bg-[#0D0618]/95 p-3 shadow-[0_20px_56px_rgba(0,0,0,0.58)] backdrop-blur-xl"
            >
              <div className="px-2 pb-2 text-xs font-bold text-[#B8AEC8]">
                其他功能
              </div>

              <div className="space-y-1">
                {["題庫管理", "排行榜", "設定"].map(
                  (item) => (
                    <button
                      key={item}
                      type="button"
                      disabled
                      className="flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-sm text-[#B8AEC8] opacity-55"
                    >
                      <span>{item}</span>
                      <span className="text-[10px]">
                        未開放
                      </span>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          <main className="flex flex-1 flex-col">
            <section className="relative text-center">
              <span
                aria-hidden="true"
                className="absolute left-2 top-5 text-sm text-[#FFD34D] drop-shadow-[0_0_5px_rgba(255,211,77,0.8)]"
              >
                ✦
              </span>

              <span
                aria-hidden="true"
                className="absolute left-10 top-[86px] text-[8px] text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.75)]"
              >
                ✦
              </span>

              <span
                aria-hidden="true"
                className="absolute right-4 top-14 text-lg text-[#FFD34D] drop-shadow-[0_0_7px_rgba(255,211,77,0.75)]"
              >
                ✦
              </span>

              <span
                aria-hidden="true"
                className="absolute right-11 top-2 text-[10px] text-[#C15CFF] drop-shadow-[0_0_5px_rgba(193,92,255,0.8)]"
              >
                ✦
              </span>

              <div className="relative mx-auto flex h-[94px] w-[112px] items-center justify-center">
                <div
                  aria-hidden="true"
                  className="absolute -inset-8 bg-[radial-gradient(circle,rgba(255,217,90,0.42)_0%,rgba(139,44,245,0.16)_38%,transparent_68%)]"
                />

                <div
                  aria-hidden="true"
                  className="absolute size-[84px] rounded-full border border-[#C15CFF]/20 shadow-[0_0_20px_rgba(139,44,245,0.18)]"
                />

                <div
                  aria-hidden="true"
                  className="absolute size-[76px] rounded-full border border-[#FFD95A]/55 bg-[radial-gradient(circle_at_36%_28%,rgba(255,246,191,0.28),rgba(118,34,215,0.22)_48%,rgba(8,4,15,0.82)_72%)] shadow-[0_0_22px_rgba(255,205,70,0.26),inset_0_1px_0_rgba(255,246,191,0.3),inset_0_0_18px_rgba(166,77,255,0.24)]"
                />

                <span className="relative translate-y-1 text-[64px] font-black leading-none text-[#FFD34D] drop-shadow-[0_0_14px_rgba(255,211,77,0.72)]">
                  ♪
                </span>

                <span
                  aria-hidden="true"
                  className="absolute right-1 top-0 rotate-12 text-[27px] text-[#FFF3A6] drop-shadow-[0_0_12px_rgba(255,211,77,0.72)]"
                >
                  ♛
                </span>
              </div>

              <h1 className="mt-1 whitespace-nowrap text-[50px] font-black leading-none text-transparent sm:text-[56px]">
                <span className="bg-[linear-gradient(180deg,#FFF6BF_0%,#FFD95A_35%,#F2B51F_70%,#C98600_100%)] bg-clip-text [-webkit-text-stroke:0.35px_rgba(255,246,191,0.4)] [text-shadow:0_1px_0_rgba(255,255,255,0.32),0_0_10px_rgba(255,205,70,0.35),0_0_24px_rgba(255,190,40,0.18)]">
                  金曲猜歌王
                </span>
              </h1>

              <div className="mt-3 text-sm font-extrabold uppercase tracking-[0.18em] text-[#FFD34D] drop-shadow-[0_0_10px_rgba(255,211,77,0.25)] sm:text-[15px]">
                Golden Song King
              </div>

              <p className="mt-5 text-lg font-bold text-white">
                和好友一起嗨翻全場！
              </p>

              <p className="mt-1 text-sm text-[#B8AEC8]">
                猜歌名・猜歌手・歌詞接唱
              </p>
            </section>

            <section className="mt-7 space-y-4">
              <Link
                to="/host"
                className="group relative flex h-[92px] w-full items-center gap-4 overflow-hidden rounded-[18px] border border-[#FFE58A]/55 bg-[linear-gradient(180deg,#FFD957_0%,#EFB01A_55%,#C88300_100%)] px-5 text-[#211020] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(112,61,0,0.24),0_8px_24px_rgba(230,160,0,0.22),0_0_20px_rgba(255,205,70,0.12)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.42),inset_0_-2px_0_rgba(112,61,0,0.22),0_11px_28px_rgba(230,160,0,0.3),0_0_24px_rgba(255,205,70,0.16)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#FFF3A6] active:translate-y-px active:scale-[0.99] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_2px_5px_rgba(92,47,0,0.22),0_4px_12px_rgba(230,160,0,0.18)]"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-5 top-0 h-px bg-white/65"
                />

                <span className="flex size-[54px] shrink-0 items-center justify-center rounded-full border border-[#FFF6BF]/55 bg-[#30102C]/20 text-[34px] font-black leading-none text-[#321329] shadow-[inset_0_0_14px_rgba(255,217,87,0.22),0_1px_0_rgba(255,255,255,0.18)] transition group-hover:bg-[#30102C]/26">
                  +
                </span>

                <span className="min-w-0 text-left">
                  <span className="block text-2xl font-extrabold leading-tight">
                    建立房間
                  </span>

                  <span className="mt-1 block text-sm font-semibold text-[#2A142A]/72">
                    當房主出題給大家猜
                  </span>
                </span>
              </Link>

              <Link
                to="/join"
                className="group relative flex h-[92px] w-full items-center gap-4 overflow-hidden rounded-[18px] border border-[#C47AFF]/40 bg-[linear-gradient(180deg,#A848FF_0%,#7924D8_55%,#5212A8_100%)] px-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-2px_0_rgba(43,6,94,0.3),0_8px_24px_rgba(126,40,220,0.28),0_0_20px_rgba(168,72,255,0.14)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.26),inset_0_-2px_0_rgba(43,6,94,0.27),0_11px_28px_rgba(126,40,220,0.38),0_0_24px_rgba(168,72,255,0.2)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#C77DFF] active:translate-y-px active:scale-[0.99] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.14),inset_0_2px_5px_rgba(43,6,94,0.35),0_4px_12px_rgba(126,40,220,0.22)]"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-5 top-0 h-px bg-white/35"
                />

                <span className="flex size-[54px] shrink-0 items-center justify-center rounded-full border border-white/30 bg-[#210838]/35 text-[27px] text-white shadow-[inset_0_0_15px_rgba(193,92,255,0.32),0_1px_0_rgba(255,255,255,0.12)] transition group-hover:bg-[#210838]/45">
                  ♫
                </span>

                <span className="min-w-0 text-left">
                  <span className="block text-2xl font-extrabold leading-tight">
                    加入房間
                  </span>

                  <span className="mt-1 block text-sm font-semibold text-white/75">
                    輸入房號加入遊戲
                  </span>
                </span>
              </Link>
            </section>

            <section className="mt-5">
              <button
                type="button"
                aria-expanded={instructionsOpen}
                aria-controls="game-instructions"
                onClick={() =>
                  setInstructionsOpen(
                    (currentOpen) => !currentOpen
                  )
                }
                className="flex h-[54px] w-full items-center justify-center gap-2 rounded-[16px] border border-[#A64DFF]/35 bg-[linear-gradient(180deg,rgba(28,10,48,0.82),rgba(12,4,22,0.78))] text-sm font-bold text-white shadow-[inset_0_1px_0_rgba(193,92,255,0.12),inset_0_0_18px_rgba(118,34,215,0.08),0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur-sm transition duration-200 hover:border-[#FFD34D]/55 hover:bg-[linear-gradient(180deg,rgba(34,12,58,0.9),rgba(16,5,29,0.84))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFD34D] active:translate-y-px active:scale-[0.99]"
              >
                <span
                  aria-hidden="true"
                  className="drop-shadow-[0_0_6px_rgba(255,217,90,0.38)]"
                >
                  📖
                </span>
                遊戲說明
              </button>

              {instructionsOpen && (
                <div
                  id="game-instructions"
                  className="mt-3 rounded-[16px] border border-[#A64DFF]/25 bg-[#10051E]/94 px-5 py-4 text-sm text-[#B8AEC8] shadow-[0_18px_44px_rgba(0,0,0,0.46)] backdrop-blur-xl"
                >
                  <ol className="space-y-2.5">
                    <li>建立或加入房間，等待好友到齊。</li>
                    <li>在時間內仔細聽歌並送出答案。</li>
                    <li>率先累積十分，成為金曲猜歌王！</li>
                  </ol>
                </div>
              )}
            </section>
          </main>

          <footer className="mt-auto pt-5 text-center text-[11px] text-[#B8AEC8]/45">
            v2.0.0
          </footer>
        </div>
      </div>
    </Page>
  );
}
