import {
  Bike, Bus, Car, Carrot, Coffee, Droplets, Flame, Fuel, Home, MoreHorizontal, Milk, Package, Pill, Plug, Receipt, Route,
  ShoppingBag, ShoppingBasket, ShoppingCart, Soup, Sparkles, SprayCan, UtensilsCrossed, Wifi, Zap, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  Bike, Bus, Car, Carrot, Coffee, Droplets, Flame, Fuel, Home, MoreHorizontal, Milk, Package, Pill, Plug, Receipt, Route,
  ShoppingBag, ShoppingBasket, ShoppingCart, Soup, Sparkles, SprayCan, UtensilsCrossed, Wifi, Zap,
};

export const ICON_NAMES = Object.keys(MAP);
export const categoryIcon = (name: string): LucideIcon => MAP[name] ?? Receipt;
