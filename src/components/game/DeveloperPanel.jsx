import { useState } from "react";

import Card from "../ui/Card";
import Button from "../ui/Button";

export default function DeveloperPanel({
  enabled,
  onAddPoint,
  onWin,
  onReveal,
  onNext,
  onRestart
}) {
  const [open, setOpen] =
    useState(false);

  if (!enabled) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[min(18rem,calc(100vw-2.5rem))]">
      {open && (
        <Card className="mb-3 space-y-3 border-yellow-400/40 bg-slate-900/95 p-4 shadow-2xl">
          <div className="text-center text-sm font-black text-yellow-300">
            🧪 開發模式
          </div>

          <Button
            variant="warning"
            onClick={onAddPoint}
            className="py-3 text-base"
          >
            ➕ +1 分
          </Button>

          <Button
            variant="warning"
            onClick={onWin}
            className="py-3 text-base"
          >
            🏆 直接獲勝
          </Button>

          <Button
            onClick={onReveal}
            className="py-3 text-base"
          >
            🎵 公布答案
          </Button>

          <Button
            variant="success"
            onClick={onNext}
            className="py-3 text-base"
          >
            ➡ 下一題
          </Button>

          <Button
            variant="danger"
            onClick={onRestart}
            className="py-3 text-base"
          >
            🔄 重新開始
          </Button>
        </Card>
      )}

      <button
        type="button"
        onClick={() =>
          setOpen(
            (currentOpen) => !currentOpen
          )
        }
        className="
          w-full
          rounded-full
          border
          border-yellow-400/50
          bg-violet-700
          px-5
          py-4
          text-base
          font-black
          text-yellow-100
          shadow-2xl
          transition
          active:scale-95
        "
      >
        🧪 開發工具
      </button>
    </div>
  );
}
