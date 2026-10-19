import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, EmptyState, LoadingBlock, MonthField, Money, NativeSelect, PageHeader, ProgressBar, ResponsiveSheet, StatusBadge, cx } from "@/components/kit";
import { CategoryChip } from "@/components/CategoryPicker";
import { ICON_NAMES } from "@/components/category-icons";
import { ThemeToggle } from "@/components/Shell";
import { useLedger } from "@/lib/data";
import { addRate, saveCategory, saveSettings, setAllocation, setManager, updateMyUpi } from "@/lib/db";
import { FIXED_CHARGES, FIXED_EACH_PAISE, FIXED_TOTAL_PAISE, eachPaise } from "@/lib/fixed";
import { useSession } from "@/lib/session";
import { CATEGORY_GROUPS, DEFAULT_CATEGORIES, type Category } from "@/lib/categories";
import { buildBalances, currentMonth, duesObligations, monthLabel, personMonthStats, resolveRate, vaultSummary } from "@/lib/ledger";
import { formatPaise, paiseToRupeesString, parseRupees } from "@/lib/money";

const TABS = ["people", "manager", "rates", "fixed", "categories", "settings"] as const;
type TabId = (typeof TABS)[number];
const TAB_LABEL: Record<TabId, string> = { people: "People & Vaults", manager: "Manager", rates: "Utility rates", fixed: "Fixed charges", categories: "Categories", settings: "Settings" };

export const Route = createFileRoute("/household")({
  validateSearch: (s: Record<string, unknown>): { tab: TabId } => ({ tab: (TABS as readonly string[]).includes(s["tab"] as string) ? (s["tab"] as TabId) : "people" }),
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
      <PageHeader title="Household" subtitle="People, vaults and settings" />
      <Tabs value={tab} onValueChange={(v) => void navigate({ to: "/household", search: { tab: v as TabId } })}>
        <TabsList className="mb-4 flex h-12 w-full justify-start gap-1 overflow-x-auto">
          {TABS.map((t) => <TabsTrigger key={t} value={t} className="h-10 shrink-0">{TAB_LABEL[t]}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === "people" ? <PeopleTab /> : tab === "manager" ? <ManagerTab /> : tab === "rates" ? <RatesTab /> : tab === "fixed" ? <FixedTab /> : tab === "categories" ? <CategoriesTab /> : <SettingsTab />}
    </div>
  );
}

const AdminNote = () => <p className="mb-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">Only household admins can change this. You're viewing it read-only.</p>;
const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); return true; } catch (e) { toast.error((e as Error).message || "Couldn't save."); return false; } };

// ───────── People & Personal Vaults ─────────
function PeopleTab() {
  const { roommates, month, allocations, wallet, expenses, monthDoc, settings, isAdmin, me } = useLedger();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const stats = personMonthStats(roommates.map((r) => r.id), expenses, monthDoc?.fixed ?? null);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {roommates.map((r) => {
        const v = vaultSummary(r.id, month, allocations, wallet, settings.carryForward);
        const st = stats[r.id];
        const entries = wallet.filter((w) => w.roommateId === r.id && w.month === month).sort((a, b) => b.date.localeCompare(a.date));
        const months = [...new Set([...allocations.filter((a) => a.roommateId === r.id).map((a) => a.month), ...wallet.filter((w) => w.roommateId === r.id).map((w) => w.month), month])].sort().reverse().slice(0, 6);
        const parsed = parseRupees(text);
        return (
          <article key={r.id} className="panel p-4">
            <div className="flex items-center gap-3">
              <Avatar name={r.name} className="size-11" />
              <div className="flex-1"><p className="font-bold">{r.name}{r.id === me?.id ? <span className="ml-1.5 text-xs font-medium text-muted-foreground">(you)</span> : null}</p><p className="text-xs text-muted-foreground">{r.role === "admin" ? "Admin" : "Member"}{r.upiId ? ` · ${r.upiId}` : ""}</p></div>
              {v.status === "over" ? <StatusBadge tone="danger">Over by {formatPaise(-v.remaining)}</StatusBadge> : v.status === "low" ? <StatusBadge tone="warn">Low balance</StatusBadge> : v.status === "unset" ? <StatusBadge tone="muted">No allocation</StatusBadge> : <StatusBadge tone="ok">On track</StatusBadge>}
            </div>
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">Vault remaining</p>
              <Money paise={v.remaining} className={cx("text-3xl font-extrabold", v.remaining < 0 && "text-destructive")} />
              <div className="mt-2"><ProgressBar value={v.utilisation === Infinity ? 1 : v.utilisation} tone={v.status} /></div>
              <p className="num mt-1.5 text-xs text-muted-foreground">{formatPaise(v.spent)} spent of {formatPaise(v.allocation)} allocation{v.carry ? ` + ${formatPaise(v.carry)} carried` : ""}{v.inherited && v.allocation ? " (inherited)" : ""}</p>
            </div>
            <dl className="num mt-3 grid grid-cols-2 gap-1.5 text-center text-[11px] min-[400px]:grid-cols-4">
              {([["Shared", v.byType.shared], ["Utilities", v.byType.utility], ["Fixed", v.byType.fixed], ["Personal", v.byType.personal]] as const).map(([k, n]) => <div key={k} className="rounded-lg bg-muted p-2"><dt className="text-muted-foreground">{k}</dt><dd className="mt-0.5 text-xs font-bold">{formatPaise(n)}</dd></div>)}
            </dl>
            <p className="num mt-2 text-xs text-muted-foreground">Fronted for the group: {formatPaise(st?.paid ?? 0)} (settled through Settle Up, not counted against the vault).</p>

            {isAdmin ? (editing === r.id ? (
              <div className="mt-3 flex gap-2">
                <Input aria-label={`${r.name} allocation`} inputMode="decimal" className="num h-11" value={text} onChange={(e) => setText(e.target.value)} placeholder="₹ for this month" aria-invalid={text !== "" && parsed === null} />
                <Button className="h-11" disabled={busy || parsed === null} onClick={async () => { setBusy(true); const ok = await run(() => setAllocation(month, r.id, parsed!, v.allocation, me!.id), "Allocation saved"); setBusy(false); if (ok) setEditing(null); }}>Save</Button>
                <Button variant="ghost" className="h-11" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            ) : <Button variant="outline" className="mt-3 h-11" onClick={() => { setEditing(r.id); setText(paiseToRupeesString(v.allocation)); }}><Pencil className="mr-2 size-4" />Edit {monthLabel(month)} allocation</Button>) : null}

            <details className="mt-3"><summary className="cursor-pointer py-2 text-sm font-semibold text-primary">Vault ledger · {monthLabel(month)} ({entries.length})</summary>
              {entries.length === 0 ? <p className="py-2 text-xs text-muted-foreground">No spending recorded.</p> : <ul className="divide-y divide-border text-sm">{entries.map((e) => <li key={e.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0"><span className="block truncate font-medium">{e.label}</span><span className="num text-xs text-muted-foreground">{e.date} · {e.type}</span></span><Money paise={-e.amountPaise} className="font-semibold" /></li>)}</ul>}
            </details>
            <details><summary className="cursor-pointer py-2 text-sm font-semibold text-primary">Monthly history</summary>
              <ul className="divide-y divide-border text-xs">{months.map((m) => { const h = vaultSummary(r.id, m, allocations, wallet, settings.carryForward); return <li key={m} className="num grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-1 py-2"><span className="font-medium">{m}</span><span>{formatPaise(h.allocation)}</span><span>{formatPaise(h.spent)}</span><span className={cx("text-right font-semibold", h.remaining < 0 && "text-destructive")}>{formatPaise(h.remaining)}</span></li>; })}</ul>
              <p className="num grid grid-cols-[4.5rem_1fr_1fr_1fr] gap-1 pb-1 text-[11px] text-muted-foreground"><span>Month</span><span>Allocated</span><span>Spent</span><span className="text-right">Left</span></p>
            </details>
          </article>
        );
      })}
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
        <NativeSelect className="mt-1.5" aria-label="Manager" value={monthDoc?.managerId ?? ""} onChange={(v) => { if (v) void run(() => setManager(month, v, me!.id), "Manager updated"); }} options={[{ value: "", label: "Choose the manager" }, ...roommates.map((r) => ({ value: r.id, label: r.name }))]} />
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

// ───────── Fixed charges ─────────
function FixedTab() {
  const { month, monthDoc, roommates, nameOf } = useLedger();
  const manager = monthDoc?.managerId ? nameOf(monthDoc.managerId) : "the manager";
  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Fixed monthly charges · {monthLabel(month)}</h2><StatusBadge tone="muted">Fixed</StatusBadge></div>
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 font-medium">Charge</th><th className="py-2 text-right font-medium">Room total</th><th className="py-2 text-right font-medium">Each of {roommates.length}</th></tr></thead>
            <tbody className="divide-y divide-border">
              {FIXED_CHARGES.map((c) => (
                <tr key={c.key}><td className="py-2.5 font-semibold">{c.name}</td><td className="py-2.5 text-right"><Money paise={c.totalPaise} /></td><td className="py-2.5 text-right font-bold"><Money paise={eachPaise(c.totalPaise)} /></td></tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t border-border font-extrabold"><td className="py-2.5">Total</td><td className="py-2.5 text-right"><Money paise={FIXED_TOTAL_PAISE} /></td><td className="py-2.5 text-right text-primary"><Money paise={FIXED_EACH_PAISE} /></td></tr></tfoot>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Every roommate pays {formatPaise(FIXED_EACH_PAISE)} each month, collected by {manager}. These amounts are built into the app, so they can't drift or be edited in the database; record payments in Settle Up.</p>
      </section>
    </div>
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
        <h2 className="font-bold">Personal Vault</h2>
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
