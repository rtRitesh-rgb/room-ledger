import { createFileRoute, Link } from "@tanstack/react-router";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Geolocation } from "@capacitor/geolocation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ExternalLink, Loader2, MapPin, Search, ShoppingBasket, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  Money,
  NativeSelect,
  PageHeader,
  ResponsiveSheet,
  StatusBadge,
} from "@/components/kit";
import { useLedger } from "@/lib/data";
import { auth, db } from "@/lib/firebase";
import {
  addGroceryListItem,
  C,
  fromDoc,
  recordGroceryPurchase,
  removeGroceryListItem,
} from "@/lib/db";
import {
  compareKey,
  GROCERY_PLATFORMS,
  type GroceryPlatform,
  type GroceryProduct,
} from "@/lib/grocery";
import type { GroceryListItem } from "@/lib/grocery-list";
import { currentMonth, todayISO } from "@/lib/ledger";
import { parseRupees } from "@/lib/money";

export const Route = createFileRoute("/groceries")({
  head: () => ({ meta: [{ title: "Smart Grocery Finder — Room Ledger" }] }),
  component: GroceriesPage,
});

type SearchReply = { products: GroceryProduct[]; creditsRemaining: number | null };
type LocationFields = { lat: string; lon: string; pincode: string };

function GroceriesPage() {
  const { month, me, roommates, nameOf } = useLedger();
  const [queryText, setQueryText] = useState("");
  const [location, setLocation] = useState<LocationFields>({ lat: "", lon: "", pincode: "" });
  const [platforms, setPlatforms] = useState<GroceryPlatform[]>(
    GROCERY_PLATFORMS.map((platform) => platform.id),
  );
  const [products, setProducts] = useState<GroceryProduct[]>([]);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [addingProduct, setAddingProduct] = useState("");
  const [listItems, setListItems] = useState<GroceryListItem[]>([]);
  const [listError, setListError] = useState("");
  const [listLoaded, setListLoaded] = useState(false);
  const [purchaseItem, setPurchaseItem] = useState<GroceryListItem | null>(null);
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [payerId, setPayerId] = useState(me?.id ?? "");
  const [savingPurchase, setSavingPurchase] = useState(false);

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, C.groceryItems), orderBy("addedAtMs", "desc")),
        (snapshot) => {
          setListItems(snapshot.docs.map((item) => fromDoc<GroceryListItem>(item)));
          setListLoaded(true);
          setListError("");
        },
        (error) => {
          setListLoaded(true);
          setListError(error.message);
        },
      ),
    [],
  );

  const thisMonthItems = useMemo(
    () => listItems.filter((item) => item.month === month),
    [listItems, month],
  );
  const comparedProducts = useMemo(() => {
    const groups = new Map<string, GroceryProduct[]>();
    for (const product of products) {
      const key = compareKey(product) || `${product.platform}:${product.id}`;
      groups.set(key, [...(groups.get(key) ?? []), product]);
    }
    return [...groups.values()];
  }, [products]);

  const togglePlatform = (platform: GroceryPlatform, checked: boolean | "indeterminate") => {
    setPlatforms((current) =>
      checked
        ? [...new Set([...current, platform])]
        : current.filter((value) => value !== platform),
    );
  };

  const useCurrentLocation = () => {
    setLocating(true);
    void Geolocation.getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 15_000,
      maximumAge: 300_000,
    })
      .then((position) => {
        setLocation((current) => ({
          ...current,
          lat: position.coords.latitude.toFixed(6),
          lon: position.coords.longitude.toFixed(6),
        }));
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "";
        toast.error(
          /denied|permission/i.test(message)
            ? "Location permission was denied. Allow location access or enter coordinates manually."
            : "Couldn't get your location. Check device location settings or enter coordinates manually.",
        );
      })
      .finally(() => setLocating(false));
  };

  const search = async () => {
    const term = queryText.trim();
    const lat = Number(location.lat);
    const lon = Number(location.lon);
    if (term.length < 2 || term.length > 80) {
      setSearchError("Enter a product name between 2 and 80 characters.");
      return;
    }
    if (
      !location.lat ||
      !location.lon ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      !Number.isFinite(lon) ||
      lon < -180 ||
      lon > 180
    ) {
      setSearchError("Set a valid location using your device or latitude and longitude.");
      return;
    }
    if (location.pincode && !/^\d{6}$/.test(location.pincode)) {
      setSearchError("Enter a valid 6-digit PIN code, or leave it blank.");
      return;
    }
    if (!platforms.length) {
      setSearchError("Choose at least one grocery app.");
      return;
    }

    setSearching(true);
    setSearchError("");
    setSearchCompleted(false);
    setProducts([]);
    setCreditsRemaining(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Sign in again before searching.");
      const response = await fetch("/api/grocery-search", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: term, lat, lon, pincode: location.pincode, platforms }),
      });
      const result = (await response.json()) as Partial<SearchReply> & { error?: unknown };
      if (!response.ok)
        throw new Error(typeof result.error === "string" ? result.error : "Grocery search failed.");
      if (!Array.isArray(result.products))
        throw new Error("The grocery price service returned an unexpected response.");
      setProducts(result.products);
      setCreditsRemaining(
        typeof result.creditsRemaining === "number" ? result.creditsRemaining : null,
      );
      setSearchCompleted(true);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Grocery search failed. Try again.");
    } finally {
      setSearching(false);
    }
  };

  const addToList = async (product: GroceryProduct) => {
    if (!me) return;
    setAddingProduct(`${product.platform}:${product.id}`);
    try {
      await addGroceryListItem(
        {
          name: product.name,
          brand: product.brand,
          quantity: product.quantity,
          platform: product.platform,
          productId: product.id,
          deeplink: product.deeplink,
          imageUrl: product.imageUrl,
          estimatedPricePaise: product.offerPricePaise,
        },
        month,
        me.id,
      );
      toast.success("Added to this month's shared grocery list.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add this item to the list.");
    } finally {
      setAddingProduct("");
    }
  };

  const openPurchase = (item: GroceryListItem) => {
    setPurchaseItem(item);
    setPurchaseAmount(
      item.estimatedPricePaise > 0 ? (item.estimatedPricePaise / 100).toFixed(2) : "",
    );
    setPurchaseDate(currentMonth() === month ? todayISO() : `${month}-01`);
    setPayerId(me?.id ?? "");
  };

  const savePurchase = async () => {
    if (!purchaseItem || !me) return;
    const amountPaise = parseRupees(purchaseAmount);
    if (amountPaise === null || amountPaise <= 0) {
      toast.error("Enter the actual amount paid in rupees.");
      return;
    }
    if (!payerId || !roommates.some((roommate) => roommate.id === payerId)) {
      toast.error("Choose who paid for this grocery purchase.");
      return;
    }
    setSavingPurchase(true);
    try {
      await recordGroceryPurchase({
        groceryItemId: purchaseItem.id,
        amountPaise,
        payerId,
        spentOn: purchaseDate,
        roommateIds: roommates.map((roommate) => roommate.id),
        actorId: me.id,
      });
      toast.success("Purchase recorded in Expenses and split across the household.");
      setPurchaseItem(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't record this purchase.");
    } finally {
      setSavingPurchase(false);
    }
  };

  const deleteFromList = async (item: GroceryListItem) => {
    if (!confirm(`Remove ${item.name} from this month's grocery list?`)) return;
    try {
      await removeGroceryListItem(item);
      toast.success("Removed from the grocery list.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove this item.");
    }
  };

  return (
    <div>
      <Link
        to="/household"
        search={{ tab: "settings" }}
        className="press -ml-1 mb-2 inline-flex h-10 items-center gap-1 rounded-lg px-1 text-sm font-semibold text-primary"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Settings
      </Link>
      <PageHeader
        title="Smart Grocery Finder"
        subtitle="Compare nearby prices, build your shared list, and record purchases."
      />

      <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="grocery-search-title">
        <div>
          <h2 id="grocery-search-title" className="font-bold">
            Find a product
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Prices and stock are live estimates. Your search and location are sent to QuickCommerce
            API; delivery fees are not included.
          </p>
        </div>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <div>
            <Label htmlFor="grocery-query">Product</Label>
            <Input
              id="grocery-query"
              className="mt-1.5 h-11"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="e.g. mustard oil, flour, rice"
              maxLength={80}
            />
          </div>
          <Button
            type="submit"
            className="bg-grad-primary h-11 self-end text-white"
            disabled={searching}
          >
            {searching ? (
              <>
                <Loader2 className="animate-spin" />
                Searching…
              </>
            ) : (
              <>
                <Search />
                Compare prices
              </>
            )}
          </Button>
        </form>

        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div>
            <Label htmlFor="grocery-lat">Latitude</Label>
            <Input
              id="grocery-lat"
              className="num mt-1.5 h-11"
              type="number"
              step="any"
              value={location.lat}
              onChange={(event) =>
                setLocation((current) => ({ ...current, lat: event.target.value }))
              }
              placeholder="e.g. 12.9716"
            />
          </div>
          <div>
            <Label htmlFor="grocery-lon">Longitude</Label>
            <Input
              id="grocery-lon"
              className="num mt-1.5 h-11"
              type="number"
              step="any"
              value={location.lon}
              onChange={(event) =>
                setLocation((current) => ({ ...current, lon: event.target.value }))
              }
              placeholder="e.g. 77.5946"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 self-end"
            onClick={useCurrentLocation}
            disabled={locating}
          >
            {locating ? <Loader2 className="animate-spin" /> : <MapPin />}
            {locating ? "Getting location…" : "Use my location"}
          </Button>
        </div>
        <div className="max-w-xs">
          <Label htmlFor="grocery-pincode">Delivery PIN code (optional)</Label>
          <Input
            id="grocery-pincode"
            className="num mt-1.5 h-11"
            inputMode="numeric"
            maxLength={6}
            value={location.pincode}
            onChange={(event) =>
              setLocation((current) => ({
                ...current,
                pincode: event.target.value.replace(/\D/g, ""),
              }))
            }
            placeholder="6-digit PIN code"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Compare on</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {GROCERY_PLATFORMS.map((platform) => (
              <label
                key={platform.id}
                className="press flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm font-medium"
              >
                <Checkbox
                  checked={platforms.includes(platform.id)}
                  onCheckedChange={(checked) => togglePlatform(platform.id, checked)}
                />
                {platform.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            One search may use up to {platforms.length} API credits (one per app that returns
            results). The free signup allowance is 100 credits.
          </p>
        </fieldset>
        {searchError ? (
          <p
            className="rounded-lg bg-destructive/10 p-3 text-sm font-medium text-destructive"
            role="alert"
          >
            {searchError}
          </p>
        ) : null}
      </section>

      {products.length || searching || searchCompleted ? (
        <section className="mt-5 space-y-3" aria-label="Price comparison results">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">Price comparison</h2>
            {creditsRemaining !== null ? (
              <StatusBadge tone="info">{creditsRemaining} credits left</StatusBadge>
            ) : null}
          </div>
          {searching ? (
            <div className="panel flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking selected stores…
            </div>
          ) : null}
          {comparedProducts.map((group) => (
            <article
              key={compareKey(group[0]!) || `${group[0]!.platform}:${group[0]!.id}`}
              className="panel overflow-hidden"
            >
              <div className="border-b border-border p-3">
                <h3 className="font-semibold">{group[0]!.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {group[0]!.brand ? `${group[0]!.brand} · ` : ""}
                  {group[0]!.quantity || "Quantity not provided"} · {group.length} store
                  {group.length === 1 ? "" : "s"}
                </p>
              </div>
              <ul className="divide-y divide-border">
                {group.map((product) => {
                  const key = `${product.platform}:${product.id}`;
                  const alreadyAdded = thisMonthItems.some(
                    (item) =>
                      item.status === "planned" &&
                      item.platform === product.platform &&
                      item.productId === product.id,
                  );
                  return (
                    <li key={key} className="flex items-center gap-3 p-3">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt=""
                          loading="lazy"
                          className="size-12 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted">
                          <ShoppingBasket className="size-5 text-muted-foreground" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold">
                          {GROCERY_PLATFORMS.find((entry) => entry.id === product.platform)?.label}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {product.available
                            ? (product.sla ?? "Availability may change")
                            : "Currently unavailable"}
                          {product.mrpPaise && product.mrpPaise > product.offerPricePaise
                            ? ` · MRP ₹${(product.mrpPaise / 100).toFixed(2)}`
                            : ""}
                        </p>
                      </div>
                      <Money
                        paise={product.offerPricePaise}
                        className="shrink-0 text-sm font-extrabold"
                      />
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            !product.available ||
                            !product.id ||
                            !product.deeplink ||
                            alreadyAdded ||
                            !!addingProduct
                          }
                          onClick={() => void addToList(product)}
                        >
                          {addingProduct === key ? (
                            <Loader2 className="animate-spin" />
                          ) : alreadyAdded ? (
                            "Added"
                          ) : (
                            "Add"
                          )}
                        </Button>
                        {product.deeplink ? (
                          <a
                            href={product.deeplink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-8 items-center justify-center gap-1 text-xs font-semibold text-primary"
                          >
                            <ExternalLink className="size-3" />
                            Open store
                          </a>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
          {!searching && products.length === 0 ? (
            <div className="panel">
              <EmptyState
                title="No products found"
                body="Try another product name or select a different nearby store."
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6" aria-labelledby="grocery-list-title">
        <header className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 id="grocery-list-title" className="text-lg font-extrabold">
              This month's shared grocery list
            </h2>
            <p className="text-xs text-muted-foreground">
              Items are shared with your household for {month}.
            </p>
          </div>
          <StatusBadge tone="muted">{thisMonthItems.length} items</StatusBadge>
        </header>
        {listError ? (
          <p className="panel p-4 text-sm text-destructive" role="alert">
            Couldn't load the shared grocery list: {listError}
          </p>
        ) : !listLoaded ? (
          <div className="panel p-8 text-center text-sm text-muted-foreground">
            Loading shared list…
          </div>
        ) : thisMonthItems.length === 0 ? (
          <div className="panel">
            <EmptyState
              title="Your list is empty"
              body="Add products from the price comparison above."
            />
          </div>
        ) : (
          <ul className="space-y-2">
            {thisMonthItems.map((item) => (
              <li key={item.id} className="panel flex items-center gap-3 p-3">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt=""
                    loading="lazy"
                    className="size-11 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
                    <ShoppingBasket className="size-5 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.quantity || "Quantity not provided"} ·{" "}
                    {GROCERY_PLATFORMS.find((entry) => entry.id === item.platform)?.label} · added
                    by {nameOf(item.addedBy)}
                  </p>
                  {item.status === "purchased" ? (
                    <StatusBadge tone="ok">
                      Purchased by {nameOf(item.purchasedBy ?? "")}
                    </StatusBadge>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <Money
                    paise={
                      item.status === "purchased"
                        ? (item.purchaseAmountPaise ?? item.estimatedPricePaise)
                        : item.estimatedPricePaise
                    }
                    className="block text-sm font-bold"
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {item.status === "purchased" ? "actual" : "estimate"}
                  </span>
                </div>
                {item.status === "planned" ? (
                  <div className="flex shrink-0 flex-col gap-1">
                    {item.deeplink ? (
                      <a
                        href={item.deeplink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center justify-center gap-1 rounded-md border border-input px-2 text-xs font-semibold text-primary"
                      >
                        <ExternalLink className="size-3" />
                        Buy
                      </a>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      className="bg-grad-primary text-white"
                      onClick={() => openPurchase(item)}
                    >
                      Record
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${item.name}`}
                      onClick={() => void deleteFromList(item)}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  </div>
                ) : item.expenseId ? (
                  <a href="/expenses" className="shrink-0 text-xs font-semibold text-primary">
                    Expense
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ResponsiveSheet
        open={!!purchaseItem}
        onOpenChange={(open) => !open && !savingPurchase && setPurchaseItem(null)}
        title="Record grocery purchase"
        description="The actual amount will be added to Expenses and split equally across the household."
      >
        {purchaseItem ? (
          <form
            className="space-y-4 pb-4"
            onSubmit={(event) => {
              event.preventDefault();
              void savePurchase();
            }}
          >
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="font-semibold">{purchaseItem.name}</p>
              <p className="text-xs text-muted-foreground">
                Estimate: <Money paise={purchaseItem.estimatedPricePaise} />
              </p>
            </div>
            <div>
              <Label htmlFor="purchase-amount">Actual amount paid (₹)</Label>
              <Input
                id="purchase-amount"
                className="num mt-1.5 h-11"
                inputMode="decimal"
                value={purchaseAmount}
                onChange={(event) => setPurchaseAmount(event.target.value)}
                placeholder="e.g. 149.50"
                required
              />
            </div>
            <div>
              <Label htmlFor="purchase-payer">Paid by</Label>
              <NativeSelect
                id="purchase-payer"
                className="mt-1.5"
                value={payerId}
                onChange={setPayerId}
                options={roommates.map((roommate) => ({
                  value: roommate.id,
                  label: roommate.name,
                }))}
              />
            </div>
            <div>
              <Label htmlFor="purchase-date">Purchase date</Label>
              <Input
                id="purchase-date"
                type="date"
                className="num mt-1.5 h-11"
                value={purchaseDate}
                onChange={(event) => setPurchaseDate(event.target.value)}
                required
              />
            </div>
            <Button
              type="submit"
              className="bg-grad-primary h-11 w-full text-white"
              disabled={savingPurchase}
            >
              {savingPurchase ? (
                <>
                  <Loader2 className="animate-spin" />
                  Saving…
                </>
              ) : (
                "Record expense"
              )}
            </Button>
          </form>
        ) : null}
      </ResponsiveSheet>
    </div>
  );
}
