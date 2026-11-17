/** Reads Vite env vars. Firebase web config is public by design; never put secrets here. */
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const appCheckConfig = {
  recaptchaEnterpriseKey: (env.VITE_APPCHECK_RECAPTCHA_ENTERPRISE_KEY as string | undefined) ?? "",
  debug: (env.VITE_APPCHECK_DEBUG as string | undefined) === "true",
};

/** SDK default for hybrid in-cloud is gemini-3.5-flash-lite (verified in firebase@13.3.0). */
export const CLOUD_MODEL = (env.VITE_CLOUD_MODEL as string | undefined) || "gemini-3.5-flash-lite";

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}
