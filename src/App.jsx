import {
  lazy,
  Suspense
} from "react";
import {
  BrowserRouter,
  Routes,
  Route
} from "react-router-dom";

import Home from "./pages/Home";
import Host from "./pages/Host";
import Join from "./pages/Join";
import Lobby from "./pages/Lobby";
import Game from "./pages/Game";

const developmentPages = import.meta.env.DEV
  ? {
      ImportSongs: lazy(() => import("./pages/ImportSongs")),
      Admin: lazy(() => import("./pages/Admin")),
      AudioTest: lazy(() => import("./pages/AudioTest"))
    }
  : null;

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Home />}
        />

        <Route
          path="/host"
          element={<Host />}
        />

        <Route
          path="/join"
          element={<Join />}
        />

        <Route
          path="/lobby"
          element={<Lobby />}
        />

        <Route
          path="/game"
          element={<Game />}
        />

        {developmentPages && (
          <>
            <Route
              path="/import"
              element={(
                <Suspense fallback={null}>
                  <developmentPages.ImportSongs />
                </Suspense>
              )}
            />

            <Route
              path="/admin"
              element={(
                <Suspense fallback={null}>
                  <developmentPages.Admin />
                </Suspense>
              )}
            />

            <Route
              path="/audio-test"
              element={(
                <Suspense fallback={null}>
                  <developmentPages.AudioTest />
                </Suspense>
              )}
            />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
