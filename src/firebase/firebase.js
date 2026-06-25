import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBtKXv7Aof0GIPlsp5VaE-W65MMxZOWerU",
  authDomain: "golden-song-king.firebaseapp.com",
  projectId: "golden-song-king",
  storageBucket: "golden-song-king.firebasestorage.app",
  messagingSenderId: "274141368673",
  appId: "1:274141368673:web:af8a7177012769f9413520"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);