/**
 * Firebase bootstrap: app, App Check (required by Firebase AI Logic), AI Logic, Remote Config.
 */
import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";
import { appCheckConfig, firebaseConfig, isFirebaseConfigured } from "./config";

export interface FirebaseHandles {
  app: FirebaseApp;
  ai: AI;
}

let handles: FirebaseHandles | null = null;

export function initFirebase(): FirebaseHandles {
  if (handles) return handles;
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured. Copy .env.example to .env.local and fill in your web app config.");
  }
  const app = initializeApp(firebaseConfig);

  if (appCheckConfig.debug) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckConfig.recaptchaEnterpriseKey || "unused-in-debug"),
    isTokenAutoRefreshEnabled: true,
  });

  const ai = getAI(app, { backend: new GoogleAIBackend() });
  handles = { app, ai };
  return handles;
}
