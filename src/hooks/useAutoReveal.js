import { useEffect, useRef } from "react";

export default function useAutoReveal({
  isHost,
  roomData,
  allAnswered,
  timeExpired,
  revealAnswer
}) {
  const triggeredRef = useRef(false);

  useEffect(() => {
    triggeredRef.current = false;
  }, [
    roomData?.gameRound,
    roomData?.currentQuestion,
    roomData?.currentSongId
  ]);

  useEffect(() => {
    if (!isHost) return;

    if (!roomData) return;

    if (roomData.answerRevealed) return;

    if (triggeredRef.current) return;

    const shouldReveal =
      allAnswered || timeExpired;

    if (!shouldReveal) return;

    triggeredRef.current = true;

    revealAnswer();
  }, [
    isHost,
    roomData,
    allAnswered,
    timeExpired,
    revealAnswer
  ]);
}