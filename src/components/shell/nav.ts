import { Images, LayoutDashboard, Megaphone, Settings, ShoppingBag, Sparkles, Users, type LucideIcon } from "lucide-react";

export type NavKey = "dashboard" | "campaigns" | "creatives" | "leads" | "sales" | "ai" | "settings";

export interface NavItem {
  key: NavKey;
  href: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { key: "dashboard", href: "/dashboard", icon: LayoutDashboard },
  { key: "campaigns", href: "/campaigns", icon: Megaphone },
  { key: "creatives", href: "/creatives", icon: Images },
  { key: "leads", href: "/leads", icon: Users },
  { key: "sales", href: "/sales", icon: ShoppingBag },
  { key: "ai", href: "/ai", icon: Sparkles },
  { key: "settings", href: "/settings", icon: Settings },
];

/** Нижняя навигация на телефоне: 4 раздела + «Ещё». */
export const BOTTOM_NAV_KEYS: NavKey[] = ["dashboard", "campaigns", "creatives", "sales"];

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function currentNav(pathname: string): NavItem | undefined {
  return NAV.find((item) => isActive(pathname, item.href));
}
