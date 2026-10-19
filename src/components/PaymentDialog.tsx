import { useRef, useState } from "react";
import { ArrowRight, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, Money, NativeSelect, ProgressBar, ResponsiveSheet } from "./kit";
import { useLedger } from "@/lib/data";
import { recordPayment } from "@/lib/db";
import { uuid } from "@/lib/uuid";
import { formatPaise, paiseToRupeesString, parseRupees } from "@/lib/money";
import { validatePayment, type Balance } from "@/lib/ledger";

export function PaymentDialog({ balance, onClose }: { balance: Balance; onClose: () => void }) {
  const { month, nameOf, me, roommates } = useLedger();
  const requestId = useRef(uuid()).current; // same id on every retry → can't double-record
  const [amountText, setAmountText] = useState(paiseToRupeesString(balance.remainingPaise));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("UPI");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);

  const amount = parseRupees(amountText);
  const error = validatePayment(amount, balance.remainingPaise);
  const upi = roommates.find((r) => r.id === balance.toId)?.upiId;

  const submit = async () => {
    if (!me || amount === null || error) return;
    setBusy(true);
    try {
      await recordPayment(requestId, { month, fromId: balance.fromId, toId: balance.toId, amountPaise: amount, kind: balance.kind, date, method, reference: reference.trim(), note: note.trim() }, me.id);
      toast.success(`Recorded ${formatPaise(amount)} from ${nameOf(balance.fromId)} to ${nameOf(balance.toId)}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't record the payment. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const quick = [
    { label: "Full balance", value: balance.remainingPaise },
    { label: "Half", value: Math.floor(balance.remainingPaise / 2) },
  ];

  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && !busy && onClose()} title={step === "form" ? "Record a payment" : "Confirm payment"} description={balance.kind === "dues" ? "Rent, fixed charges and meter dues" : "Expense settlement"}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-xl bg-muted p-3">
          <div className="flex items-center gap-2"><Avatar name={nameOf(balance.fromId)} /><div><p className="text-xs text-muted-foreground">Payer</p><p className="font-semibold">{nameOf(balance.fromId)}</p></div></div>
          <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
          <div className="flex items-center gap-2 text-right"><div><p className="text-xs text-muted-foreground">Recipient</p><p className="font-semibold">{nameOf(balance.toId)}</p></div><Avatar name={nameOf(balance.toId)} /></div>
        </div>

        <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Original outstanding</span><Money paise={balance.originalPaise} className="font-semibold" /></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Paid so far</span><Money paise={balance.paidPaise} className="font-semibold" /></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Remaining</span><Money paise={balance.remainingPaise} className="font-extrabold text-primary" /></div>
          <ProgressBar value={balance.originalPaise ? balance.paidPaise / balance.originalPaise : 0} />
        </div>

        {step === "form" ? (
          <>
            <div>
              <Label htmlFor="pay-amt">Amount (₹)</Label>
              <Input id="pay-amt" inputMode="decimal" className="num mt-1.5 h-12 text-xl font-bold" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-invalid={!!error} aria-describedby="pay-err" />
              <div className="mt-2 flex flex-wrap gap-2">
                {quick.map((q) => (
                  <Button key={q.label} type="button" variant="outline" size="sm" className="h-10" onClick={() => setAmountText(paiseToRupeesString(q.value))}>{q.label} · {formatPaise(q.value)}</Button>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setAmountText("")}>Custom</Button>
              </div>
              {error ? <p id="pay-err" className="mt-1.5 text-xs font-medium text-destructive" role="alert">{error}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label htmlFor="pay-date">Payment date</Label><Input id="pay-date" type="date" className="num mt-1.5 h-11" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div>
                <Label>Method</Label>
                <NativeSelect value={method} onChange={setMethod} options={["UPI", "Cash", "Bank transfer", "Other"]} className="mt-1.5" aria-label="Payment method" />
              </div>
            </div>
            {upi ? <p className="text-xs text-muted-foreground">{nameOf(balance.toId)}'s UPI: <span className="num font-medium text-foreground">{upi}</span></p> : null}
            <div><Label htmlFor="pay-ref">Reference / UTR (optional)</Label><Input id="pay-ref" className="mt-1.5 h-11" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            <div><Label htmlFor="pay-note">Notes (optional)</Label><Input id="pay-note" className="mt-1.5 h-11" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button className="bg-grad-primary h-11 w-full text-white" disabled={!!error} onClick={() => setStep("confirm")}>Review payment</Button>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-accent p-4 text-center">
              <p className="text-sm text-accent-foreground">{nameOf(balance.fromId)} paid {nameOf(balance.toId)}</p>
              <Money paise={amount ?? 0} className="text-3xl font-extrabold" />
              <p className="mt-1 text-xs text-muted-foreground">{method} · {date}{reference ? ` · ${reference}` : ""}</p>
              <p className="num mt-1 text-xs">Remaining after this: <Money paise={balance.remainingPaise - (amount ?? 0)} className="font-semibold" /></p>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />This is a manual record. It isn't verified by a bank or UPI provider. Mistakes are fixed with a reversal, not by deleting.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="h-11 flex-1" disabled={busy} onClick={() => setStep("form")}>Back</Button>
              <Button className="bg-grad-primary h-11 flex-1 text-white" disabled={busy} onClick={() => void submit()}>{busy ? <><Loader2 className="mr-2 size-4 animate-spin" />Recording…</> : "Confirm payment"}</Button>
            </div>
          </>
        )}
      </div>
    </ResponsiveSheet>
  );
}
