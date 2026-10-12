"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { aggregate, type Aggregate } from "./analytics";
import { attributeAll, type Attribution } from "./attribution";
import { toDual } from "./currency";
import { addDays, previousPeriod, resolvePeriod, todayISO, type PeriodPreset } from "./dates";
import { DEFAULT_MARGIN_PCT, DEMO_SALES_CURRENCY, generateDataset } from "./mock/seed";
import { detectSignals, suggestTargets, type Signal } from "./rules";
import { scoreCreatives, type CreativeStat } from "./score";
import type { Currency, Dataset, DateRange, Dual, Member, Product, Sale, Workspace, WorkspaceSettings } from "./types";

const WORKSPACES: Workspace[] = [
  { id: "ws_demo", name: "Aroma House", role: "owner" },
  { id: "ws_empty", name: "Bilim Academy", role: "owner" },
];
/** Второй workspace пустой — на нём видно пустые состояния. */
const EMPTY_WORKSPACE_ID = "ws_empty";
const DEFAULT_PRESET: PeriodPreset = "30d";
const TREND_WINDOW_DAYS = 7;
const INITIAL_SYNC_MINUTES_AGO = 12;
const MINUTE_MS = 60_000;
const SYNC_DEMO_MS = 1600;
const PLACEHOLDER_DAY = "2026-01-01";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  salesCurrency: DEMO_SALES_CURRENCY,
  marginPct: DEFAULT_MARGIN_PCT,
  targetCac: 12000,
  targetRomi: 100,
  attributionModel: "last",
  attributionWindow: 30,
};

const blankDataset = (today: string, rates: Dataset["rates"] = {}, members: Member[] = []): Dataset => ({
  today,
  accounts: [],
  campaigns: [],
  adsets: [],
  ads: [],
  creatives: [],
  insights: [],
  leads: [],
  products: [],
  sales: [],
  rates,
  members,
  syncRuns: [],
});

const NO_SALES: Sale[] = [];
const NO_PRODUCTS: Product[] = [];

interface Analytics {
  period: Aggregate;
  previous: Aggregate;
  recent: Aggregate;
  prior: Aggregate;
  stats: CreativeStat[];
  signals: Signal[];
  targetCac: Dual;
  /** Доля: 1 = 100% */
  targetRomi: number;
  suggested: { cacKzt: number; romiPct: number };
}

interface AppState {
  ready: boolean;
  today: string;
  workspaces: Workspace[];
  workspace: Workspace;
  setWorkspaceId: (id: string) => void;
  ds: Dataset;
  isEmpty: boolean;
  sales: Sale[];
  products: Product[];
  members: Member[];
  attributions: Map<string, Attribution>;
  settings: WorkspaceSettings;
  updateSettings: (patch: Partial<WorkspaceSettings>) => void;
  preset: PeriodPreset;
  range: DateRange;
  previousRange: DateRange;
  setPeriod: (preset: PeriodPreset, custom?: DateRange) => void;
  compare: boolean;
  setCompare: (v: boolean) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  analytics: Analytics;
  addSales: (sales: Omit<Sale, "id">[]) => Sale[];
  updateSale: (id: string, patch: Partial<Sale>) => void;
  addProduct: (p: Omit<Product, "id">) => void;
  removeProduct: (id: string) => void;
  inviteMember: (email: string) => void;
  saleDialogOpen: boolean;
  setSaleDialogOpen: (v: boolean) => void;
  lastSyncedAt: number;
  syncing: boolean;
  syncNow: () => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/**
 * Состояние демо-режима: данные генерируются в браузере и живут до перезагрузки.
 * В Фазе 1 провайдер начнёт читать то же самое из Supabase; компоненты не меняются.
 */
export function AppProvider({ children }: { children: ReactNode }) {
  const [today, setToday] = useState("");
  const [demo, setDemo] = useState<Dataset | null>(null);
  const [workspaceId, setWorkspaceId] = useState(WORKSPACES[0].id);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PRESET);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [compare, setCompare] = useState(true);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Генерируем после монтирования: «сегодня» зависит от часового пояса, а не от сервера.
  useEffect(() => {
    const now = todayISO();
    const dataset = generateDataset(now);
    setToday(now);
    setDemo(dataset);
    setSales(dataset.sales);
    setProducts(dataset.products);
    setMembers(dataset.members);
    setLastSyncedAt(Date.now() - INITIAL_SYNC_MINUTES_AGO * MINUTE_MS);
  }, []);

  const isEmpty = workspaceId === EMPTY_WORKSPACE_ID;
  const ds = useMemo<Dataset>(() => {
    if (!demo) return blankDataset(PLACEHOLDER_DAY);
    return isEmpty ? blankDataset(demo.today, demo.rates, demo.members.slice(0, 1)) : demo;
  }, [demo, isEmpty]);

  const wsSales = isEmpty ? NO_SALES : sales;
  const wsProducts = isEmpty ? NO_PRODUCTS : products;

  const range = useMemo(() => resolvePeriod(preset, today || PLACEHOLDER_DAY, custom), [preset, today, custom]);
  const previousRange = useMemo(() => previousPeriod(range), [range]);

  const attributions = useMemo(
    () => attributeAll(wsSales, ds.leads, { model: settings.attributionModel, windowDays: settings.attributionWindow }),
    [wsSales, ds.leads, settings.attributionModel, settings.attributionWindow],
  );

  const analytics = useMemo<Analytics>(() => {
    const period = aggregate(ds, wsSales, attributions, range);
    const previous = aggregate(ds, wsSales, attributions, previousRange);
    const recentRange = { from: addDays(range.to, -(TREND_WINDOW_DAYS - 1)), to: range.to };
    const recent = aggregate(ds, wsSales, attributions, recentRange);
    const prior = aggregate(ds, wsSales, attributions, previousPeriod(recentRange));
    const suggested = suggestTargets(period.total);
    const targetCac = toDual(settings.targetCac ?? suggested.cacKzt, settings.salesCurrency, range.to, ds.rates);
    const targetRomi = (settings.targetRomi ?? suggested.romiPct) / 100;
    const stats = scoreCreatives({ ads: ds.ads, creatives: ds.creatives, period, recent, prior, targetCac, targetRomi });
    const signals = detectSignals({ ds, period, recent, prior, stats, targetCac, targetRomi });
    return { period, previous, recent, prior, stats, signals, targetCac, targetRomi, suggested };
  }, [ds, wsSales, attributions, range, previousRange, settings.targetCac, settings.targetRomi, settings.salesCurrency]);

  const setPeriod = useCallback((next: PeriodPreset, nextCustom?: DateRange) => {
    setPreset(next);
    if (nextCustom) setCustom(nextCustom);
  }, []);

  const updateSettings = useCallback((patch: Partial<WorkspaceSettings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const addSales = useCallback((list: Omit<Sale, "id">[]) => {
    const stamp = Date.now();
    const created = list.map((s, i) => ({ ...s, id: `s_new_${stamp}_${i}` }));
    setSales((prev) => [...created, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    return created;
  }, []);

  const updateSale = useCallback((id: string, patch: Partial<Sale>) => {
    setSales((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const addProduct = useCallback(
    (p: Omit<Product, "id">) => setProducts((prev) => [...prev, { ...p, id: `p_${Date.now()}` }]),
    [],
  );
  const removeProduct = useCallback((id: string) => setProducts((prev) => prev.filter((p) => p.id !== id)), []);
  const inviteMember = useCallback(
    (email: string) =>
      setMembers((prev) => [
        ...prev,
        { id: `m_${Date.now()}`, name: email.split("@")[0], email, role: "member", status: "invited" },
      ]),
    [],
  );

  const syncNow = useCallback(() => {
    setSyncing(true);
    window.setTimeout(() => {
      setSyncing(false);
      setLastSyncedAt(Date.now());
    }, SYNC_DEMO_MS);
  }, []);

  const value: AppState = {
    ready: demo !== null,
    today,
    workspaces: WORKSPACES,
    workspace: WORKSPACES.find((w) => w.id === workspaceId) ?? WORKSPACES[0],
    setWorkspaceId,
    ds,
    isEmpty,
    sales: wsSales,
    products: wsProducts,
    members: isEmpty ? members.slice(0, 1) : members,
    attributions,
    settings,
    updateSettings,
    preset,
    range,
    previousRange,
    setPeriod,
    compare,
    setCompare,
    currency,
    setCurrency,
    analytics,
    addSales,
    updateSale,
    addProduct,
    removeProduct,
    inviteMember,
    saleDialogOpen,
    setSaleDialogOpen,
    lastSyncedAt,
    syncing,
    syncNow,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
