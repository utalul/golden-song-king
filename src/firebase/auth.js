import { signInAnonymously } from "firebase/auth";

import { auth } from "./firebase";

let anonymousAuthPromise = null;

export function ensureAnonymousAuth() {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser);
  }

  if (!anonymousAuthPromise) {
    anonymousAuthPromise = (async () => {
      await auth.authStateReady();

      if (auth.currentUser) {
        return auth.currentUser;
      }

      const credential = await signInAnonymously(auth);
      return credential.user;
    })().finally(() => {
      anonymousAuthPromise = null;
    });
  }

  return anonymousAuthPromise;
}
