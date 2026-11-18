import type { GroceryPlatform } from "./grocery";

export type GroceryListItem = {
  id: string;
  month: string;
  name: string;
  brand: string;
  quantity: string;
  platform: GroceryPlatform;
  productId: string;
  deeplink: string | null;
  imageUrl: string | null;
  estimatedPricePaise: number;
  purchaseAmountPaise: number | null;
  status: "planned" | "purchased";
  addedBy: string;
  addedAtMs: number;
  purchasedBy: string | null;
  purchasedAtMs: number | null;
  expenseId: string | null;
};

export type NewGroceryListItem = Pick<
  GroceryListItem,
  | "name"
  | "brand"
  | "quantity"
  | "platform"
  | "productId"
  | "deeplink"
  | "imageUrl"
  | "estimatedPricePaise"
>;
