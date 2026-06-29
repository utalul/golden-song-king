import {
  useCallback,
  useEffect,
  useState
} from "react";

export default function useQuestionCountdown({
  roomData,
  questionTime
}) {
  const [timeLeft, setTimeLeft] =
    useState(questionTime);

  const resetCountdown = useCallback(() => {
    setTimeLeft(questionTime);
  }, [
    questionTime
  ]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    resetCountdown();
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [
    roomData?.gameRound,
    roomData?.currentQuestion,
    roomData?.currentSongId,
    resetCountdown
  ]);

  useEffect(() => {
    if (!roomData) return;

    if (roomData.answerRevealed)
      return;

    if (timeLeft <= 0)
      return;

    const timer = window.setInterval(
      () => {
        setTimeLeft(
          (currentTime) =>
            Math.max(
              currentTime - 1,
              0
            )
        );
      },
      1000
    );

    return () =>
      window.clearInterval(timer);
  }, [
    roomData,
    timeLeft
  ]);

  return {
    timeLeft,
    resetCountdown
  };
}
