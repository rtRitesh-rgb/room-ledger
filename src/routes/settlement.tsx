import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, BellRing, ChevronRight, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Avatar, EmptyState, LoadingBlock, Money, PageHeader, ProgressBar, ResponsiveSheet, StatCard, StatusBadge, cx } from "@/components/kit";
import { useDialogs } from "@/components/dialogs";
import { useLedger } from "@/lib/data";
import { reversePayment } from "@/lib/db";
import { nudge, notifyPayment } from "@/lib/notifications";
import { activePayments, buildBalances, byDateDesc, dayHeading, duesObligations, expenseObligations, shortDate, type Balance, type Obligation, type Payment } from "@/lib/ledger";
import { formatPaise } from "@/lib/money";

export const Route = createFileRoute("/settlement")({
  head: () => ({ meta: [{ title: "Settle Up — Room Ledger" }] }),
  component: SettlePage,
});

const keyOf = (b: Balance) => `${b.kind}|${b.fromId}|${b.toId}`;
const sum = (xs: Obligation[]) => xs.reduce((s, x) => s + x.amountPaise, 0);

function SettlePage() {
  const L = useLedger();
  const { pay } = useDialogs();
  const { expenses, payments, monthDoc, me, nameOf, loading, roommates } = L;
  const [nudgingAll, setNudgingAll] = useState(false);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const { general, dues } = useMemo(() => ({
    general: buildBalances(expenseObligations(expenses), payments, "general"),
    dues: buildBalances(duesObligations(expenses, monthDoc?.fixed ?? null, monthDoc?.managerId ?? null), payments, "dues"),
  }), [expenses, payments, monthDoc]);

  if (loading) return <LoadingBlock />;
  const all = [...general, ...dues];
  const open = all.filter((b) => !b.settled);
  const owe = open.filter((b) => b.fromId === me?.id).reduce((s, b) => s + b.remainingPaise, 0);
  const owed = open.filter((b) => b.toId === me?.id).reduce((s, b) => s + b.remainingPaise, 0);
  const paid = activePayments(payments).reduce((s, p) => s + p.amountPaise, 0);
  const mineOnly = (b: Balance) => scope === "all" || b.fromId === me?.id || b.toId === me?.id;
  const selected = all.find((b) => keyOf(b) === openKey) ?? null;
  // People who still owe me anything (all buckets combined), for the one-tap "Nudge everyone" button.
  const debtors = [...open.filter((b) => b.toId === me?.id).reduce((m, b) => m.set(b.fromId, (m.get(b.fromId) ?? 0) + b.remainingPaise), new Map<string, number>())];
  const nudgeAll = async () => {
    if (!me) return;
    setNudgingAll(true);
    const results = await Promise.all(debtors.map(([id, amt]) => nudge(me, { debtorId: id, amountPaise: amt, what: "what's pending this month" }, roommates.find((x) => x.id === me.id)?.upiId)));
    setNudgingAll(false);
    const sent = results.filter((r) => r === "sent").length;
    if (sent) toast.success(`Nudged ${sent} ${sent === 1 ? "person" : "people"}`);
    else if (results.every((r) => r === "already")) toast("Everyone was already nudged today");
    else toast.error("Couldn't send the nudges. Try again.");
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Settle Up" subtitle="Who owes whom this month" action={debtors.length ? <Button variant="outline" className="h-11" disabled={nudgingAll} onClick={() => void nudgeAll()}><BellRing className="mr-2 size-4" />{nudgingAll ? "Sending…" : `Nudge ${debtors.length === 1 ? nameOf(debtors[0]![0]) : "everyone"}`}</Button> : undefined} />
      <section className="grid grid-cols-2 gap-3" aria-label="Monthly settlement summary">
        <StatCard label="You owe" value={<Money paise={owe} />} tone={owe ? "warning" : "default"} />
        <StatCard label="You are owed" value={<Money paise={owed} />} tone={owed ? "success" : "default"} />
      </section>
      <p className="num -mt-2 text-center text-xs text-muted-foreground">Everyone paid {formatPaise(paid)} this month · {open.length} open {open.length === 1 ? "balance" : "balances"}</p>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Show">
        {([["mine", "Involving me"], ["all", "Everyone"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={scope === id} onClick={() => setScope(id)} className={cx("press h-11 rounded-lg text-sm font-semibold", scope === id ? "bg-card text-primary shadow-soft" : "text-muted-foreground")}>{label}</button>
        ))}
      </div>

      <Section title="Shared expenses" hint="Debts between two people are netted, so you only pay the difference." items={general.filter(mineOnly)} onOpen={setOpenKey} onPay={pay} />
      <Section title={`Rent, fixed charges & meter bills${monthDoc?.managerId ? ` · paid to ${nameOf(monthDoc.managerId)}` : ""}`} hint={monthDoc?.managerId ? "Kept separate from shared expenses so nothing is counted twice." : "Pick this month's manager in Household to see these."} items={dues.filter(mineOnly)} onOpen={setOpenKey} onPay={pay} />

      {selected ? <DetailSheet b={selected} onClose={() => setOpenKey(null)} onPay={(b) => { setOpenKey(null); pay(b); }} /> : null}
    </div>
  );
}

function Section({ title, hint, items, onOpen, onPay }: { title: string; hint: string; items: Balance[]; onOpen: (k: string) => void; onPay: (b: Balance) => void }) {
  const { nameOf, me, roommates } = useLedger();
  const [nudging, setNudging] = useState<string | null>(null);
  const sendNudge = async (b: Balance) => {
    if (!me) return;
    setNudging(keyOf(b));
    const r = await nudge(me, { debtorId: b.fromId, amountPaise: b.remainingPaise, what: b.kind === "dues" ? "rent, fixed charges and meter bills" : "shared expenses" }, roommates.find((x) => x.id === me.id)?.upiId);
    setNudging(null);
    if (r === "sent") toast.success(`Nudged ${nameOf(b.fromId)}`);
    else if (r === "already") toast(`You already nudged ${nameOf(b.fromId)} today`, { description: "Try again tomorrow. If this is your first nudge, publish the latest firestore.rules." });
    else toast.error("Couldn't send the nudge. Check your connection and try again.");
  };
  return (
    <section>
      <h2 className="font-bold">{title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      {items.length === 0 ? <div className="panel"><EmptyState title="Nothing here" body="No balances to show for this month." /></div> : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((b) => {
            const mineOwe = b.fromId === me?.id;
            return (
              <article key={keyOf(b)} className="panel p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={nameOf(mineOwe ? b.toId : b.fromId)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.fromId === me?.id ? `You owe ${nameOf(b.toId)}` : b.toId === me?.id ? `${nameOf(b.fromId)} owes you` : `${nameOf(b.fromId)} owes ${nameOf(b.toId)}`}</p>
                    <p className="num text-xs text-muted-foreground">of {formatPaise(b.originalPaise)} · paid {formatPaise(b.paidPaise)}</p>
                  </div>
                  <div className="text-right"><Money paise={b.remainingPaise} className={cx("block text-lg font-extrabold", b.settled ? "text-success" : mineOwe ? "text-warning-foreground dark:text-warning" : "text-primary")} />{b.settled ? <StatusBadge tone="ok">Settled</StatusBadge> : null}</div>
                </div>
                <div className="mt-3"><ProgressBar value={b.originalPaise ? b.paidPaise / b.originalPaise : 1} /></div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <Button className="bg-grad-primary h-11 text-white" disabled={b.settled} onClick={() => onPay(b)}>{b.settled ? "All paid" : "Record payment"}</Button>
                  <Button variant="outline" className="h-11" onClick={() => onOpen(keyOf(b))} aria-label="See breakdown">Details<ChevronRight className="ml-1 size-4" /></Button>
                </div>
                {b.toId === me?.id && !b.settled ? (
                  <Button variant="outline" className="mt-2 h-11 w-full" disabled={nudging === keyOf(b)} onClick={() => void sendNudge(b)}><BellRing className="mr-2 size-4" />{nudging === keyOf(b) ? "Sending…" : `Nudge ${nameOf(b.fromId)} to pay`}</Button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Lines({ title, tone, lines }: { title: string; tone: "owe" | "back"; lines: Obligation[] }) {
  if (lines.length === 0) return null;
  // Everything is listed by date (newest first), grouped under a day heading, with a running day total.
  const dated = byDateDesc(lines.filter((l) => l.kind !== "fixed"));
  const fixed = lines.filter((l) => l.kind === "fixed");
  const days: [string, Obligation[]][] = [];
  for (const l of dated) { const last = days[days.length - 1]; if (last && last[0] === l.date) last[1].push(l); else days.push([l.date, [l]]); }
  const row = (l: Obligation, i: number) => (
    <li key={i} className="flex min-h-12 items-center justify-between gap-3 py-2">
      <span className="min-w-0"><span className="block truncate text-sm font-medium">{l.label}</span><span className="num block truncate text-xs text-muted-foreground">{l.kind === "utility" ? "Meter bill" : l.detail}</span></span>
      <Money paise={l.amountPaise} className="text-sm font-semibold" />
    </li>
  );
  return (
    <section className="rounded-xl border border-border">
      <div className="flex items-center justify-between rounded-t-xl bg-muted px-3 py-2.5"><h3 className="text-sm font-bold">{title}</h3><Money paise={sum(lines)} className={cx("font-extrabold", tone === "owe" ? "text-warning-foreground dark:text-warning" : "text-success")} /></div>
      {days.map(([date, g]) => (
        <div key={date}>
          <p className="num flex justify-between bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground"><span>{dayHeading(date)}{date ? ` · ${shortDate(date)}` : ""}</span><Money paise={sum(g)} /></p>
          <ul className="divide-y divide-border px-3">{g.map(row)}</ul>
        </div>
      ))}
      {fixed.length ? (
        <div>
          <p className="flex justify-between bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground"><span>Monthly fixed charges</span><Money paise={sum(fixed)} /></p>
          <ul className="divide-y divide-border px-3">{fixed.map(row)}</ul>
        </div>
      ) : null}
    </section>
  );
}

function DetailSheet({ b, onClose, onPay }: { b: Balance; onClose: () => void; onPay: (b: Balance) => void }) {
  const { nameOf, me } = useLedger();
  const [reversing, setReversing] = useState<Payment | null>(null);
  const a = nameOf(b.fromId), c = nameOf(b.toId);
  const youOwe = b.fromId === me?.id, other = youOwe ? c : a;
  const owes = sum(b.lines), back = sum(b.reverseLines);
  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && onClose()} title={b.kind === "dues" ? `Dues · ${a} → ${c}` : `${a} → ${c}`} description="How this balance adds up">
      <div className="space-y-4">
        <div className="num rounded-xl bg-accent p-4 text-sm" aria-label="Balance calculation">
          <div className="flex justify-between"><span>{youOwe ? "You owe" : `${a} owes`} {youOwe ? other : c}</span><Money paise={owes} className="font-semibold" /></div>
          {back > 0 ? <div className="flex justify-between"><span>{youOwe ? `${other} owes you` : `${c} owes ${a}`}</span><Money paise={-back} className="font-semibold" /></div> : null}
          <div className="mt-1 flex justify-between border-t border-border pt-1"><span>Net amount</span><Money paise={b.originalPaise} className="font-bold" /></div>
          <div className="flex justify-between"><span>Paid so far</span><Money paise={-b.paidPaise} className="font-semibold" /></div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 text-base"><span className="font-bold">Still to pay</span><Money paise={b.remainingPaise} className="font-extrabold text-primary" /></div>
        </div>

        <Lines title={youOwe ? `What you owe ${other}` : `What ${a} owes ${c}`} tone="owe" lines={b.lines} />
        <Lines title={youOwe ? `What ${other} owes you (offset)` : `What ${c} owes ${a} (offset)`} tone="back" lines={b.reverseLines} />

        <section>
          <h3 className="mb-1 text-sm font-bold">Payments made</h3>
          {b.payments.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No payments recorded yet.</p> : (
            <ul className="divide-y divide-border rounded-xl border border-border px-3">
              {b.payments.map((p) => (
                <li key={p.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 text-sm font-semibold">{nameOf(p.fromId)} <ArrowRight className="size-3" aria-hidden /> {nameOf(p.toId)}</p>
                      <p className="num text-xs text-muted-foreground">{p.date} · {p.method}{p.reference ? ` · ${p.reference}` : ""}</p>
                    </div>
                    <Money paise={p.amountPaise} className={cx("font-bold", p.reversedById && "text-muted-foreground line-through")} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {p.reversedById ? <StatusBadge tone="danger">Reversed</StatusBadge> : null}
                    {p.verified ? <StatusBadge tone="ok"><BadgeCheck className="size-3" />Verified</StatusBadge> : <StatusBadge tone="muted">Recorded, not bank-verified</StatusBadge>}
                    {!p.reversedById ? <Button variant="ghost" size="sm" className="ml-auto h-11" onClick={() => setReversing(p)}><Undo2 className="mr-1.5 size-4" />Reverse</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Button className="bg-grad-primary h-12 w-full text-white" disabled={b.settled} onClick={() => onPay(b)}>{b.settled ? "All paid" : "Record payment"}</Button>
      </div>
      {reversing ? <ReverseDialog payment={reversing} onClose={() => setReversing(null)} /> : null}
    </ResponsiveSheet>
  );
}

function ReverseDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { me, nameOf } = useLedger();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AlertDialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reverse this payment?</AlertDialogTitle>
          <AlertDialogDescription>{formatPaise(payment.amountPaise)} from {nameOf(payment.fromId)} to {nameOf(payment.toId)} will be marked reversed and the balance restored. The record stays in the history.</AlertDialogDescription>
        </AlertDialogHeader>
        <Input aria-label="Reason for reversal" className="h-11" placeholder="Reason (e.g. wrong amount)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button disabled={busy || !reason.trim() || !me} onClick={async () => {
            setBusy(true);
            try { await reversePayment(payment, reason.trim(), me!.id); notifyPayment({ fromId: payment.fromId, toId: payment.toId, amountPaise: payment.amountPaise }, { id: me!.id, name: me!.name }, nameOf, true); toast.success("Payment reversed"); onClose(); } catch (e) { toast.error((e as Error).message); setBusy(false); }
          }}>Reverse payment</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
