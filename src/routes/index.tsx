import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Flame, HandCoins, Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, EmptyState, LoadingBlock, Money, MonthSwitcher, ProgressBar, StatCard, StatusBadge, cx } from "@/components/kit";
import { CategoryChip } from "@/components/CategoryPicker";
import { useDialogs } from "@/components/dialogs";
import { useLedger } from "@/lib/data";
import { formatPaise } from "@/lib/money";
import {
  buildBalances, categoryTotals, duesObligations, expenseObligations, householdTotal, monthLabel, personMonthStats, vaultSummary,
} from "@/lib/ledger";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Home — Room Ledger" }] }),
  component: HomePage,
});

function HomePage() {
  const L = useLedger();
  const { addExpense, addUtility, pay } = useDialogs();
  const navigate = useNavigate();
  const { me, month, expenses, bills, payments, monthDoc, roommates, categories, allocations, wallet, settings, nameOf } = L;

  const fixed = monthDoc?.fixed ?? null;
  const calc = useMemo(() => {
    const ids = roommates.map((r) => r.id);
    const general = buildBalances(expenseObligations(expenses), payments, "general");
    const dues = buildBalances(duesObligations(expenses, fixed, monthDoc?.managerId ?? null), payments, "dues");
    const all = [...general, ...dues];
    const open = all.filter((b) => !b.settled);
    return {
      stats: personMonthStats(ids, expenses, fixed),
      open,
      owe: open.filter((b) => b.fromId === me?.id).reduce((s, b) => s + b.remainingPaise, 0),
      owed: open.filter((b) => b.toId === me?.id).reduce((s, b) => s + b.remainingPaise, 0),
      household: householdTotal(expenses),
      cats: categoryTotals(expenses.filter((e) => !e.isPersonal || e.payerId === me?.id)),
    };
  }, [expenses, payments, fixed, monthDoc, roommates, me?.id]);

  const vault = me ? vaultSummary(me.id, month, allocations, wallet, settings.carryForward) : null;
  const myStats = me ? calc.stats[me.id] : undefined;

  const daily = useMemo(() => {
    const days = new Map<number, number>();
    for (const e of expenses) if (!e.isPersonal) days.set(Number(e.spentOn.slice(8, 10)), (days.get(Number(e.spentOn.slice(8, 10))) ?? 0) + e.amountPaise);
    const last = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
    return Array.from({ length: last }, (_, i) => ({ day: i + 1, rupees: (days.get(i + 1) ?? 0) / 100 }));
  }, [expenses, month]);

  const people = roommates.map((r) => ({ name: r.name, rupees: (calc.stats[r.id]?.total ?? 0) / 100 }));
  const recent = [...expenses].filter((e) => !e.isPersonal || e.payerId === me?.id).sort((a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAtMs - a.createdAtMs).slice(0, 5);
  const myOpen = calc.open.filter((b) => b.fromId === me?.id || b.toId === me?.id).slice(0, 4);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  if (L.loading) return <LoadingBlock />;

  const tip = vault?.status === "over" ? "Over your allocation" : vault?.status === "low" ? "Running low" : vault?.status === "unset" ? "No allocation set" : "On track";

  return (
    <div className="space-y-5">
      <section className="hero bg-grad-hero rounded-3xl p-5 shadow-lift md:p-7" aria-label="Your Personal Vault">
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm text-white/75">{greet}, {me?.name}</p><p className="text-xs text-white/60">{monthLabel(month)}</p></div>
          <MonthSwitcher className="!border-white/20 !bg-white/10 text-white [&_button:hover]:!bg-white/15" />
        </div>
        <div className="relative mt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/70">Vault remaining</p>
          <p className="num text-4xl font-extrabold md:text-5xl" aria-live="polite">{formatPaise(vault?.remaining ?? 0)}</p>
          <div className="mt-3 max-w-md">
            <ProgressBar value={vault?.utilisation === Infinity ? 1 : (vault?.utilisation ?? 0)} tone={vault?.status ?? "ok"} />
            <div className="num mt-1.5 flex justify-between text-xs text-white/75">
              <span>{formatPaise(vault?.spent ?? 0)} of {formatPaise(vault?.available ?? 0)} used</span>
              <span className="font-semibold">{vault && vault.available > 0 ? `${Math.round(Math.min(vault.utilisation, 9.99) * 100)}%` : "—"} · {tip}</span>
            </div>
          </div>
          <Button onClick={addExpense} className="mt-5 h-11 bg-white text-[#4448d9] hover:bg-white/90"><Plus className="mr-1.5 size-4" />Add expense</Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Financial overview">
        <StatCard label="Household spending" value={<Money paise={calc.household} />} hint="Shared & utility bills" />
        <StatCard label="Your share" value={<Money paise={myStats?.total ?? 0} />} hint="Incl. personal" />
        <StatCard label="You owe" value={<Money paise={calc.owe} />} tone={calc.owe > 0 ? "warning" : "default"} hint={calc.owe > 0 ? "Pending" : "All clear"} />
        <StatCard label="You are owed" value={<Money paise={calc.owed} />} tone={calc.owed > 0 ? "success" : "default"} hint={calc.owed > 0 ? "To receive" : "Nothing pending"} />
      </section>

      <section className="grid grid-cols-3 gap-2" aria-label="Quick actions">
        {[
          { label: "Expense", icon: Plus, on: addExpense },
          { label: "Meter reading", icon: Zap, on: addUtility },
          { label: "Payment", icon: HandCoins, on: () => { const b = myOpen.find((x) => x.fromId === me?.id); if (b) pay(b); else void navigate({ to: "/settlement" }); } },
        ].map((a) => (
          <button key={a.label} type="button" onClick={a.on} className="tile press flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold hover:bg-muted">
            <a.icon className="size-5 text-primary" aria-hidden />{a.label}
          </button>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold">Outstanding payments</h2><Link to="/settlement" className="flex items-center gap-1 text-sm font-semibold text-primary">Settle Up <ArrowRight className="size-3.5" /></Link></div>
          {myOpen.length === 0 ? <EmptyState title="You're all settled" body="Nothing pending for you this month." /> : (
            <ul className="divide-y divide-border">
              {myOpen.map((b) => (
                <li key={`${b.kind}${b.fromId}${b.toId}`} className="flex min-h-14 items-center gap-3 py-2">
                  <Avatar name={nameOf(b.fromId === me?.id ? b.toId : b.fromId)} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{b.fromId === me?.id ? `You owe ${nameOf(b.toId)}` : `${nameOf(b.fromId)} owes you`}</p><p className="text-xs text-muted-foreground">{b.kind === "dues" ? "Rent, fixed & meter dues" : "Shared expenses"}</p></div>
                  <Money paise={b.remainingPaise} className={cx("font-bold", b.fromId === me?.id ? "text-warning-foreground dark:text-warning" : "text-success")} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel p-4">
          <h2 className="mb-3 font-bold">Utility bills & your fixed charges</h2>
          <ul className="space-y-2 text-sm">
            {bills.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                {b.kind === "electricity" ? <Zap className="size-4 text-primary" aria-hidden /> : <Flame className="size-4 text-warning" aria-hidden />}
                <span className="flex-1 font-medium">{b.kind === "electricity" ? "Electricity" : "Gas"}<span className="num ml-2 text-xs text-muted-foreground">{(b.unitsMilli / 1000).toFixed(1)} units</span></span>
                <Money paise={b.amountPaise} className="font-semibold" />
              </li>
            ))}
            {(fixed ?? []).map((f) => (
              <li key={f.key} className="flex items-center gap-3 rounded-xl bg-muted/60 p-3"><span className="flex-1 font-medium">{f.name}</span><Money paise={me ? (f.shares[me.id] ?? 0) : 0} className="font-semibold" /><StatusBadge tone="muted">yours</StatusBadge></li>
            ))}
            {bills.length === 0 && !fixed?.length ? <EmptyState title="No bills yet" action={<Button variant="outline" onClick={addUtility}>Record a reading</Button>} /> : null}
          </ul>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-4" aria-label="Spending by day">
          <h2 className="mb-3 font-bold">Shared spending by day</h2>
          <div className="h-48" role="img" aria-label={`Daily shared spending in ${monthLabel(month)}, total ${formatPaise(daily.reduce((s, d) => s + d.rupees * 100, 0))}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ left: -18, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} interval={4} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
                <Tooltip formatter={(v: number) => formatPaise(Math.round(v * 100))} labelFormatter={(d) => `Day ${d}`} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12 }} />
                <Bar dataKey="rupees" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel p-4" aria-label="Category breakdown">
          <h2 className="mb-3 font-bold">Where it went</h2>
          {calc.cats.length === 0 ? <EmptyState title="No spending yet" /> : (
            <div className="flex items-center gap-4">
              <div className="size-32 shrink-0" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={calc.cats.slice(0, 6).map((c) => ({ name: c.label, value: c.total }))} dataKey="value" innerRadius={34} outerRadius={60} paddingAngle={2} stroke="none">
                    {calc.cats.slice(0, 6).map((_, i) => <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
                {calc.cats.slice(0, 5).map((c, i) => (
                  <li key={c.categoryId} className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--chart-${(i % 5) + 1})` }} aria-hidden /><span className="flex-1 truncate">{c.label}</span><Money paise={c.total} className="font-semibold" /></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <section className="panel p-4" aria-label="Roommate comparison">
        <h2 className="mb-3 font-bold">Roommate comparison</h2>
        <div className="h-40" role="img" aria-label={`Total attributed spending: ${people.map((p) => `${p.name} ${formatPaise(Math.round(p.rupees * 100))}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={people} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide /><YAxis type="category" dataKey="name" width={64} tickLine={false} axisLine={false} tick={{ fill: "var(--foreground)", fontSize: 12 }} />
              <Tooltip formatter={(v: number) => formatPaise(Math.round(v * 100))} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12 }} />
              <Bar dataKey="rupees" fill="var(--chart-3)" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel p-4">
        <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">Recent transactions</h2><Link to="/expenses" className="flex items-center gap-1 text-sm font-semibold text-primary">All <ArrowRight className="size-3.5" /></Link></div>
        {recent.length === 0 ? <EmptyState title="No expenses this month" action={<Button className="bg-grad-primary text-white" onClick={addExpense}>Add the first one</Button>} /> : (
          <ul className="divide-y divide-border">
            {recent.map((e) => {
              const cat = categories.find((c) => c.id === e.categoryId);
              return (
                <li key={e.id} className="flex min-h-16 items-center gap-3 py-2">
                  <CategoryChip category={cat ?? { icon: "Receipt", color: "#5B5FEF" }} />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{e.name}</p><p className="truncate text-xs text-muted-foreground">{e.categoryLabel} · {e.spentOn.slice(5)} · {nameOf(e.payerId)}</p></div>
                  <Money paise={e.amountPaise} className="font-bold" />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
