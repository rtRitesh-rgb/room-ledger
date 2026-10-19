import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Flame, Paperclip, Plus, Search, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingBlock, Money, NativeSelect, PageHeader, StatusBadge } from "@/components/kit";
import { CategoryChip } from "@/components/CategoryPicker";
import { useDialogs } from "@/components/dialogs";
import { useLedger } from "@/lib/data";
import { deleteUtilityBill } from "@/lib/db";
import { categoryTotals, type Expense } from "@/lib/ledger";
import { formatMilli, formatPaise } from "@/lib/money";

export const Route = createFileRoute("/expenses")({
  head: () => ({ meta: [{ title: "Expenses — Room Ledger" }] }),
  component: ExpensesPage,
});

type Tab = "all" | "shared" | "personal" | "utilities";
type Sort = "newest" | "oldest" | "high" | "low";

function ExpensesPage() {
  const L = useLedger();
  const { addExpense, editExpense, addUtility } = useDialogs();
  const { expenses, bills, categories, me, roommates, nameOf, loading } = L;
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [cat, setCat] = useState("all");
  const [payer, setPayer] = useState("all");

  // Personal expenses belong to their owner — other roommates don't see them.
  const visible = useMemo(() => expenses.filter((e) => !e.isPersonal || e.payerId === me?.id), [expenses, me?.id]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = visible.filter((e) =>
      (tab === "all" || (tab === "shared" && !e.isPersonal && e.kind === "expense") || (tab === "personal" && e.isPersonal) || (tab === "utilities" && e.kind === "utility")) &&
      (cat === "all" || e.categoryId === cat) && (payer === "all" || e.payerId === payer) &&
      (!term || `${e.name} ${e.categoryLabel} ${nameOf(e.payerId)} ${e.note}`.toLowerCase().includes(term)),
    );
    const by: Record<Sort, (a: Expense, b: Expense) => number> = {
      newest: (a, b) => b.spentOn.localeCompare(a.spentOn) || b.createdAtMs - a.createdAtMs,
      oldest: (a, b) => a.spentOn.localeCompare(b.spentOn) || a.createdAtMs - b.createdAtMs,
      high: (a, b) => b.amountPaise - a.amountPaise,
      low: (a, b) => a.amountPaise - b.amountPaise,
    };
    return list.sort(by[sort]);
  }, [visible, tab, q, cat, payer, sort, nameOf]);

  const total = rows.reduce((s, e) => s + e.amountPaise, 0);
  const cats = categoryTotals(rows).slice(0, 4);
  const usedCats = categories.filter((c) => visible.some((e) => e.categoryId === c.id));

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Expenses" subtitle={`${rows.length} transactions · ${formatPaise(total)}`} action={<Button className="bg-grad-primary hidden h-10 text-white md:inline-flex" onClick={addExpense}><Plus className="mr-1.5 size-4" />Add</Button>} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid h-12 w-full grid-cols-4">
          {(["all", "shared", "personal", "utilities"] as const).map((t) => <TabsTrigger key={t} value={t} className="h-10 capitalize">{t === "utilities" ? "Bills" : t}</TabsTrigger>)}
        </TabsList>
      </Tabs>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <div className="relative col-span-2 sm:col-span-1"><Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden /><Input aria-label="Search expenses" className="h-11 pl-9" placeholder="Search name, category, person…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <NativeSelect className="sm:w-44" aria-label="Category filter" value={cat} onChange={setCat} options={[{ value: "all", label: "All categories" }, ...usedCats.map((c) => ({ value: c.id, label: c.label }))]} />
        <NativeSelect className="sm:w-36" aria-label="Paid by filter" value={payer} onChange={setPayer} options={[{ value: "all", label: "Anyone" }, ...roommates.map((r) => ({ value: r.id, label: r.name }))]} />
        <NativeSelect className="col-span-2 sm:col-span-1 sm:w-40" aria-label="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "high", label: "Amount: high to low" }, { value: "low", label: "Amount: low to high" }]} />
      </div>

      {cats.length > 0 && tab !== "utilities" ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Top categories">
          {cats.map((c) => <button key={c.categoryId} type="button" onClick={() => setCat(c.categoryId)} className="tile press shrink-0 px-3 py-2 text-left text-xs"><span className="text-muted-foreground">{c.label}</span><br /><Money paise={c.total} className="text-sm font-bold" /></button>)}
        </div>
      ) : null}

      {tab === "utilities" ? (
        <section className="mt-4 space-y-2">
          <div className="flex justify-end"><Button variant="outline" className="h-11" onClick={addUtility}><Zap className="mr-2 size-4" />Record reading</Button></div>
          {bills.length === 0 ? <div className="panel"><EmptyState title="No meter readings this month" /></div> : bills.map((b) => (
            <article key={b.id} className="panel flex items-center gap-3 p-4">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">{b.kind === "electricity" ? <Zap className="size-5" /> : <Flame className="size-5" />}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{b.kind === "electricity" ? "Electricity" : "Gas"} · <Money paise={b.amountPaise} /></p>
                <p className="num text-xs text-muted-foreground">{formatMilli(b.startMilli)} → {formatMilli(b.endMilli)} = {formatMilli(b.unitsMilli)} units @ {formatPaise(b.ratePaise)} · {b.readingDate} · by {nameOf(b.payerId)}</p>
              </div>
              <Button variant="ghost" size="icon" className="size-11 text-destructive" aria-label="Delete bill" onClick={async () => {
                if (!me || !confirm("Delete this bill? Everyone's dues and vaults are recalculated.")) return;
                try { await deleteUtilityBill(b, expenses.find((x) => x.id === b.expenseId), me.id); toast.success("Bill deleted"); } catch (e) { toast.error((e as Error).message); }
              }}><Trash2 className="size-4" /></Button>
            </article>
          ))}
        </section>
      ) : rows.length === 0 ? (
        <div className="panel mt-4"><EmptyState title={q || cat !== "all" || payer !== "all" ? "No matches" : "No expenses yet"} body="Try a different filter, or add one." action={<Button className="bg-grad-primary text-white" onClick={addExpense}>Add expense</Button>} /></div>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((e) => {
            const c = categories.find((x) => x.id === e.categoryId);
            const mine = me ? e.shares[me.id] : undefined;
            return (
              <li key={e.id}>
                <button type="button" disabled={e.kind === "utility"} onClick={() => editExpense(e)} className="panel press flex w-full items-center gap-3 p-3 text-left hover:border-primary/40 disabled:cursor-default">
                  <CategoryChip category={c ?? { icon: "Receipt", color: "#5B5FEF" }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate font-semibold">{e.name}</span>{e.receiptUrl ? <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has receipt" /> : null}</span>
                    <span className="block truncate text-xs text-muted-foreground">{e.categoryLabel} · {e.spentOn.slice(5)} · paid by {nameOf(e.payerId)}</span>
                    <span className="mt-1 flex gap-1.5">{e.isPersonal ? <StatusBadge tone="muted">Personal</StatusBadge> : e.kind === "utility" ? <StatusBadge tone="info">Utility</StatusBadge> : <StatusBadge tone="info">Shared · {Object.keys(e.shares).length}</StatusBadge>}</span>
                  </span>
                  <span className="text-right"><Money paise={e.amountPaise} className="block font-extrabold" />{mine !== undefined && !e.isPersonal ? <span className="num text-xs text-muted-foreground">your share {formatPaise(mine)}</span> : null}</span>
                </button>
                {e.receiptUrl ? <a href={e.receiptUrl} target="_blank" rel="noreferrer noopener" className="ml-4 inline-block py-1 text-xs font-semibold text-primary">View receipt</a> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
