import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from "firebase/firestore";

const PROJECT_ID = "golden-song-king-rules-test";
const HOST_UID = "host-user";
const PLAYER_UID = "player-user";
const OTHER_UID = "other-user";
const ROOM_DOC_ID = "room-document";
const ROOM_ID = "123456";
const NOW = 1700000000000;

let testEnvironment;

function roomData(overrides = {}) {
  return {
    roomId: ROOM_ID,
    hostName: "房主",
    hostUid: HOST_UID,
    category: "all",
    status: "waiting",
    gameRound: 1,
    currentQuestion: 1,
    gameMode: "songName",
    answerRevealed: false,
    scored: false,
    winner: "",
    createdAt: NOW,
    joinStatus: "OPEN",
    expiresAt: Timestamp.fromMillis(Date.now() + 6 * 60 * 60 * 1000),
    ...overrides
  };
}

function playerData(overrides = {}) {
  return {
    name: "玩家",
    roomId: ROOM_ID,
    roomDocId: ROOM_DOC_ID,
    uid: PLAYER_UID,
    score: 0,
    isHost: false,
    joinedAt: NOW,
    ...overrides
  };
}

function answerData(overrides = {}) {
  return {
    roomId: ROOM_ID,
    playerName: "玩家",
    answer: "測試答案",
    gameRound: 1,
    questionNumber: 1,
    createdAt: NOW,
    uid: PLAYER_UID,
    ...overrides
  };
}

function firestoreFor(uid) {
  return testEnvironment.authenticatedContext(uid).firestore();
}

async function seedDocuments(callback) {
  await testEnvironment.withSecurityRulesDisabled(
    async (context) => callback(context.firestore())
  );
}

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(
        new URL("../firestore.rules", import.meta.url),
        "utf8"
      )
    }
  });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
});

after(async () => {
  await testEnvironment.cleanup();
});

test("authenticated users can read songs", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "songs", "M000001"), {
      songName: "測試歌曲"
    })
  );

  await assertSucceeds(
    getDoc(doc(firestoreFor(PLAYER_UID), "songs", "M000001"))
  );
});

test("unauthenticated users cannot read songs", async () => {
  const db = testEnvironment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, "songs", "M000001")));
});

test("clients cannot write songs", async () => {
  await assertFails(
    setDoc(doc(firestoreFor(HOST_UID), "songs", "M000002"), {
      songName: "禁止寫入"
    })
  );
});

test("host can create a room with their own uid", async () => {
  await assertSucceeds(
    setDoc(
      doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID),
      roomData()
    )
  );
});

test("room create rejects a fake host uid", async () => {
  await assertFails(
    setDoc(
      doc(firestoreFor(PLAYER_UID), "rooms", ROOM_DOC_ID),
      roomData()
    )
  );
});

test("host can update their room game state", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertSucceeds(
    updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), {
      status: "playing",
      joinStatus: "LOCKED",
      currentMode: "artist",
      currentSongId: "M000001",
      songQueue: ["M000002"],
      gamePhase: "PLAYING",
      phaseStartedAt: NOW + 1
    })
  );
});

test("student can join an OPEN waiting room before expiry", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  await assertSucceeds(setDoc(doc(firestoreFor(PLAYER_UID), "players", "open-player"), playerData()));
});

test("unauthenticated player create is denied", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  await assertFails(setDoc(doc(testEnvironment.unauthenticatedContext().firestore(), "players", "anonymous-player"), playerData()));
});

for (const [label, overrides] of [
  ["LOCKED", { joinStatus: "LOCKED" }],
  ["ENDED", { joinStatus: "ENDED" }],
  ["expired", { expiresAt: Timestamp.fromMillis(Date.now() - 1000) }],
  ["playing", { status: "playing" }]
]) {
  test(`student cannot join ${label} room`, async () => {
    await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData(overrides)));
    await assertFails(setDoc(doc(firestoreFor(PLAYER_UID), "players", `blocked-${label}`), playerData()));
  });
}

test("host can lock and unlock while waiting", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  const ref = doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID);
  await assertSucceeds(updateDoc(ref, { joinStatus: "LOCKED" }));
  await assertSucceeds(updateDoc(ref, { joinStatus: "OPEN" }));
});

test("non-host cannot change joinStatus", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  await assertFails(updateDoc(doc(firestoreFor(PLAYER_UID), "rooms", ROOM_DOC_ID), { joinStatus: "LOCKED" }));
});

test("host cannot unlock once game has started", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData({ status: "playing", joinStatus: "LOCKED" })));
  await assertFails(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { joinStatus: "OPEN" }));
});

test("host can atomically start game and lock joins", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  await assertSucceeds(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { status: "playing", joinStatus: "LOCKED" }));
});

test("host cannot start an expired lifecycle room", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) })));
  await assertFails(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { status: "playing", joinStatus: "LOCKED" }));
});

test("host can end a waiting room", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  await assertSucceeds(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { joinStatus: "ENDED" }));
});

test("host cannot end a playing room in Sprint29B", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData({ status: "playing", joinStatus: "LOCKED" })));
  await assertFails(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { joinStatus: "ENDED" }));
});

test("student cannot change room expiry or host identity", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  const ref = doc(firestoreFor(PLAYER_UID), "rooms", ROOM_DOC_ID);
  await assertFails(updateDoc(ref, { expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) }));
  await assertFails(updateDoc(ref, { hostUid: PLAYER_UID }));
});

test("host cannot extend room expiry in Sprint29B", async () => {
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData()));
  await assertFails(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) }));
});

test("locking room does not remove existing players", async () => {
  await seedDocuments(async (db) => {
    await setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData());
    await setDoc(doc(db, "players", "existing-player"), playerData());
  });
  await assertSucceeds(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { joinStatus: "LOCKED" }));
  await assertSucceeds(getDoc(doc(firestoreFor(PLAYER_UID), "players", "existing-player")));
});

test("room creation requires valid lifecycle fields", async () => {
  const missing = roomData();
  delete missing.joinStatus;
  delete missing.expiresAt;
  await assertFails(setDoc(doc(firestoreFor(HOST_UID), "rooms", "missing-lifecycle"), missing));
  await assertFails(setDoc(doc(firestoreFor(HOST_UID), "rooms", "malformed-lifecycle"), roomData({ joinStatus: "OPEN", expiresAt: "later" })));
});

test("legacy room game updates remain compatible but new joins fail closed", async () => {
  const legacy = roomData();
  delete legacy.joinStatus;
  delete legacy.expiresAt;
  await seedDocuments((db) => setDoc(doc(db, "rooms", ROOM_DOC_ID), legacy));
  await assertSucceeds(updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), { status: "playing" }));
  await assertFails(setDoc(doc(firestoreFor(PLAYER_UID), "players", "legacy-join"), playerData()));
});

test("non-host cannot update a room", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertFails(
    updateDoc(doc(firestoreFor(PLAYER_UID), "rooms", ROOM_DOC_ID), {
      status: "playing"
    })
  );
});

test("host cannot change room hostUid", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertFails(
    updateDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID), {
      hostUid: OTHER_UID
    })
  );
});

test("room delete is denied", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertFails(
    deleteDoc(doc(firestoreFor(HOST_UID), "rooms", ROOM_DOC_ID))
  );
});

test("authenticated users can query multiplayer collections", async () => {
  await seedDocuments(async (db) => {
    await setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData());
    await setDoc(
      doc(db, "players", "player-document"),
      playerData()
    );
    await setDoc(
      doc(db, "answers", "answer-document"),
      answerData()
    );
  });

  const db = firestoreFor(PLAYER_UID);

  await assertSucceeds(
    getDocs(
      query(collection(db, "rooms"), where("roomId", "==", ROOM_ID))
    )
  );
  await assertSucceeds(
    getDocs(
      query(collection(db, "players"), where("roomId", "==", ROOM_ID))
    )
  );
  await assertSucceeds(
    getDocs(
      query(collection(db, "answers"), where("roomId", "==", ROOM_ID))
    )
  );
});

test("unauthenticated users cannot read multiplayer data", async () => {
  const db = testEnvironment.unauthenticatedContext().firestore();

  await assertFails(getDoc(doc(db, "rooms", ROOM_DOC_ID)));
  await assertFails(getDoc(doc(db, "players", "player-document")));
  await assertFails(getDoc(doc(db, "answers", "answer-document")));
});

test("player can create their own player document", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertSucceeds(
    setDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document"),
      playerData()
    )
  );
});

test("host can create their host player document", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertSucceeds(
    setDoc(
      doc(firestoreFor(HOST_UID), "players", "host-player"),
      playerData({
        name: "房主",
        uid: HOST_UID,
        isHost: true
      })
    )
  );
});

test("player create rejects another uid", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertFails(
    setDoc(
      doc(firestoreFor(OTHER_UID), "players", "player-document"),
      playerData()
    )
  );
});

test("player create requires an existing room", async () => {
  await assertFails(
    setDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document"),
      playerData()
    )
  );
});

test("player roomId must match the linked room", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertFails(
    setDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document"),
      playerData({ roomId: "654321" })
    )
  );
});

test("non-host cannot create a fake host player", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData())
  );

  await assertFails(
    setDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document"),
      playerData({ isHost: true })
    )
  );
});

test("room host can update a room player's score", async () => {
  await seedDocuments(async (db) => {
    await setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData());
    await setDoc(
      doc(db, "players", "player-document"),
      playerData()
    );
  });

  await assertSucceeds(
    updateDoc(
      doc(firestoreFor(HOST_UID), "players", "player-document"),
      { score: 1 }
    )
  );
});

test("random player cannot update another player's score", async () => {
  await seedDocuments(async (db) => {
    await setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData());
    await setDoc(
      doc(db, "players", "player-document"),
      playerData()
    );
  });

  await assertFails(
    updateDoc(
      doc(firestoreFor(OTHER_UID), "players", "player-document"),
      { score: 1 }
    )
  );
});

test("player cannot change uid", async () => {
  await seedDocuments(async (db) => {
    await setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData());
    await setDoc(
      doc(db, "players", "player-document"),
      playerData()
    );
  });

  await assertFails(
    updateDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document"),
      { uid: OTHER_UID }
    )
  );
});

test("player cannot change roomDocId", async () => {
  await seedDocuments(async (db) => {
    await setDoc(doc(db, "rooms", ROOM_DOC_ID), roomData());
    await setDoc(
      doc(db, "players", "player-document"),
      playerData()
    );
  });

  await assertFails(
    updateDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document"),
      { roomDocId: "another-room" }
    )
  );
});

test("player delete is denied", async () => {
  await seedDocuments((db) =>
    setDoc(
      doc(db, "players", "player-document"),
      playerData()
    )
  );

  await assertFails(
    deleteDoc(
      doc(firestoreFor(PLAYER_UID), "players", "player-document")
    )
  );
});

test("player can create their own answer", async () => {
  await assertSucceeds(
    setDoc(
      doc(firestoreFor(PLAYER_UID), "answers", "answer-document"),
      answerData()
    )
  );
});

test("answer create rejects another uid", async () => {
  await assertFails(
    setDoc(
      doc(firestoreFor(OTHER_UID), "answers", "answer-document"),
      answerData()
    )
  );
});

test("answer update and delete are denied", async () => {
  await seedDocuments((db) =>
    setDoc(
      doc(db, "answers", "answer-document"),
      answerData()
    )
  );

  const answerRef = doc(
    firestoreFor(PLAYER_UID),
    "answers",
    "answer-document"
  );

  await assertFails(updateDoc(answerRef, { answer: "修改答案" }));
  await assertFails(deleteDoc(answerRef));
});

test("authenticated users can read answers", async () => {
  await seedDocuments((db) =>
    setDoc(
      doc(db, "answers", "answer-document"),
      answerData()
    )
  );

  await assertSucceeds(
    getDoc(
      doc(
        firestoreFor(HOST_UID),
        "answers",
        "answer-document"
      )
    )
  );
});

test("unknown collections deny read and write", async () => {
  await seedDocuments((db) =>
    setDoc(doc(db, "unknown", "document"), { value: true })
  );

  const unknownRef = doc(
    firestoreFor(HOST_UID),
    "unknown",
    "document"
  );

  await assertFails(getDoc(unknownRef));
  await assertFails(setDoc(unknownRef, { value: false }));
});

test("test fixture sanity", () => {
  assert.equal(roomData().hostUid, HOST_UID);
  assert.equal(playerData().roomDocId, ROOM_DOC_ID);
  assert.equal(answerData().uid, PLAYER_UID);
});
