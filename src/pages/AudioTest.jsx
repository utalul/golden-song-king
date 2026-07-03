import Page from "../components/ui/Page";
import AudioPlayer from "../components/game/AudioPlayer";

export default function AudioTest() {
  return (
    <Page>
      <h1 className="mb-6 text-2xl font-bold">
        🎵 Audio Test
      </h1>

      <AudioPlayer url="/audio/test.mp3" />
    </Page>
  );
}