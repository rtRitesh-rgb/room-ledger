import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const env = import.meta.env;
const config = {
  apiKey: env["VITE_FIREBASE_API_KEY"],
  authDomain: env["VITE_FIREBASE_AUTH_DOMAIN"],
  projectId: env["VITE_FIREBASE_PROJECT_ID"],
  storageBucket: env["VITE_FIREBASE_STORAGE_BUCKET"],
  messagingSenderId: env["VITE_FIREBASE_MESSAGING_SENDER_ID"],
  appId: env["VITE_FIREBASE_APP_ID"],
};

export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

// Firebase is only started in the browser. During server-side rendering the app just draws a loading
// screen, and every Firebase call happens later in effects/handlers, so the server never needs it.
const app = typeof window !== "undefined" && firebaseConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null;

export const auth = (app ? getAuth(app) : null) as unknown as Auth;
export const db = (app ? getFirestore(app) : null) as unknown as Firestore;
