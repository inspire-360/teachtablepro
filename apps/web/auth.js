import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";

const config = globalThis.__TEACHTABLE_CONFIG__?.firebase || {};
const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"];
const missingKeys = REQUIRED_KEYS.filter((key) => !config[key]);

let firebaseApp = null;
let authInstance = null;
let authInitPromise = null;

function ensureConfigured() {
  if (missingKeys.length > 0) {
    throw new Error(`ยังตั้งค่า Firebase web config ไม่ครบ: ${missingKeys.join(", ")}`);
  }
}

export function getAuthSetupStatus() {
  return {
    ready: missingKeys.length === 0,
    missingKeys: [...missingKeys],
    projectId: config.projectId || "",
  };
}

export async function initializeFirebaseAuth() {
  ensureConfigured();
  if (authInstance) {
    return authInstance;
  }

  if (authInitPromise) {
    return authInitPromise;
  }

  authInitPromise = Promise.resolve().then(() => {
    firebaseApp = initializeApp(config);
    authInstance = getAuth(firebaseApp);

    // Keep auth setup non-blocking so the app can leave the boot screen promptly.
    setPersistence(authInstance, browserLocalPersistence).catch((error) => {
      console.warn("TeachTable could not enable local auth persistence.", error);
    });

    return authInstance;
  });

  return authInitPromise;
}

export async function observeAuthState(onChange, onError) {
  const auth = await initializeFirebaseAuth();
  return onAuthStateChanged(auth, onChange, onError);
}

export async function signInWithGoogle() {
  const auth = await initializeFirebaseAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/cancelled-popup-request") {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}

export async function signInWithEmail(email, password) {
  const auth = await initializeFirebaseAuth();
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  const auth = await initializeFirebaseAuth();
  await signOut(auth);
}

export async function getCurrentIdToken(forceRefresh = false) {
  const auth = await initializeFirebaseAuth();
  return auth.currentUser ? auth.currentUser.getIdToken(forceRefresh) : "";
}
