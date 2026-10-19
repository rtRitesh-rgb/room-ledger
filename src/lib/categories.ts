export type Category = {
  id: string;
  label: string;
  group: string;
  icon: string; // lucide icon name, resolved in components/category-icons.ts
  color: string;
  order: number;
  active: boolean;
  popular: boolean;
};

export const CATEGORY_GROUPS = [
  "Groceries & essentials",
  "Food",
  "Utilities & bills",
  "Transport",
  "Shopping & miscellaneous",
] as const;

const G = { groc: "#5B5FEF", food: "#D99027", util: "#16876B", trans: "#8B5CF6", shop: "#D94C68" };

const raw: [string, string, string, string, string, boolean][] = [
  ["dmart", "Dmart", CATEGORY_GROUPS[0], "ShoppingCart", G.groc, true],
  ["swiggy-instamart", "Swiggy Instamart", CATEGORY_GROUPS[0], "Zap", G.groc, true],
  ["blinkit", "Blinkit", CATEGORY_GROUPS[0], "Zap", G.groc, true],
  ["zepto", "Zepto", CATEGORY_GROUPS[0], "Zap", G.groc, true],
  ["vegetables", "Vegetables", CATEGORY_GROUPS[0], "Carrot", G.groc, true],
  ["milk-dairy", "Milk and dairy", CATEGORY_GROUPS[0], "Milk", G.groc, false],
  ["general-groceries", "General groceries", CATEGORY_GROUPS[0], "ShoppingBasket", G.groc, false],
  ["household-supplies", "Household supplies", CATEGORY_GROUPS[0], "SprayCan", G.groc, false],
  ["food-stalls", "Food stalls", CATEGORY_GROUPS[1], "Soup", G.food, true],
  ["restaurants", "Restaurants", CATEGORY_GROUPS[1], "UtensilsCrossed", G.food, false],
  ["swiggy-food", "Swiggy Food", CATEGORY_GROUPS[1], "Bike", G.food, false],
  ["zomato", "Zomato", CATEGORY_GROUPS[1], "Bike", G.food, false],
  ["snacks-beverages", "Snacks and beverages", CATEGORY_GROUPS[1], "Coffee", G.food, false],
  ["electricity", "Electricity", CATEGORY_GROUPS[2], "Plug", G.util, true],
  ["gas", "Gas", CATEGORY_GROUPS[2], "Flame", G.util, true],
  ["wifi", "Wi-Fi", CATEGORY_GROUPS[2], "Wifi", G.util, true],
  ["water", "Water", CATEGORY_GROUPS[2], "Droplets", G.util, false],
  ["rent", "Rent", CATEGORY_GROUPS[2], "Home", G.util, false],
  ["cleaning", "Cleaning", CATEGORY_GROUPS[2], "Sparkles", G.util, false],
  ["other-utilities", "Other utilities", CATEGORY_GROUPS[2], "Receipt", G.util, false],
  ["cab", "Cab", CATEGORY_GROUPS[3], "Car", G.trans, false],
  ["public-transport", "Public transport", CATEGORY_GROUPS[3], "Bus", G.trans, false],
  ["fuel", "Fuel", CATEGORY_GROUPS[3], "Fuel", G.trans, false],
  ["transport", "Transport", CATEGORY_GROUPS[3], "Route", G.trans, true], // original category, kept for existing records
  ["other-transport", "Other transport", CATEGORY_GROUPS[3], "Route", G.trans, false],
  ["flipkart-minutes", "Flipkart Minutes", CATEGORY_GROUPS[4], "Package", G.shop, false], // original category
  ["flipkart", "Flipkart", CATEGORY_GROUPS[4], "Package", G.shop, false],
  ["amazon", "Amazon", CATEGORY_GROUPS[4], "Package", G.shop, false],
  ["personal-shopping", "Personal shopping", CATEGORY_GROUPS[4], "ShoppingBag", G.shop, false],
  ["medical", "Medical", CATEGORY_GROUPS[4], "Pill", G.shop, false],
  ["other", "Other", CATEGORY_GROUPS[4], "MoreHorizontal", G.shop, true],
];

export const DEFAULT_CATEGORIES: Category[] = raw.map(([id, label, group, icon, color, popular], i) => ({
  id, label, group, icon, color, order: i, active: true, popular,
}));

/** Maps the labels used by the old Supabase app to stable category ids. */
export const LEGACY_CATEGORY_IDS: Record<string, string> = {
  Dmart: "dmart", "Flipkart Minutes": "flipkart-minutes", Blinkit: "blinkit", Zepto: "zepto",
  "Local Food Stalls": "food-stalls", Transport: "transport", Vegetable: "vegetables", Wifi: "wifi",
  Electricity: "electricity", Gas: "gas", Others: "other",
};
