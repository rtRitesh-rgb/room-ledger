import type { ServiceAccount } from "firebase-admin/app";

export async function getFirebaseAdmin() {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"];
  if (!raw) return null;

  const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }, { getMessaging }] =
    await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/auth"),
      import("firebase-admin/firestore"),
      import("firebase-admin/messaging"),
    ]);
  const json = JSON.parse(raw) as {
    project_id?: unknown;
    client_email?: unknown;
    private_key?: unknown;
  };
  if (
    typeof json.project_id !== "string" ||
    typeof json.client_email !== "string" ||
    typeof json.private_key !== "string"
  ) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT must contain project_id, client_email, and private_key.",
    );
  }
  const serviceAccount: ServiceAccount = {
    projectId: json.project_id,
    clientEmail: json.client_email,
    privateKey: json.private_key.replace(/\\n/g, "\n"),
  };
  const app = getApps()[0] ?? initializeApp({ credential: cert(serviceAccount) });
  return { auth: getAuth(app), db: getFirestore(app), messaging: getMessaging(app) };
}
