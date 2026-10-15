"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { t } from "@/i18n";
import { aggregate, type Aggregate } from "./analytics";
import { attributeAll, type Attribution } from "./attribution";
import { toDual } from "./currency";
import { addDays, previousPeriod, resolvePeriod, todayISO, type PeriodPreset } from "./dates";
import { AD_PLATFORMS, adErrorText, runAdSync } from "./ads-api";
import { DEFAULT_MARGIN_PCT, DEMO_SALES_CURRENCY, generateDataset } from "./mock/seed";
import { leadsAdd, leadsDelete, type ManualLeadInput } from "./leads-api";
import { detectSignals, suggestTargets, type Signal } from "./rules";
import { productArchive, productInsert, saleDelete, saleSetSource, salesInsert } from "./sales-api";
import { scoreCreatives, type CreativeStat } from "./score";
import { getBrowserSupabase } from "./supabase/client";
import { loadWorkspaceData, rowToLead, type WorkspaceData } from "./supabase/dataset";
import type { FnResult } from "./supabase/functions";
import { rowToMember, settingsToRow, type MemberRow } from "./supabase/rows";
import { callTeam, type TeamResult, WORKSPACE_STORAGE_KEY } from "./team-api";
import type {
  Credentials,
  Currency,
  Dataset,
  DateRange,
  Dual,
  Lead,
  Member,
  Product,
  Sale,
  SessionContext,
  SessionUser,
  Workspace,
  WorkspaceSettings,
} from "./types";

const DEMO_WORKSPACES: Workspace[] = [
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
const TIME_LENGTH = 5;

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
  /** Гость без аккаунта: всё работает на тестовых данных в браузере. */
  demoMode: boolean;
  /** Вошедший пользователь; у гостя null. */
  user: SessionUser | null;
  /** Может менять настройки и состав workspace: владелец или владелец платформы. */
  canManage: boolean;
  signOut: () => Promise<void>;
  workspaces: Workspace[];
  workspace: Workspace;
  setWorkspaceId: (id: string) => void;
  renameWorkspace: (name: string) => Promise<boolean>;
  /** Перечитывает данные workspace из базы: после подключения кабинета или синхронизации. */
  reloadData: () => Promise<void>;
  /** Реклама подключена, а продаж ещё не внесли: прибыль и ROMI пока считаются без выручки. */
  salesPending: boolean;
  /** Куда вести кнопку «Подключить» из пустых экранов. */
  connectHref: string;
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
  /** false — сохранить не удалось (сообщение об ошибке уже показано). */
  addSales: (sales: Omit<Sale, "id">[]) => Promise<boolean>;
  /** Источник продажи, выбранный вручную; null — убрать выбор. */
  setSaleSource: (id: string, adId: string | null) => Promise<boolean>;
  deleteSale: (id: string) => Promise<boolean>;
  /** Ключ workspace для приёма лидов с сайта; у гостя null. */
  ingestKey: string | null;
  /** Лид, добавленный вручную. Телефон проверяет и приводит к E.164 сервер. */
  addLead: (input: ManualLeadInput) => Promise<FnResult<Lead>>;
  deleteLead: (id: string) => Promise<boolean>;
  addProduct: (p: Omit<Product, "id">) => Promise<boolean>;
  removeProduct: (id: string) => Promise<boolean>;
  inviteMember: (input: { email: string; name: string }) => Promise<TeamResult<Credentials>>;
  removeMember: (userId: string) => Promise<boolean>;
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
 * Состояние приложения.
 * Гость (session = null) работает в демо-режиме: данные генерируются в браузере.
 * У вошедшего пользователя workspace, настройки и команда лежат в Supabase.
 * Пока к workspace не подключена реклама и с сайта не пришёл ни один лид, он показывает
 * те же тестовые данные (флаг demoData), и продажи с товарами в нём тоже живут только в браузере.
 */
export function AppProvider({ children, session = null }: { children: ReactNode; session?: SessionContext | null }) {
  const demoMode = session === null;
  const user = session?.user ?? null;
  const [today, setToday] = useState("");
  const [demo, setDemo] = useState<Dataset | null>(null);
  const [realWorkspaces, setRealWorkspaces] = useState<Workspace[]>(session?.workspaces ?? []);
  const workspaces = demoMode ? DEMO_WORKSPACES : realWorkspaces;
  const [workspaceId, setWorkspaceIdState] = useState(workspaces[0]?.id ?? "");
  const [realMembers, setRealMembers] = useState<Member[]>([]);
  const [real, setReal] = useState<WorkspaceData | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [demoSettings, setDemoSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PRESET);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [compare, setCompare] = useState(true);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [saleDialogOpen, setSaleDialogOpen] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [ingestKey, setIngestKey] = useState<string | null>(null);

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

  const workspace = workspaces.find((w) => w.id === workspaceId) ?? workspaces[0];
  const settings = demoMode ? demoSettings : (workspace.settings ?? DEFAULT_SETTINGS);
  const canManage = demoMode || workspace.role === "owner" || user?.isPlatformAdmin === true;
  // Workspace с подключённой рекламой читает данные из базы, остальные показывают демо-набор
  const usesRealData = !demoMode && workspace.demoData === false;
  const isEmpty = demoMode ? workspaceId === EMPTY_WORKSPACE_ID : usesRealData && (real?.dataset.accounts.length ?? 0) === 0;

  // Возвращаем workspace, выбранный в прошлый раз
  useEffect(() => {
    try {
      const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (stored && workspaces.some((w) => w.id === stored)) setWorkspaceIdState(stored);
    } catch {
      /* хранилище недоступно — остаётся первый workspace */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- читаем один раз при входе
  }, []);

  const setWorkspaceId = useCallback((id: string) => {
    setWorkspaceIdState(id);
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    } catch {
      /* приватный режим: выбор сохранится до перезагрузки */
    }
  }, []);

  const loadMembers = useCallback(async (id: string) => {
    const { data } = await getBrowserSupabase()
      .from("workspace_members")
      .select("role, profiles(id, full_name, email)")
      .eq("workspace_id", id)
      .order("created_at")
      .returns<MemberRow[]>();
    setRealMembers((data ?? []).flatMap((row) => rowToMember(row) ?? []));
  }, []);

  const realWorkspaceId = demoMode ? null : workspace.id;
  useEffect(() => {
    if (realWorkspaceId) void loadMembers(realWorkspaceId);
  }, [realWorkspaceId, loadMembers]);
  const ds = useMemo<Dataset>(() => {
    if (!demo) return blankDataset(PLACEHOLDER_DAY);
    if (usesRealData) return real?.dataset ?? blankDataset(demo.today);
    return isEmpty ? blankDataset(demo.today, demo.rates, demo.members.slice(0, 1)) : demo;
  }, [demo, isEmpty, usesRealData, real]);

  // У настоящих данных продажи и товары лежат в базе, у демо-набора — в памяти браузера
  const realSales = real?.dataset.sales;
  const realProducts = real?.dataset.products;
  const wsSales = usesRealData ? (realSales ?? NO_SALES) : isEmpty ? NO_SALES : sales;
  const wsProducts = useMemo(() => {
    if (usesRealData) return realProducts?.filter((p) => !p.archived) ?? NO_PRODUCTS;
    return isEmpty ? NO_PRODUCTS : products;
  }, [usesRealData, realProducts, isEmpty, products]);

  const range = useMemo(() => resolvePeriod(preset, today || PLACEHOLDER_DAY, custom), [preset, today, custom]);
  const previousRange = useMemo(() => previousPeriod(range), [range]);

  /** Реклама уже настоящая, а продаж в базе ещё нет. */
  const salesPending = usesRealData && wsSales.length === 0;

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
    const scored = scoreCreatives({ ads: ds.ads, creatives: ds.creatives, period, recent, prior, targetCac, targetRomi });
    // Пока продажи не подключены, «нет продаж» не значит «реклама не окупается»:
    // выводы о сливе бюджета и советы «отключить» были бы ложными.
    const stats = salesPending ? scored.map((stat) => ({ ...stat, badge: "lowdata" as const })) : scored;
    const signals = salesPending ? [] : detectSignals({ ds, period, recent, prior, stats, targetCac, targetRomi });
    return { period, previous, recent, prior, stats, signals, targetCac, targetRomi, suggested };
  }, [ds, wsSales, attributions, range, previousRange, settings.targetCac, settings.targetRomi, settings.salesCurrency, salesPending]);

  const setPeriod = useCallback((next: PeriodPreset, nextCustom?: DateRange) => {
    setPreset(next);
    if (nextCustom) setCustom(nextCustom);
  }, []);

  const patchWorkspace = useCallback(
    (id: string, patch: Partial<Workspace>) => setRealWorkspaces((list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w))),
    [],
  );

  /** Меняет строку workspace в базе. false — база отказала (например, участник без прав владельца). */
  const saveWorkspace = useCallback(async (id: string, row: Record<string, unknown>) => {
    const { data, error } = await getBrowserSupabase().from("workspaces").update(row).eq("id", id).select("id");
    return !error && (data?.length ?? 0) > 0;
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<WorkspaceSettings>) => {
      if (demoMode) {
        setDemoSettings((s) => ({ ...s, ...patch }));
        return;
      }
      const previous = settings;
      patchWorkspace(workspace.id, { settings: { ...previous, ...patch } });
      void saveWorkspace(workspace.id, settingsToRow(patch)).then((saved) => {
        if (saved) return;
        patchWorkspace(workspace.id, { settings: previous });
        toast.error(t.common.saveFailed);
      });
    },
    [demoMode, settings, workspace.id, patchWorkspace, saveWorkspace],
  );

  const renameWorkspace = useCallback(
    async (name: string) => {
      if (demoMode) return true;
      const saved = await saveWorkspace(workspace.id, { name });
      if (saved) patchWorkspace(workspace.id, { name });
      return saved;
    },
    [demoMode, workspace.id, patchWorkspace, saveWorkspace],
  );

  const loadReal = useCallback(async (id: string, day: string) => {
    try {
      setReal(await loadWorkspaceData(id, day));
    } catch {
      toast.error(t.common.loadFailed);
      setReal({ dataset: blankDataset(day), connections: [], lastSyncedAt: 0 });
    }
  }, []);

  useEffect(() => {
    if (!usesRealData || !today) return;
    setReal(null);
    void loadReal(workspace.id, today);
  }, [usesRealData, workspace.id, today, loadReal]);

  const reloadData = useCallback(async () => {
    if (demoMode || !today) return;
    const { data } = await getBrowserSupabase().from("workspaces").select("demo_data").eq("id", workspace.id).maybeSingle();
    // Первый подключённый кабинет выключает демо-данные: эффект выше сам загрузит настоящие
    if (data?.demo_data === false && workspace.demoData !== false) patchWorkspace(workspace.id, { demoData: false });
    else if (data?.demo_data === false) await loadReal(workspace.id, today);
  }, [demoMode, today, workspace.id, workspace.demoData, patchWorkspace, loadReal]);

  const signOut = useCallback(async () => {
    await getBrowserSupabase().auth.signOut();
    window.location.assign("/login");
  }, []);

  /** Меняет набор настоящих данных на месте: после записи в базу перечитывать всё незачем. */
  const patchDataset = useCallback(
    (change: (dataset: Dataset) => Partial<Dataset>) => setReal((prev) => prev && { ...prev, dataset: { ...prev.dataset, ...change(prev.dataset) } }),
    [],
  );

  const addSales = useCallback(
    async (list: Omit<Sale, "id">[]) => {
      const newestFirst = (a: Sale, b: Sale) => b.date.localeCompare(a.date);
      if (usesRealData) {
        const created = await salesInsert(workspace.id, list);
        if (!created) {
          toast.error(t.common.saveFailed);
          return false;
        }
        patchDataset((dataset) => ({ sales: [...created, ...dataset.sales].sort(newestFirst) }));
        return true;
      }
      const stamp = Date.now();
      const created = list.map((s, i) => ({ ...s, id: `s_new_${stamp}_${i}` }));
      setSales((prev) => [...created, ...prev].sort(newestFirst));
      return true;
    },
    [usesRealData, workspace.id, patchDataset],
  );

  const setSaleSource = useCallback(
    async (id: string, adId: string | null) => {
      const withSource = (list: Sale[]) => list.map((s) => (s.id === id ? { ...s, manualAdId: adId } : s));
      if (!usesRealData) {
        setSales(withSource);
        return true;
      }
      const saved = await saleSetSource(id, adId);
      if (saved) patchDataset((dataset) => ({ sales: withSource(dataset.sales) }));
      else toast.error(t.common.saveFailed);
      return saved;
    },
    [usesRealData, patchDataset],
  );

  const deleteSale = useCallback(
    async (id: string) => {
      const without = (list: Sale[]) => list.filter((s) => s.id !== id);
      if (!usesRealData) {
        setSales(without);
        return true;
      }
      const removed = await saleDelete(id);
      if (removed) patchDataset((dataset) => ({ sales: without(dataset.sales) }));
      return removed;
    },
    [usesRealData, patchDataset],
  );

  // Ключ приёма лидов нужен и до подключения рекламы: сайт можно подключить первым
  useEffect(() => {
    setIngestKey(null);
    if (demoMode) return;
    let stale = false;
    void getBrowserSupabase()
      .from("ingest_keys")
      .select("key")
      .eq("workspace_id", workspace.id)
      .maybeSingle<{ key: string }>()
      .then(({ data }) => {
        if (!stale) setIngestKey(data?.key ?? null);
      });
    return () => {
      stale = true;
    };
  }, [demoMode, workspace.id]);

  const addLead = useCallback(
    async (input: ManualLeadInput): Promise<FnResult<Lead>> => {
      if (usesRealData) {
        const result = await leadsAdd(workspace.id, input);
        if (!result.ok) return result;
        const lead = rowToLead(result.data.lead);
        patchDataset((dataset) => ({ leads: [lead, ...dataset.leads] }));
        return { ok: true, data: lead };
      }
      // Демо-данные живут в браузере: лид добавляется только на этот сеанс
      const ad = demo?.ads.find((a) => a.id === input.adId);
      const lead: Lead = {
        id: `l_new_${Date.now()}`,
        phone: input.phone,
        name: input.name,
        source: "manual",
        platform: ad?.platform ?? null,
        campaignId: ad?.campaignId ?? null,
        adsetId: ad?.adsetId ?? null,
        adId: ad?.id ?? null,
        date: todayISO(),
        time: new Date().toTimeString().slice(0, TIME_LENGTH),
      };
      setDemo((prev) => prev && { ...prev, leads: [lead, ...prev.leads] });
      return { ok: true, data: lead };
    },
    [usesRealData, workspace.id, demo?.ads, patchDataset],
  );

  const deleteLead = useCallback(
    async (id: string) => {
      if (usesRealData) {
        const result = await leadsDelete(workspace.id, id);
        if (!result.ok) return false;
        patchDataset((dataset) => ({ leads: dataset.leads.filter((l) => l.id !== id) }));
        return true;
      }
      setDemo((prev) => prev && { ...prev, leads: prev.leads.filter((l) => l.id !== id) });
      return true;
    },
    [usesRealData, workspace.id, patchDataset],
  );

  const addProduct = useCallback(
    async (p: Omit<Product, "id">) => {
      if (!usesRealData) {
        setProducts((prev) => [...prev, { ...p, id: `p_${Date.now()}` }]);
        return true;
      }
      const created = await productInsert(workspace.id, p);
      if (created) patchDataset((dataset) => ({ products: [...dataset.products, created] }));
      return created !== null;
    },
    [usesRealData, workspace.id, patchDataset],
  );

  const removeProduct = useCallback(
    async (id: string) => {
      if (!usesRealData) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
        return true;
      }
      // Товар уходит в архив: у старых продаж остаётся его название
      const archived = await productArchive(id);
      if (archived) patchDataset((dataset) => ({ products: dataset.products.map((p) => (p.id === id ? { ...p, archived: true } : p)) }));
      return archived;
    },
    [usesRealData, patchDataset],
  );
  const inviteMember = useCallback(
    async ({ email, name }: { email: string; name: string }): Promise<TeamResult<Credentials>> => {
      if (demoMode) {
        setMembers((prev) => [
          ...prev,
          { id: `m_${Date.now()}`, name: name || email.split("@")[0], email, role: "member", status: "invited" },
        ]);
        return { ok: true, data: { email, password: null } };
      }
      const result = await callTeam({ action: "invite_member", workspaceId: workspace.id, email, name });
      if (result.ok) await loadMembers(workspace.id);
      return result;
    },
    [demoMode, workspace.id, loadMembers],
  );

  const removeMember = useCallback(
    async (userId: string) => {
      if (demoMode) {
        setMembers((prev) => prev.filter((m) => m.id !== userId));
        return true;
      }
      const result = await callTeam<{ ok: boolean }>({ action: "remove_member", workspaceId: workspace.id, userId });
      if (result.ok) await loadMembers(workspace.id);
      return result.ok;
    },
    [demoMode, workspace.id, loadMembers],
  );

  const demoMembers = isEmpty ? members.slice(0, 1) : members;

  const realAccounts = usesRealData ? real?.dataset.accounts : undefined;
  const syncNow = useCallback(() => {
    setSyncing(true);
    if (!realAccounts) {
      window.setTimeout(() => {
        setSyncing(false);
        setLastSyncedAt(Date.now());
      }, SYNC_DEMO_MS);
      return;
    }
    // Платформы обновляем по очереди; ошибка одной не мешает обновить другую
    void (async () => {
      for (const platform of AD_PLATFORMS) {
        const accounts = realAccounts.filter((a) => a.platform === platform).map((a) => ({ id: a.id, name: a.name }));
        if (!accounts.length) continue;
        const result = await runAdSync(platform, workspace.id, accounts, today, "refresh");
        if (!result.ok) toast.error(adErrorText(platform, result));
      }
      await loadReal(workspace.id, today);
      setSyncing(false);
    })();
  }, [realAccounts, workspace.id, today, loadReal]);

  const value: AppState = {
    ready: demo !== null && (!usesRealData || real !== null),
    today,
    demoMode,
    user,
    canManage,
    signOut,
    workspaces,
    workspace,
    setWorkspaceId,
    renameWorkspace,
    reloadData,
    salesPending,
    connectHref: demoMode ? "/onboarding" : "/settings",
    ds,
    isEmpty,
    sales: wsSales,
    products: wsProducts,
    members: demoMode ? demoMembers : realMembers,
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
    setSaleSource,
    deleteSale,
    ingestKey,
    addLead,
    deleteLead,
    addProduct,
    removeProduct,
    inviteMember,
    removeMember,
    saleDialogOpen,
    setSaleDialogOpen,
    lastSyncedAt: usesRealData ? (real?.lastSyncedAt ?? 0) : lastSyncedAt,
    syncing,
    syncNow,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
