import { initializeApp } from "firebase/app";
import {
  getFirestore,
  connectFirestoreEmulator
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "...",
  authDomain: "golden-song-king.firebaseapp.com",
  projectId: "golden-song-king",
  storageBucket: "golden-song-king.firebasestorage.app",
  messagingSenderId: "274141368673",
  appId: "1:274141368673:web:af8a7177012769f9413520"
};

const app = initializeApp(firebaseConfig);

console.log("App options =", app.options);

export const db = getFirestore(app);

// 如果有這一行，先註解掉
// connectFirestoreEmulator(...)