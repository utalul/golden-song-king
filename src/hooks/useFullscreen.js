import { useCallback, useEffect, useState } from "react";

export async function requestFullscreenSafely(element) {
  if (typeof element?.requestFullscreen !== "function") return false;
  try {
    await element.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreenSafely(browserDocument = document) {
  if (typeof browserDocument.exitFullscreen !== "function" || !browserDocument.fullscreenElement) return false;
  try {
    await browserDocument.exitFullscreen();
    return true;
  } catch {
    return false;
  }
}

export function subscribeFullscreenEvents(browserDocument, onChange, onError) {
  const handleChange = () => onChange(Boolean(browserDocument.fullscreenElement));
  const handleError = () => onError(Boolean(browserDocument.fullscreenElement));
  browserDocument.addEventListener("fullscreenchange", handleChange);
  browserDocument.addEventListener("fullscreenerror", handleError);
  return () => {
    browserDocument.removeEventListener("fullscreenchange", handleChange);
    browserDocument.removeEventListener("fullscreenerror", handleError);
  };
}

export default function useFullscreen(targetRef) {
  const [isFullscreen, setIsFullscreen] = useState(
    () => Boolean(document.fullscreenElement)
  );
  const [error, setError] = useState("");
  const isSupported = typeof document.documentElement?.requestFullscreen === "function";

  useEffect(() => {
    return subscribeFullscreenEvents(
      document,
      setIsFullscreen,
      (fullscreen) => {
        setIsFullscreen(fullscreen);
        setError("你的瀏覽器無法自動進入全螢幕，仍可繼續遊戲。");
      }
    );
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (!isSupported) {
      setError("你的瀏覽器無法自動進入全螢幕，仍可繼續遊戲。");
      return false;
    }
    try {
      const target = targetRef?.current || document.documentElement;
      if (!document.fullscreenElement && !await requestFullscreenSafely(target)) throw new Error("fullscreen-unavailable");
      setError("");
      return true;
    } catch {
      setError("你的瀏覽器無法自動進入全螢幕，仍可繼續遊戲。");
      return false;
    }
  }, [isSupported, targetRef]);

  const exitFullscreen = useCallback(async () => {
    const exited = await exitFullscreenSafely();
    if (!exited && document.fullscreenElement) {
      setError("目前無法退出全螢幕，請使用瀏覽器的返回手勢或 Esc 鍵。");
    }
    return exited;
  }, []);

  return { isSupported, isFullscreen, enterFullscreen, exitFullscreen, error };
}
