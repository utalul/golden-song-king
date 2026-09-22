export function classifyRoomJoinStatus(roomData, now = Date.now()) {
  if (roomData.status === "playing") return "GAME_ALREADY_STARTED";
  if (roomData.joinStatus === "ENDED") return "ROOM_ENDED";

  const expiresAt = roomData.expiresAt?.toMillis?.();
  if (typeof expiresAt !== "number" || expiresAt <= now) return "ROOM_EXPIRED";

  if (roomData.joinStatus === "LOCKED") return "ROOM_LOCKED";
  if (roomData.status === "waiting" && roomData.joinStatus === "OPEN") return "JOIN_ALLOWED";

  return "ROOM_UNAVAILABLE";
}

export function getRoomJoinStatusMessage(status) {
  const messages = {
    GAME_ALREADY_STARTED: "遊戲已經開始，目前無法加入這個房間。",
    ROOM_ENDED: "這個活動房間已結束，請向主持人索取新的 QR Code。",
    ROOM_EXPIRED: "這個活動連結已逾期，請向主持人索取新的 QR Code。",
    ROOM_LOCKED: "房間已鎖定，暫時無法加入，請詢問主持人。",
    ROOM_UNAVAILABLE: "這個活動房間目前無法加入，請詢問主持人。"
  };

  return messages[status] ?? messages.ROOM_UNAVAILABLE;
}
