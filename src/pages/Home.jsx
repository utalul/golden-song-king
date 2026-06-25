import { Link } from "react-router-dom";

import Page from "../components/ui/Page";
import Logo from "../components/ui/Logo";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";

export default function Home() {
  return (
    <Page>
      <Logo />

      <div className="mt-10 space-y-6">

        <Card>

          <h2 className="mb-6 text-center text-2xl font-bold text-white">
            開始遊戲
          </h2>

          <Link to="/host">
            <Button>
              🎮 建立房間
            </Button>
          </Link>

          <div className="h-4" />

          <Link to="/join">
            <Button variant="success">
              🚪 加入房間
            </Button>
          </Link>

        </Card>

        <Card>

          <h3 className="mb-4 text-center text-xl font-bold text-yellow-400">
            更多功能
          </h3>

          <div className="space-y-3">

            <button
              disabled
              className="
                w-full
                rounded-2xl
                border
                border-slate-700
                bg-slate-900
                py-3
                text-slate-400
              "
            >
              📚 題庫管理（開發中）
            </button>

            <button
              disabled
              className="
                w-full
                rounded-2xl
                border
                border-slate-700
                bg-slate-900
                py-3
                text-slate-400
              "
            >
              🏆 排行榜（開發中）
            </button>

            <button
              disabled
              className="
                w-full
                rounded-2xl
                border
                border-slate-700
                bg-slate-900
                py-3
                text-slate-400
              "
            >
              ⚙️ 設定（開發中）
            </button>

          </div>

        </Card>

        <div className="pt-6 text-center text-sm text-slate-500">

          黃金歌王

          <br />

          版本 2.0

        </div>

      </div>

    </Page>
  );
}
