import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, EmptyState, LoadingBlock, MonthField, Money, NativeSelect, PageHeader, ProgressBar, ResponsiveSheet, StatusBadge, cx } from "@/components/kit";
import { CategoryChip } from "@/components/CategoryPicker";
import { AmountInput } from "@/components/AmountInput";
import { DailyLimitCard } from "@/components/DailyLimit";
import { ICON_NAMES } from "@/components/category-icons";
import { ThemeToggle } from "@/components/Shell";
import { useLedger } from "@/lib/data";
import { notifyManager } from "@/lib/notifications";
import { friendlyError } from "@/lib/errors";
import { addRate, saveCategory, saveFixedCharge, saveSettings, setAllocation, setManager, updateMyUpi } from "@/lib/db";
import { evalAmount } from "@/lib/calc";
import { useSession } from "@/lib/session";
import { CATEGORY_GROUPS, DEFAULT_CATEGORIES, type Category } from "@/lib/categories";
import { buildBalances, currentMonth, duesObligations, monthLabel, resolveFixedCharges, resolveRate, vaultSummary, type FixedCharge } from "@/lib/ledger";
import { formatPaise, paiseToRupeesString, parseRupees, splitEqual } from "@/lib/money";

const TABS = ["wallet", "fixed", "manager", "rates", "categories", "settings"] as const;
type TabId = (typeof TABS)[number];
const TAB_LABEL: Record<TabId, string> = { wallet: "My wallet", fixed: "Rent & fixed", manager: "Manager", rates: "Utility rates", categories: "Categories", settings: "Settings" };

export const Route = createFileRoute("/household")({
  validateSearch: (s: Record<string, unknown>): { tab: TabId } => ({ tab: (TABS as readonly string[]).includes(s["tab"] as string) ? (s["tab"] as TabId) : "wallet" }),
  head: () => ({ meta: [{ title: "Household — Room Ledger" }] }),
  component: HouseholdPage,
});

function HouseholdPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const { loading } = useLedger();
  if (loading) return <LoadingBlock />;
  return (
    <div>
      <PageHeader title="Household" subtitle="Your wallet, rent and settings" />
      <Tabs value={tab} onValueChange={(v) => void navigate({ to: "/household", search: { tab: v as TabId } })}>
        <TabsList className="mb-4 flex h-12 w-full justify-start gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => <TabsTrigger key={t} value={t} className="h-10 shrink-0">{TAB_LABEL[t]}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === "wallet" ? <WalletTab /> : tab === "manager" ? <ManagerTab /> : tab === "rates" ? <RatesTab /> : tab === "fixed" ? <FixedTab /> : tab === "categories" ? <CategoriesTab /> : <SettingsTab />}
    </div>
  );
}

const AdminNote = () => <p className="mb-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">Only household admins can change this. You're viewing it read-only.</p>;
const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); return true; } catch (e) { toast.error(friendlyError(e)); return false; } };

// ───────── My wallet (private: nobody else can see or change it) ─────────
function WalletTab() {
  const { month, allocations, wallet, settings, me } = useLedger();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const v = vaultSummary(me.id, month, allocations, wallet, settings.carryForward);
  const entries = wallet.filter((w) => w.roommateId === me.id && w.month === month).sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
  const months = [...new Set([...allocations.map((a) => a.month), ...wallet.map((w) => w.month), month])].sort().reverse().slice(0, 6);
  const parsed = evalAmount(text);

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-xl bg-accent p-3 text-xs text-accent-foreground"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />This wallet is yours alone. Your roommates can't see its balance, spending or daily limit, and only you can change it.</p>

      <article className="panel p-4">
        <div className="flex items-center gap-3">
          <Avatar name={me.name} className="size-11" />
          <div className="flex-1"><p className="font-bold">{me.name}</p><p className="text-xs text-muted-foreground">{monthLabel(month)}</p></div>
          {v.status === "over" ? <StatusBadge tone="danger">Over by {formatPaise(-v.remaining)}</StatusBadge> : v.status === "low" ? <StatusBadge tone="warn">Low balance</StatusBadge> : v.status === "unset" ? <StatusBadge tone="muted">Not set</StatusBadge> : <StatusBadge tone="ok">On track</StatusBadge>}
        </div>
        <div className="mt-4">
          <p className="text-xs text-muted-foreground">Wallet remaining</p>
          <Money paise={v.remaining} className={cx("text-3xl font-extrabold", v.remaining < 0 && "text-destructive")} />
          <div className="mt-2"><ProgressBar value={v.utilisation === Infinity ? 1 : v.utilisation} tone={v.status} /></div>
          <p className="num mt-1.5 text-xs text-muted-foreground">{formatPaise(v.spent)} spent of {formatPaise(v.allocation)}{v.carry ? ` + ${formatPaise(v.carry)} carried` : ""}{v.inherited && v.allocation ? " (same as last month)" : ""}</p>
        </div>

        {editing ? (
          <div className="mt-3 space-y-2">
            <Label htmlFor="alloc">My wallet for {monthLabel(month)} (₹)</Label>
            <AmountInput id="alloc" value={text} onChange={setText} invalid={text !== "" && parsed === null} placeholder="e.g. 15000 or 10000+5000" />
            <div className="flex gap-2">
              <Button className="h-11 flex-1" disabled={busy || parsed === null} onClick={async () => { setBusy(true); const ok = await run(() => setAllocation(month, me.id, parsed!, v.allocation, me.id), "Wallet saved"); setBusy(false); if (ok) setEditing(false); }}>Save</Button>
              <Button variant="ghost" className="h-11" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">Later months keep this amount until you change it.</p>
          </div>
        ) : <Button variant="outline" className="mt-3 h-11 w-full" onClick={() => { setEditing(true); setText(v.allocation ? paiseToRupeesString(v.allocation) : ""); }}><Pencil className="mr-2 size-4" />{v.allocation ? "Edit my wallet amount" : "Set my wallet amount"}</Button>}
      </article>

      <DailyLimitCard />

      <dl className="num grid grid-cols-2 gap-2 text-center text-[11px] min-[400px]:grid-cols-4">
        {([["Shared", v.byType.shared], ["Utilities", v.byType.utility], ["Rent & fixed", v.byType.fixed], ["Personal", v.byType.personal]] as const).map(([k, n]) => <div key={k} className="tile p-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="mt-0.5 text-sm font-bold">{formatPaise(n)}</dd></div>)}
      </dl>

      <section className="panel p-4">
        <h2 className="mb-1 font-bold">Wallet ledger · {entries.length}</h2>
        <p className="mb-1 text-xs text-muted-foreground">Newest first. Money you front for the group is settled in Settle Up, not counted here.</p>
        {entries.length === 0 ? <p className="py-2 text-sm text-muted-foreground">No spending recorded yet.</p> : <ul className="divide-y divide-border text-sm">{entries.map((e) => <li key={e.id} className="flex min-h-12 items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="block truncate font-medium">{e.label}</span><span className="num text-xs text-muted-foreground">{fmtDate(e.date)} · {e.type === "fixed" ? "rent & fixed" : e.type}</span></span><Money paise={-e.amountPaise} className="font-semibold" /></li>)}</ul>}
      </section>

      <details className="panel p-4"><summary className="cursor-pointer text-sm font-semibold text-primary">Monthly history</summary>
        <p className="num mt-2 grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-1 text-[11px] text-muted-foreground"><span>Month</span><span>Wallet</span><span>Spent</span><span className="text-right">Left</span></p>
        <ul className="divide-y divide-border text-xs">{months.map((m) => { const h = vaultSummary(me.id, m, allocations, wallet, settings.carryForward); return <li key={m} className="num grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-1 py-2"><span className="font-medium">{m}</span><span>{formatPaise(h.allocation)}</span><span>{formatPaise(h.spent)}</span><span className={cx("text-right font-semibold", h.remaining < 0 && "text-destructive")}>{formatPaise(h.remaining)}</span></li>; })}</ul>
      </details>
    </div>
  );
}

// ───────── Manager ─────────
function ManagerTab() {
  const { roommates, month, monthDoc, expenses, payments, me, nameOf } = useLedger();
  const dues = buildBalances(duesObligations(expenses, monthDoc?.fixed ?? null, monthDoc?.managerId ?? null), payments, "dues");
  const pending = dues.reduce((s, b) => s + b.remainingPaise, 0);
  return (
    <section className="panel space-y-4 p-4">
      <div>
        <Label>Manager for {monthLabel(month)}</Label>
        <NativeSelect className="mt-1.5" aria-label="Manager" value={monthDoc?.managerId ?? ""} onChange={(v) => { if (v) void run(async () => { await setManager(month, v, me!.id); notifyManager(v, monthLabel(month), { id: me!.id, name: me!.name }); }, "Manager updated"); }} options={[{ value: "", label: "Choose the manager" }, ...roommates.map((r) => ({ value: r.id, label: r.name }))]} />
        <p className="mt-1.5 text-xs text-muted-foreground">The manager collects rent, fixed charges and fronts meter bills. Changing the manager changes who is owed the fixed charges.</p>
      </div>
      <div className="rounded-xl bg-muted p-4"><p className="text-xs text-muted-foreground">Dues still pending with {monthDoc?.managerId ? nameOf(monthDoc.managerId) : "the manager"}</p><Money paise={pending} className="text-2xl font-extrabold text-primary" /><p className="mt-1 text-xs text-muted-foreground">Record payments in Settle Up → Rent, fixed charges & meter dues.</p></div>
    </section>
  );
}

// ───────── Utility rates ─────────
function RatesTab() {
  const { rates, isAdmin, me } = useLedger();
  const [kind, setKind] = useState<"electricity" | "gas">("electricity");
  const [rate, setRate] = useState("");
  const [eff, setEff] = useState(currentMonth());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = parseRupees(rate);
  const err = rate !== "" && (parsed === null || parsed <= 0) ? "Enter a rate above zero (up to 2 decimals)." : "";
  const history = [...rates].sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth) || b.createdAtMs - a.createdAtMs);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["electricity", "gas"] as const).map((k) => { const r = resolveRate(rates, k, currentMonth()); return (
          <div key={k} className="tile p-4"><p className="text-xs capitalize text-muted-foreground">{k} · now</p><p className="num text-2xl font-extrabold">{formatPaise(r.ratePaise)}<span className="text-sm font-medium text-muted-foreground"> / unit</span></p><p className="text-xs text-muted-foreground">{r.isDefault ? "Default rate" : `Since ${r.effectiveMonth}`}{r.note ? ` · ${r.note}` : ""}</p></div>
        ); })}
      </div>
      <section className="panel p-4">
        <h2 className="font-bold">Change a rate</h2>
        <p className="mb-3 text-xs text-muted-foreground">Bills already saved keep the rate they were calculated with. A new rate only applies to readings dated in or after its effective month.</p>
        {!isAdmin ? <AdminNote /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Utility</Label><NativeSelect className="mt-1.5" aria-label="Utility" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[{ value: "electricity", label: "Electricity" }, { value: "gas", label: "Gas" }]} /></div>
            <div><Label htmlFor="rate">Price per unit (₹)</Label><Input id="rate" inputMode="decimal" className="num mt-1.5 h-11" value={rate} onChange={(e) => setRate(e.target.value)} aria-invalid={!!err} />{err ? <p className="mt-1 text-xs font-medium text-destructive" role="alert">{err}</p> : null}</div>
            <div><Label htmlFor="eff">Effective from</Label><MonthField id="eff" value={eff} onChange={setEff} /></div>
            <div><Label htmlFor="rnote">Note (optional)</Label><Input id="rnote" className="mt-1.5 h-11" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button className="bg-grad-primary h-11 text-white sm:col-span-2" disabled={busy || !parsed || !eff} onClick={async () => { setBusy(true); const ok = await run(() => addRate({ kind, ratePaise: parsed!, effectiveMonth: eff, note: note.trim() }, me!.id), "Rate saved"); setBusy(false); if (ok) { setRate(""); setNote(""); } }}>Save new rate</Button>
          </div>
        )}
      </section>
      <section className="panel p-4"><h2 className="mb-2 font-bold">Rate history</h2>
        {history.length === 0 ? <p className="text-sm text-muted-foreground">Using the defaults (electricity ₹9, gas ₹50 per unit). Changes will be listed here.</p> : <ul className="divide-y divide-border text-sm">{history.map((h) => <li key={h.id} className="flex justify-between gap-3 py-2"><span className="capitalize">{h.kind} · from {h.effectiveMonth}{h.note ? ` · ${h.note}` : ""}</span><Money paise={h.ratePaise} className="font-semibold" /></li>)}</ul>}
      </section>
    </div>
  );
}

// ───────── Fixed charges (editable) ─────────
const fmtDate = (d: string) => `${d.slice(8, 10)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(d.slice(5, 7)) - 1] ?? ""}`;
const totalOf = (c: FixedCharge, n: number) => (c.allocation === "custom" && Object.keys(c.customShares).length ? Object.values(c.customShares).reduce((a, b) => a + b, 0) : c.amountPaise * n);

function FixedTab() {
  const { month, monthDoc, roommates, nameOf, fixedVersions, isAdmin } = useLedger();
  const [editor, setEditor] = useState<{ charge?: FixedCharge } | null>(null);
  const manager = monthDoc?.managerId ? nameOf(monthDoc.managerId) : "the manager";
  const n = roommates.length;
  const charges = resolveFixedCharges(fixedVersions, month);
  const roomTotal = charges.reduce((s, c) => s + totalOf(c, n), 0);
  const history = fixedVersions.filter((v) => v.createdAtMs > 0).sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 8);
  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="font-bold">Rent & fixed charges · {monthLabel(month)}</h2>{isAdmin ? <Button className="h-10" onClick={() => setEditor({})}><Plus className="mr-1.5 size-4" />Add</Button> : null}</div>
        {!isAdmin ? <AdminNote /> : null}
        {charges.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No fixed charges for this month.</p> : (
          <ul className="divide-y divide-border">
            {charges.map((c) => (
              <li key={c.key} className="flex min-h-14 items-center gap-3 py-2">
                <div className="min-w-0 flex-1"><p className="font-semibold">{c.name}</p><p className="num text-xs text-muted-foreground">Room total <Money paise={totalOf(c, n)} /> · each of {n} pays <Money paise={Math.floor(totalOf(c, n) / Math.max(1, n))} />{c.allocation === "custom" ? "+" : ""}</p></div>
                {isAdmin ? <Button variant="outline" className="h-11" onClick={() => setEditor({ charge: c })}><Pencil className="mr-1.5 size-4" />Edit</Button> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="num mt-3 flex items-center justify-between rounded-xl bg-muted p-3 text-sm font-extrabold"><span>Total per month</span><span className="text-primary"><Money paise={roomTotal} /> <span className="text-xs font-medium text-muted-foreground">room</span></span></div>
        <p className="mt-3 text-xs text-muted-foreground">Each roommate's share is collected by {manager}; record payments in Settle Up. A change applies from the month you pick onward — months before it keep their saved amounts.</p>
      </section>
      {history.length ? (
        <section className="panel p-4"><h2 className="mb-1 font-bold">Recent changes</h2>
          <ul className="divide-y divide-border text-sm">{history.map((h) => <li key={h.id} className="flex justify-between gap-3 py-2"><span>{h.name} · from {h.effectiveMonth}{h.active ? "" : " · stopped"}</span><Money paise={h.active ? totalOf(h, n) : 0} className="font-semibold" /></li>)}</ul>
        </section>
      ) : null}
      {editor ? <FixedEditor {...(editor.charge ? { charge: editor.charge } : {})} onClose={() => setEditor(null)} /> : null}
    </div>
  );
}

function FixedEditor({ charge, onClose }: { charge?: FixedCharge; onClose: () => void }) {
  const { month, roommates, fixedVersions, me } = useLedger();
  const n = roommates.length;
  const [name, setName] = useState(charge?.name ?? "");
  const [total, setTotal] = useState(charge ? paiseToRupeesString(totalOf(charge, n)) : "");
  const [eff, setEff] = useState(month);
  const [stop, setStop] = useState(false);
  const [busy, setBusy] = useState(false);
  const paise = evalAmount(total);
  const each = paise !== null && n ? splitEqual(paise, roommates.map((r) => r.id)) : null;
  const eachText = each ? (Math.max(...Object.values(each)) === Math.min(...Object.values(each)) ? formatPaise(Object.values(each)[0] ?? 0) : `${formatPaise(Math.min(...Object.values(each)))} – ${formatPaise(Math.max(...Object.values(each)))}`) : "—";
  const valid = name.trim() !== "" && (stop || (paise !== null && paise > 0));
  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && !busy && onClose()} title={charge ? `Edit ${charge.name}` : "Add a fixed charge"} description="Split equally between all roommates every month">
      <div className="space-y-4">
        <div><Label htmlFor="fc-name">Name</Label><Input id="fc-name" className="mt-1.5 h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Room rent, WiFi" /></div>
        <div>
          <Label htmlFor="fc-total">Room total per month (₹)</Label>
          <AmountInput id="fc-total" className="mt-1.5" value={total} onChange={setTotal} invalid={total !== "" && paise === null} />
          <p className="num mt-1 text-sm text-muted-foreground">Each of {n} pays <strong className="text-foreground">{eachText}</strong></p>
        </div>
        <div><Label>Applies from</Label><MonthField value={eff} onChange={setEff} /><p className="mt-1.5 text-xs text-muted-foreground">Months before this stay exactly as they were.</p></div>
        {charge ? <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"><div><Label htmlFor="fc-stop">Stop this charge from {eff}</Label><p className="text-xs text-muted-foreground">Nobody is charged from that month on.</p></div><Switch id="fc-stop" checked={stop} onCheckedChange={setStop} /></div> : null}
        <Button className="bg-grad-primary h-12 w-full text-white" disabled={busy || !valid || !me} onClick={async () => {
          setBusy(true);
          const ok = await run(() => saveFixedCharge({ ...(charge ? { key: charge.key } : {}), name, totalPaise: stop ? (charge ? totalOf(charge, n) : 0) : paise!, effectiveMonth: eff, active: !stop }, roommates, fixedVersions, currentMonth(), me!.id), stop ? "Charge stopped" : "Fixed charge saved");
          setBusy(false); if (ok) onClose();
        }}>{busy ? "Saving…" : "Save"}</Button>
      </div>
    </ResponsiveSheet>
  );
}

// ───────── Categories ─────────
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "charge";

function CategoriesTab() {
  const { categories, categoriesSeeded, isAdmin, me } = useLedger();
  const [label, setLabel] = useState("");
  const [group, setGroup] = useState<string>(CATEGORY_GROUPS[4]);
  const [icon, setIcon] = useState("Receipt");
  const [color, setColor] = useState("#5B5FEF");
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);

  const persist = (changed: Category[], ok: string) => run(async () => {
    const list = categoriesSeeded ? changed : DEFAULT_CATEGORIES.map((d) => changed.find((c) => c.id === d.id) ?? d).concat(changed.filter((c) => !DEFAULT_CATEGORIES.some((d) => d.id === c.id)));
    await Promise.all(list.map((c) => saveCategory(c, me!.id)));
  }, ok);

  const move = (c: Category, dir: -1 | 1) => {
    const sibs = categories.filter((x) => x.group === c.group);
    const i = sibs.findIndex((x) => x.id === c.id);
    const o = sibs[i + dir];
    if (o) void persist([{ ...c, order: o.order }, { ...o, order: c.order }], "Reordered");
  };
  const groups = [...new Set([...CATEGORY_GROUPS, ...categories.map((c) => c.group)])];

  return (
    <div className="space-y-4">
      {!isAdmin ? <AdminNote /> : (
        <section className="panel p-4">
          <h2 className="mb-3 font-bold">New category</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="cat-l">Name</Label><Input id="cat-l" className="mt-1.5 h-11" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div><Label>Group</Label><NativeSelect className="mt-1.5" aria-label="Group" value={group} onChange={setGroup} options={[...CATEGORY_GROUPS]} /></div>
            <div><Label>Icon</Label><NativeSelect className="mt-1.5" aria-label="Icon" value={icon} onChange={setIcon} options={ICON_NAMES} /></div>
            <div><Label htmlFor="cat-c">Colour</Label><Input id="cat-c" type="color" className="mt-1.5 h-11 p-1" value={color} onChange={(e) => setColor(e.target.value)} /></div>
            <Button className="bg-grad-primary h-11 text-white sm:col-span-2" disabled={!label.trim()} onClick={async () => { const ok = await persist([{ id: `${slug(label)}-${Date.now().toString(36)}`, label: label.trim(), group, icon, color, order: Math.max(0, ...categories.map((c) => c.order)) + 1, active: true, popular: false }], "Category added"); if (ok) setLabel(""); }}>Add category</Button>
          </div>
        </section>
      )}
      {groups.map((g) => { const rows = categories.filter((c) => c.group === g); return rows.length ? (
        <section key={g} className="panel p-4"><h2 className="mb-2 font-bold">{g}</h2>
          <ul className="divide-y divide-border">{rows.map((c, i) => (
            <li key={c.id} className="flex items-center gap-2 py-2">
              <CategoryChip category={c} />
              {renaming?.id === c.id ? <Input aria-label="Category name" className="h-10 flex-1" value={renaming.text} autoFocus onChange={(e) => setRenaming({ id: c.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && renaming.text.trim()) void persist([{ ...c, label: renaming.text.trim() }], "Renamed").then(() => setRenaming(null)); if (e.key === "Escape") setRenaming(null); }} /> : <span className={cx("flex-1 text-sm font-medium", !c.active && "text-muted-foreground line-through")}>{c.label}</span>}
              {isAdmin ? (<>
                <button type="button" aria-label={`Rename ${c.label}`} className="grid size-11 place-items-center rounded-md hover:bg-muted" onClick={() => setRenaming({ id: c.id, text: c.label })}><Pencil className="size-4" /></button>
                <button type="button" aria-label="Move up" disabled={i === 0} className="grid size-11 place-items-center rounded-md hover:bg-muted disabled:opacity-30" onClick={() => move(c, -1)}><ChevronUp className="size-4" /></button>
                <button type="button" aria-label="Move down" disabled={i === rows.length - 1} className="grid size-11 place-items-center rounded-md hover:bg-muted disabled:opacity-30" onClick={() => move(c, 1)}><ChevronDown className="size-4" /></button>
                <Switch aria-label={`${c.label} active`} checked={c.active} onCheckedChange={(a) => void persist([{ ...c, active: a }], a ? "Activated" : "Deactivated")} />
              </>) : null}
            </li>))}</ul>
        </section>) : null; })}
      <p className="text-xs text-muted-foreground">Expenses remember their category by a permanent id, so renaming or deactivating a category never changes past records.</p>
    </div>
  );
}

// ───────── Settings ─────────
function SettingsTab(): ReactNode {
  const { settings, isAdmin, me } = useLedger();
  const { signOut, user } = useSession();
  const [upi, setUpi] = useState(me?.upiId ?? "");
  return (
    <div className="space-y-4">
      <section className="panel space-y-4 p-4">
        <h2 className="font-bold">Wallet</h2>
        <div className="flex items-center justify-between gap-4"><div><Label htmlFor="carry">Carry unused balance into next month</Label><p className="text-xs text-muted-foreground">Off by default. When on, leftover (or overspent) vault balance rolls forward. Balances are always recomputed from the ledger, so toggling is reversible.</p></div><Switch id="carry" checked={settings.carryForward} disabled={!isAdmin} onCheckedChange={(v) => void run(() => saveSettings({ carryForward: v }, me!.id), "Setting saved")} /></div>
        {!isAdmin ? <AdminNote /> : null}
      </section>
      <section className="panel space-y-3 p-4"><h2 className="font-bold">Appearance</h2><ThemeToggle full /></section>
      <section className="panel space-y-3 p-4"><h2 className="font-bold">Your profile</h2>
        <div><Label htmlFor="upi">Your UPI ID</Label><div className="mt-1.5 flex gap-2"><Input id="upi" className="h-11" value={upi} onChange={(e) => setUpi(e.target.value)} placeholder="name@bank" /><Button className="h-11" onClick={() => void run(() => updateMyUpi(me!.id, upi.trim()), "UPI saved")}>Save</Button></div></div>
        <p className="text-xs text-muted-foreground">Signed in as {user?.email}</p>
        <Button variant="outline" className="h-11" onClick={() => void signOut()}>Sign out</Button>
      </section>
      <section className="panel p-4 text-xs text-muted-foreground"><h2 className="mb-1 text-sm font-bold text-foreground">Security notes</h2><p>Sign-in uses Firebase Auth and data is protected by Firestore security rules. Balances are derived from an append-only ledger and every change is audit-logged. Without server-side functions, rules can check who you are and the shape of the data, but cannot recompute totals, so a determined household member with developer tools could still write inconsistent figures. See SETUP.md.</p></section>
    </div>
  );
}
