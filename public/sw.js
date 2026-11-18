/* Room Ledger service worker.
 * - Precaches a tiny offline fallback page.
 * - Static, hashed build assets (/assets/*), icons, fonts: cache-first.
 * - Page navigations: network-first, fall back to offline page.
 * - Never touches cross-origin requests (Firebase/Firestore, Supabase, etc.)
 *   or non-GET requests, so live data is never served stale.
 */
const VERSION = "v3";
const STATIC_CACHE = `room-ledger-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll([OFFLINE_URL, "/icons/icon-192.png"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("room-ledger-") && k !== STATIC_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Tapping a device alert (nudge, reminder…) focuses the app, or opens it on the right screen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if ("focus" in w) {
          await w.focus();
          if ("navigate" in w) { try { await w.navigate(target); } catch (e) { /* cross-origin or blocked */ } }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

// Real push (sent by /api/push through Firebase Cloud Messaging). Works even when the app is closed.
self.addEventListener("push", (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { /* not JSON */ }
  const d = p.data || p.notification || p;
  event.waitUntil(
    self.registration.showNotification(d.title || "Room Ledger", {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-32.png",
      tag: d.tag || undefined,
      data: { url: d.link || "/" },
    }),
  );
});
