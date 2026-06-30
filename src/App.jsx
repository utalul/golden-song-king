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
import ImportSongs from "./pages/ImportSongs";
import Admin from "./pages/Admin";

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
<Route
  path="/import"
  element={<ImportSongs />}
/>
<Route
  path="/admin"
  element={<Admin />}
/>
      </Routes>
    </BrowserRouter>
  );
}

export default App;