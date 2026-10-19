import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { collection, onSnapshot, query, where, doc, type DocumentData, type Query } from "firebase/firestore";
import { db } from "./firebase";
import { C, fromDoc, resnapshotMonth } from "./db";
import { FIXED_VERSIONS } from "./fixed";
import { useSession } from "./session";
import { DEFAULT_CATEGORIES, type Category } from "./categories";
import {
  DEFAULT_SETTINGS, currentMonth, isMonth, shiftMonth, resolveFixedCharges, buildFixedSnapshot, walletEntriesForFixed, type Allocation, type Expense, type FixedCharge,
  type MonthDoc, type Payment, type RateChange, type Roommate, type Settings, type UtilityBill, type WalletEntry,
} from "./ledger";

type Live<T> = { data: T[]; loaded: boolean; error: string | null };

function useLive<T>(q: Query<DocumentData> | null, key: string): Live<T> {
  const [state, setState] = useState<Live<T>>({ data: [], loaded: false, error: null });
  useEffect(() => {
    if (!q) return;
    setState((s) => ({ ...s, loaded: false }));
    return onSnapshot(
      q,
      (snap) => setState({ data: snap.docs.map((d) => fromDoc<T>(d)), loaded: true, error: null }),
      (err) => setState({ data: [], loaded: true, error: err.message }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

type LedgerValue = {
  month: string;
  setMonth: (m: string) => void;
  loading: boolean;
  error: string | null;
  roommates: Roommate[];
  me: Roommate | null;
  isAdmin: boolean;
  nameOf: (id: string) => string;
  settings: Settings;
  rates: RateChange[];
  fixedVersions: FixedCharge[];
  categories: Category[];
  categoriesSeeded: boolean;
  allocations: Allocation[];
  wallet: WalletEntry[];
  expenses: Expense[];
  bills: UtilityBill[];
  payments: Payment[];
  monthDoc: MonthDoc | null;
  /** Fixed charge items effective right now (used when no snapshot exists yet). */
  fixedPreview: ReturnType<typeof resolveFixedCharges>;
};

const Ctx = createContext<LedgerValue | null>(null);
const MONTH_KEY = "room-ledger-month";

export function LedgerProvider({ children }: { children: ReactNode }) {
  const { roommateId } = useSession();
  const [month, setMonthState] = useState(currentMonth());

  useEffect(() => {
    const stored = localStorage.getItem(MONTH_KEY);
    if (stored && isMonth(stored)) setMonthState(stored);
  }, []);
  const setMonth = (m: string) => {
    if (!isMonth(m)) return;
    localStorage.setItem(MONTH_KEY, m);
    setMonthState(m);
  };

  const roommatesL = useLive<Roommate>(useMemo(() => collection(db, C.roommates), []), "roommates");
  const ratesL = useLive<RateChange>(useMemo(() => collection(db, C.rates), []), "rates");
  const catL = useLive<Category>(useMemo(() => collection(db, C.categories), []), "cats");
  const allocL = useLive<Allocation>(useMemo(() => collection(db, C.allocations), []), "alloc");
  const walletL = useLive<WalletEntry>(useMemo(() => collection(db, C.wallet), []), "wallet");
  const expL = useLive<Expense>(useMemo(() => query(collection(db, C.expenses), where("month", "==", month)), [month]), `exp-${month}`);
  const billL = useLive<UtilityBill>(useMemo(() => query(collection(db, C.bills), where("month", "==", month)), [month]), `bill-${month}`);
  const payL = useLive<Payment>(useMemo(() => query(collection(db, C.payments), where("month", "==", month)), [month]), `pay-${month}`);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  useEffect(
    () =>
      onSnapshot(doc(db, C.settings, "household"), (s) => {
        setSettings({ ...DEFAULT_SETTINGS, ...(s.data() as Partial<Settings> | undefined) });
        setSettingsLoaded(true);
      }, () => setSettingsLoaded(true)),
    [],
  );

  const [monthDoc, setMonthDoc] = useState<MonthDoc | null>(null);
  const [monthLoaded, setMonthLoaded] = useState(false);
  useEffect(() => {
    setMonthLoaded(false);
    return onSnapshot(doc(db, C.months, month), (s) => {
      setMonthDoc(s.exists() ? ({ month, managerId: null, fixed: null, ...(s.data() as Partial<MonthDoc>) } as MonthDoc) : null);
      setMonthLoaded(true);
    }, () => setMonthLoaded(true));
  }, [month]);

  const roommates = useMemo(() => [...roommatesL.data].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)), [roommatesL.data]);
  const me = roommates.find((r) => r.id === roommateId) ?? null;
  const categories = useMemo(() => (catL.data.length ? [...catL.data].sort((a, b) => a.order - b.order) : DEFAULT_CATEGORIES), [catL.data]);

  // Rent / cleaning / water come from code (src/lib/fixed.ts), never from the database. If this month's saved snapshot or vault
  // entries differ from them (first open, old data, or a hand-edited record), they are rewritten here. Safe to repeat.
  const healing = useRef<string>("");
  useEffect(() => {
    if (!roommateId || !monthLoaded || !roommates.length || !walletL.loaded) return;
    if (month > shiftMonth(currentMonth(), 1)) return;
    const expected = buildFixedSnapshot(resolveFixedCharges([...FIXED_VERSIONS], month), roommates.map((r) => r.id));
    const sig = (items: { key: string; shares: Record<string, number> }[]) =>
      JSON.stringify(items.map((i) => [i.key, Object.entries(i.shares).filter(([, v]) => v > 0).sort()]).sort());
    const want = new Map(walletEntriesForFixed(month, expected).map((w) => [w.id, w.amountPaise]));
    const have = walletL.data.filter((w) => w.type === "fixed" && w.month === month);
    const walletOk = have.length === want.size && have.every((w) => want.get(w.id) === w.amountPaise);
    const snapOk = !!monthDoc?.fixed && sig(monthDoc.fixed) === sig(expected) && monthDoc.fixed.every((i) => FIXED_VERSIONS.some((v) => v.key === i.key && v.name === i.name));
    if (snapOk && walletOk) return;
    const key = `${month}|${roommates.map((r) => r.id).join()}`;
    if (healing.current === key) return;
    healing.current = key;
    const stale = have.filter((w) => !want.has(w.id)).map((w) => w.id);
    resnapshotMonth(month, roommates, FIXED_VERSIONS, roommateId, stale).catch(() => {
      healing.current = "";
    });
  }, [month, monthLoaded, monthDoc, roommates, roommateId, walletL.loaded, walletL.data]);

  const loading = ![roommatesL, ratesL, catL, allocL, walletL, expL, billL, payL].every((l) => l.loaded) || !settingsLoaded || !monthLoaded;
  const error = [roommatesL, ratesL, catL, allocL, walletL, expL, billL, payL].map((l) => l.error).find(Boolean) ?? null;

  const value: LedgerValue = {
    month, setMonth, loading, error, roommates, me, isAdmin: me?.role === "admin",
    nameOf: (id) => roommates.find((r) => r.id === id)?.name ?? "—",
    settings, rates: ratesL.data, fixedVersions: [...FIXED_VERSIONS], categories, categoriesSeeded: catL.data.length > 0, allocations: allocL.data, wallet: walletL.data,
    expenses: expL.data, bills: billL.data, payments: payL.data, monthDoc,
    fixedPreview: resolveFixedCharges([...FIXED_VERSIONS], month),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLedger must be used inside LedgerProvider");
  return v;
}
