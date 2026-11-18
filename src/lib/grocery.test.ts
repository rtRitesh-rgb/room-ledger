import assert from "node:assert/strict";
import test from "node:test";
import { compareKey, normalizeGroceryProducts, type GroceryPlatform } from "./grocery.ts";

test("normalizes cross-platform prices and sorts cheapest first", () => {
  const result = normalizeGroceryProducts(
    {
      status: "success",
      credits_remaining: 97,
      data: {
        results: {
          BlinkIt: [
            {
              id: "a1",
              name: "Rice",
              quantity: "1 kg",
              offer_price: 80,
              available: true,
              deeplink: "https://blinkit.com/item/a1",
            },
          ],
          Zepto: [
            {
              id: "b2",
              name: "Rice",
              quantity: "1 kg",
              offer_price: 74.5,
              available: true,
              deeplink: "https://zeptonow.com/item/b2",
            },
          ],
        },
      },
    },
    ["BlinkIt", "Zepto"],
  );

  assert.equal(result.creditsRemaining, 97);
  assert.deepEqual(
    result.products.map((product) => product.offerPricePaise),
    [7450, 8000],
  );
  assert.equal(result.products[1]?.deeplink, "https://blinkit.com/item/a1");
});

test("rejects links outside the selected store and malformed responses", () => {
  const result = normalizeGroceryProducts(
    {
      status: "success",
      data: {
        results: {
          Swiggy: [
            {
              id: "s1",
              name: "Oil",
              offer_price: 100,
              available: true,
              deeplink: "https://example.com/item",
            },
          ],
        },
      },
    },
    ["Swiggy"],
  );

  assert.equal(result.products[0]?.deeplink, null);
  assert.throws(() => normalizeGroceryProducts({}, ["BlinkIt"]), /invalid response/);
});

test("uses product name and pack size as comparison identity", () => {
  const platform: GroceryPlatform = "BlinkIt";
  assert.equal(
    compareKey({
      id: "1",
      name: "Rice 1kg",
      quantity: "1 kg",
      brand: "",
      platform,
      offerPricePaise: 100,
      mrpPaise: null,
      available: true,
      imageUrl: null,
      deeplink: null,
      sla: null,
    }),
    compareKey({
      id: "2",
      name: "Rice 1kg",
      quantity: "1 kg",
      brand: "",
      platform: "Zepto",
      offerPricePaise: 200,
      mrpPaise: null,
      available: true,
      imageUrl: null,
      deeplink: null,
      sla: null,
    }),
  );
});
