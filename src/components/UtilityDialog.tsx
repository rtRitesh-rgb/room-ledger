import { useEffect, useMemo, useState } from "react";
import { Flame, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money, ResponsiveSheet, cx } from "./kit";
import { useLedger } from "@/lib/data";
import { addRate, fetchLastReading, saveUtilityBill } from "@/lib/db";
import { formatMilli, formatPaise, paiseToRupeesString, parseMilli, parseRupees, splitEqual } from "@/lib/money";
import { Checkbox } from "@/components/ui/checkbox";
import { currentMonth, previewBill, resolveRate, type UtilityKind } from "@/lib/ledger";

export function UtilityDialog({ onClose }: { onClose: () => void }) {
  const { month, rates, roommates, me, monthDoc, isAdmin } = useLedger();
  const [kind, setKind] = useState<UtilityKind>("electricity");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [date, setDate] = useState(currentMonth() === month ? new Date().toISOString().slice(0, 10) : `${month}-01`);
  const [last, setLast] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateText, setRateText] = useState("");
  const [rateTouched, setRateTouched] = useState(false);
  const [saveRate, setSaveRate] = useState(false);

  useEffect(() => {
    let live = true;
    setStart("");
    setLast("");
    fetchLastReading(kind).then((r) => {
      if (!live || !r) return;
      setStart(formatMilli(r.endMilli));
      setLast(`Last reading ${formatMilli(r.endMilli)} on ${r.readingDate}`);
    }).catch(() => {});
    return () => { live = false; };
  }, [kind]);

  const rate = resolveRate(rates, kind, date.slice(0, 7));
  // The rate box follows the saved rate until you type in it; whatever is in the box is what this bill uses.
  useEffect(() => { if (!rateTouched) setRateText(paiseToRupeesString(rate.ratePaise)); }, [rate.ratePaise, rateTouched]);
  useEffect(() => { setRateTouched(false); setSaveRate(false); }, [kind]);
  const typedRate = parseRupees(rateText);
  const rateError = typedRate === null || typedRate <= 0 ? "Enter a price per unit above zero (up to 2 decimals)." : "";
  const usedRate = typedRate !== null && typedRate > 0 ? typedRate : rate.ratePaise;
  const rateChanged = usedRate !== rate.ratePaise;
  const s = parseMilli(start);
  const e = parseMilli(end);
  const prev = previewBill(s, e, usedRate);
  const ids = roommates.map((r) => r.id);
  const shares = useMemo(() => splitEqual(prev.amountPaise, ids), [prev.amountPaise, ids.join()]);
  const payerId = monthDoc?.managerId ?? me?.id ?? "";
  const showErr = submitted && prev.error;

  const submit = async () => {
    setSubmitted(true);
    if (rateError) return;
    if (prev.error || s === null || e === null || !me || !payerId || prev.unitsMilli <= 0) {
      if (!prev.error && prev.unitsMilli <= 0) toast.error("Units consumed must be more than zero.");
      return;
    }
    setBusy(true);
    try {
      await saveUtilityBill({ kind, startMilli: s, endMilli: e, unitsMilli: prev.unitsMilli, ratePaise: usedRate, amountPaise: prev.amountPaise, readingDate: date, payerId, shares }, me.id);
      if (saveRate && rateChanged && isAdmin) {
        try { await addRate({ kind, ratePaise: usedRate, effectiveMonth: date.slice(0, 7), note: "Set while recording a reading" }, me.id); }
        catch { toast.error("Bill saved, but the new default rate couldn't be saved. Set it in Household → Utility rates."); onClose(); return; }
      }
      toast.success(saveRate && rateChanged && isAdmin ? "Bill saved and new rate applied from this month" : "Bill saved and split between everyone");
      onClose();
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save the bill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && !busy && onClose()} title="Record utility reading" description="The price you use is locked into this bill. Later rate changes never alter it.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Utility type">
          {(["electricity", "gas"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("press flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold", kind === k ? "bg-card text-primary shadow-soft" : "text-muted-foreground")}>
              {k === "electricity" ? <Zap className="size-4" /> : <Flame className="size-4" />}{k === "electricity" ? "Electricity" : "Gas"}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="u-start">Previous reading</Label><Input id="u-start" inputMode="decimal" className="num mt-1.5 h-11" value={start} onChange={(x) => setStart(x.target.value)} />{last ? <p className="mt-1 text-xs text-muted-foreground">{last}</p> : null}</div>
          <div><Label htmlFor="u-end">Current reading</Label><Input id="u-end" inputMode="decimal" className="num mt-1.5 h-11" value={end} onChange={(x) => setEnd(x.target.value)} aria-invalid={!!showErr} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="u-date">Reading date</Label><Input id="u-date" type="date" className="num mt-1.5 h-11" value={date} onChange={(x) => setDate(x.target.value)} /></div>
          <div><Label htmlFor="u-rate">Price per unit (₹)</Label><Input id="u-rate" inputMode="decimal" className="num mt-1.5 h-11" value={rateText} onChange={(x) => { setRateText(x.target.value); setRateTouched(true); }} aria-invalid={!!(submitted && rateError)} />
            <p className="mt-1 text-xs text-muted-foreground">{rateChanged ? `Differs from the saved rate (${formatPaise(rate.ratePaise)}).` : rate.isDefault ? "Default rate." : `Saved rate, effective ${rate.effectiveMonth}.`}</p></div>
        </div>
        {rateChanged && isAdmin ? <label className="flex min-h-11 items-center gap-3 rounded-xl bg-muted p-3 text-sm font-medium"><Checkbox checked={saveRate} onCheckedChange={(c) => setSaveRate(c === true)} className="size-5" />Use this price for all future bills from {date.slice(0, 7)}</label> : rateChanged ? <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">This price applies to this bill only. Ask an admin to change the saved rate in Household → Utility rates.</p> : null}
        {submitted && rateError ? <p className="text-xs font-medium text-destructive" role="alert">{rateError}</p> : null}
        {showErr ? <p className="text-xs font-medium text-destructive" role="alert">{prev.error}</p> : null}

        <div className="num grid grid-cols-2 gap-3 rounded-xl bg-muted p-4 text-center sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Units</p><p className="font-bold">{formatMilli(prev.unitsMilli)}</p></div>
          <div><p className="text-xs text-muted-foreground">Rate / unit</p><p className="font-bold">{formatPaise(usedRate)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total bill</p><p className="font-bold text-primary"><Money paise={prev.amountPaise} /></p></div>
          <div><p className="text-xs text-muted-foreground">Each (of {ids.length})</p><p className="font-bold"><Money paise={Math.max(...Object.values(shares), 0)} /></p></div>
        </div>
        <p className="text-xs text-muted-foreground">
          Collected by the month's manager{payerId ? "" : " — set one in Household first"}. Remainder paise go to the first roommates in order so shares add up exactly.
        </p>
        <Button className="bg-grad-primary h-11 w-full text-white" disabled={busy || !payerId} onClick={() => void submit()}>
          {busy ? <><Loader2 className="mr-2 size-4 animate-spin" />Saving…</> : "Save bill"}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
