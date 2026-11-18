export const GROCERY_PLATFORMS = [
  { id: "BlinkIt", label: "Blinkit", host: "blinkit.com" },
  { id: "Zepto", label: "Zepto", host: "zeptonow.com" },
  { id: "Swiggy", label: "Swiggy Instamart", host: "swiggy.com" },
] as const;

export type GroceryPlatform = (typeof GROCERY_PLATFORMS)[number]["id"];

export type GroceryProduct = {
  id: string;
  name: string;
  brand: string;
  quantity: string;
  platform: GroceryPlatform;
  offerPricePaise: number;
  mrpPaise: number | null;
  available: boolean;
  imageUrl: string | null;
  deeplink: string | null;
  sla: string | null;
};

type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function validPrice(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000
    ? Math.round(value * 100)
    : null;
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeProductLink(value: unknown, platform: GroceryPlatform): string | null {
  const link = safeHttpsUrl(value);
  if (!link) return null;
  const host = new URL(link).hostname.toLowerCase();
  const allowedHost = GROCERY_PLATFORMS.find((entry) => entry.id === platform)?.host;
  return allowedHost && (host === allowedHost || host.endsWith(`.${allowedHost}`)) ? link : null;
}

export function normalizeGroceryProducts(
  payload: unknown,
  platforms: readonly GroceryPlatform[],
): { products: GroceryProduct[]; creditsRemaining: number | null } {
  if (!isRecord(payload) || payload["status"] !== "success" || !isRecord(payload["data"])) {
    throw new Error("The grocery provider returned an invalid response.");
  }
  const data = payload["data"];
  const results = data["results"];
  if (!isRecord(results)) throw new Error("The grocery provider returned no platform results.");

  const products: GroceryProduct[] = [];
  for (const platform of platforms) {
    const rows = results[platform];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const name = typeof row["name"] === "string" ? row["name"].trim().slice(0, 180) : "";
      const offerPricePaise = validPrice(row["offer_price"] ?? row["price"]);
      if (!name || offerPricePaise === null) continue;

      const images = row["images"];
      const imageUrl = Array.isArray(images) ? safeHttpsUrl(images[0]) : null;
      const platformData = isRecord(row["platform"]) ? row["platform"] : null;
      const productId =
        typeof row["id"] === "string" || typeof row["id"] === "number" ? String(row["id"]) : "";
      products.push({
        id: productId.slice(0, 120),
        name,
        brand: typeof row["brand"] === "string" ? row["brand"].slice(0, 100) : "",
        quantity: typeof row["quantity"] === "string" ? row["quantity"].slice(0, 80) : "",
        platform,
        offerPricePaise,
        mrpPaise: validPrice(row["mrp"]),
        available: row["available"] === true,
        imageUrl,
        deeplink: safeProductLink(row["deeplink"], platform),
        sla:
          platformData && typeof platformData["sla"] === "string"
            ? platformData["sla"].slice(0, 60)
            : null,
      });
    }
  }

  const remaining = payload["credits_remaining"];
  return {
    products: products.sort((a, b) => a.offerPricePaise - b.offerPricePaise),
    creditsRemaining:
      typeof remaining === "number" && Number.isFinite(remaining) ? remaining : null,
  };
}

export function compareKey(product: GroceryProduct): string {
  return `${product.brand} ${product.name} ${product.quantity}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
