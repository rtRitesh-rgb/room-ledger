import { createFileRoute } from "@tanstack/react-router";
import { getFirebaseAdmin } from "@/lib/server/firebase-admin";
import { GROCERY_PLATFORMS, normalizeGroceryProducts, type GroceryPlatform } from "@/lib/grocery";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type SearchBody = {
  query?: unknown;
  lat?: unknown;
  lon?: unknown;
  pincode?: unknown;
  platforms?: unknown;
};

function isSearchBody(value: unknown): value is SearchBody {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlatform(value: unknown): value is GroceryPlatform {
  return GROCERY_PLATFORMS.some((platform) => platform.id === value);
}

export const Route = createFileRoute("/api/grocery-search")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!bearer) return json(401, { error: "Sign in to search grocery prices." });
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 8_192) return json(413, { error: "Search request is too large." });

        let body: SearchBody;
        try {
          const parsed: unknown = await request.json();
          if (!isSearchBody(parsed)) return json(400, { error: "Invalid search request." });
          body = parsed;
        } catch {
          return json(400, { error: "Invalid search request." });
        }

        const query = typeof body.query === "string" ? body.query.trim() : "";
        const lat = typeof body.lat === "number" ? body.lat : NaN;
        const lon = typeof body.lon === "number" ? body.lon : NaN;
        const pincode = typeof body.pincode === "string" ? body.pincode.trim() : "";
        const platforms =
          Array.isArray(body.platforms) && body.platforms.every(isPlatform)
            ? [...new Set(body.platforms)]
            : [];
        if (query.length < 2 || query.length > 80)
          return json(400, { error: "Search terms must be 2–80 characters." });
        if (
          !Number.isFinite(lat) ||
          lat < -90 ||
          lat > 90 ||
          !Number.isFinite(lon) ||
          lon < -180 ||
          lon > 180
        ) {
          return json(400, {
            error: "Use a valid device location or enter latitude and longitude.",
          });
        }
        if (body.pincode !== undefined && typeof body.pincode !== "string")
          return json(400, { error: "PIN code must be a string." });
        if (pincode && !/^\d{6}$/.test(pincode))
          return json(400, { error: "Enter a valid 6-digit PIN code, or leave it blank." });
        if (
          !Array.isArray(body.platforms) ||
          body.platforms.length === 0 ||
          body.platforms.length > 3 ||
          platforms.length === 0
        )
          return json(400, { error: "Choose one to three grocery apps." });

        let admin;
        try {
          admin = await getFirebaseAdmin();
        } catch (error) {
          console.error("grocery search: Firebase Admin initialization failed", error);
          return json(503, { error: "Grocery search authentication is unavailable." });
        }
        if (!admin) return json(503, { error: "Server authentication is not configured." });

        try {
          const { uid } = await admin.auth.verifyIdToken(bearer);
          const member = await admin.db.collection("members").doc(uid).get();
          if (
            !member.exists ||
            !(member.data() as { roommateId?: string } | undefined)?.roommateId
          ) {
            return json(403, { error: "Only household members can search grocery prices." });
          }
        } catch (error) {
          console.error("grocery search: session verification failed", error);
          return json(401, { error: "Your session could not be verified. Sign in again." });
        }

        const apiKey = process.env["QUICKCOMMERCE_API_KEY"];
        if (!apiKey)
          return json(503, { error: "Grocery price search is not configured on the server yet." });

        const params = new URLSearchParams({
          q: query,
          lat: String(lat),
          lon: String(lon),
          platforms: platforms.join(","),
        });
        if (pincode) params.set("pincode", pincode);

        let providerResponse: Response;
        try {
          providerResponse = await fetch(
            `https://api.quickcommerceapi.com/v1/groupsearch?${params}`,
            {
              headers: { "X-API-Key": apiKey, accept: "application/json" },
              signal: AbortSignal.timeout(20_000),
            },
          );
        } catch (error) {
          console.error("grocery search: provider request failed", error);
          return json(502, {
            error: "The grocery price service could not be reached. Try again shortly.",
          });
        }
        if (!providerResponse.ok) {
          console.error(`grocery search: provider returned HTTP ${providerResponse.status}`);
          const message =
            providerResponse.status === 401 || providerResponse.status === 403
              ? "The grocery API key was rejected. Check QUICKCOMMERCE_API_KEY."
              : providerResponse.status === 402 || providerResponse.status === 429
                ? "The grocery API has no available credits or has reached its limit."
                : "The grocery price service returned an error. Try again shortly.";
          return json(
            providerResponse.status === 402 || providerResponse.status === 429 ? 429 : 502,
            { error: message },
          );
        }

        let payload: unknown;
        try {
          payload = await providerResponse.json();
        } catch {
          return json(502, { error: "The grocery price service returned invalid data." });
        }
        try {
          return json(200, normalizeGroceryProducts(payload, platforms));
        } catch (error) {
          console.error("grocery search: response normalization failed", error);
          return json(502, { error: "The grocery price service returned an unexpected response." });
        }
      },
    },
  },
});
