import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/push  { ids: string[] }  with  Authorization: Bearer <Firebase ID token>
 * Sends a phone push for notifications the caller just created. Server-only (uses the Firebase Admin SDK).
 * Needs the FIREBASE_SERVICE_ACCOUNT environment variable (service-account JSON). Without it this returns 503 and
 * the app keeps working with in-app notifications only.
 */
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function getAdmin() {
  const raw = process.env["FIREBASE_SERVICE_ACCOUNT"];
  if (!raw) return null;
  const [{ cert, getApps, initializeApp }, { getAuth }, { getFirestore }, { getMessaging }] = await Promise.all([
    import("firebase-admin/app"), import("firebase-admin/auth"), import("firebase-admin/firestore"), import("firebase-admin/messaging"),
  ]);
  const sa = JSON.parse(raw) as { private_key?: string };
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa as never) });
  return { auth: getAuth(app), db: getFirestore(app), messaging: getMessaging(app) };
}

export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!bearer) return json(401, { error: "Sign in required." });
        let ids: string[] = [];
        try {
          const body = (await request.json()) as { ids?: unknown };
          ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 200).slice(0, 20) : [];
        } catch { return json(400, { error: "Bad request." }); }
        if (!ids.length) return json(400, { error: "No notification ids." });

        let admin;
        try { admin = await getAdmin(); } catch (e) { console.error("push: admin init failed", e); return json(503, { error: "Push is misconfigured." }); }
        if (!admin) return json(503, { error: "Push is not set up on the server." });

        try {
          const { uid } = await admin.auth.verifyIdToken(bearer);
          const member = await admin.db.collection("members").doc(uid).get();
          const callerId = (member.data() as { roommateId?: string } | undefined)?.roommateId;
          if (!callerId) return json(403, { error: "Not a household member." });

          let sent = 0;
          for (const id of ids) {
            const ref = admin.db.collection("notifications").doc(id);
            const snap = await ref.get();
            const n = snap.data() as { fromId: string; toId: string; title: string; body: string; link?: string; createdAtMs: number; pushedAtMs?: number } | undefined;
            // Only the sender can trigger a push, only once, and only for a fresh notification.
            if (!n || n.fromId !== callerId || n.pushedAtMs || Date.now() - n.createdAtMs > 10 * 60 * 1000) continue;
            await ref.update({ pushedAtMs: Date.now() });
            const tokSnap = await admin.db.collection("pushTokens").where("roommateId", "==", n.toId).get();
            const tokens = tokSnap.docs.map((d) => d.id);
            if (!tokens.length) continue;
            const res = await admin.messaging.sendEachForMulticast({
              tokens,
              data: { title: n.title, body: n.body, link: n.link ?? "/", tag: id },
              webpush: { headers: { Urgency: "high", TTL: "86400" } },
              android: {
                priority: "high",
                ttl: 86400 * 1000,
                notification: {
                  title: n.title,
                  body: n.body,
                  channelId: "room_ledger_alerts",
                },
              },
            });
            sent += res.successCount;
            // Drop tokens for uninstalled / revoked devices so they don't pile up.
            await Promise.all(res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? "") ? admin.db.collection("pushTokens").doc(tokens[i]!).delete() : null)));
          }
          return json(200, { sent });
        } catch (e) {
          console.error("push failed", e);
          return json(401, { error: "Couldn't verify your session." });
        }
      },
    },
  },
});
