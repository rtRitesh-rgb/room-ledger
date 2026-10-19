import { useMemo, useState } from "react";
import { Camera, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, Money, ResponsiveSheet, cx } from "./kit";
import { CategoryPicker } from "./CategoryPicker";
import { useLedger } from "@/lib/data";
import { deleteExpense, saveExpense } from "@/lib/db";
import { uploadReceipt } from "@/lib/receipts";
import { computeSplit, parseRupees, type SplitMode } from "@/lib/money";
import { currentMonth, type Expense } from "@/lib/ledger";

const MODES: { id: SplitMode; label: string; hint: string }[] = [
  { id: "equal", label: "Equal", hint: "Split evenly between the people you tick." },
  { id: "custom", label: "Amounts", hint: "Type each person's exact share in ₹." },
  { id: "percent", label: "Percent", hint: "Give each person a percentage; must total 100%." },
  { id: "personal", label: "Personal", hint: "Only for the payer. Doesn't create any debt." },
];

const today = () => new Date().toISOString().slice(0, 10);

export function ExpenseForm({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const { roommates, me, categories, month, nameOf } = useLedger();
  const order = useMemo(() => roommates.map((r) => r.id), [roommates]);

  const [name, setName] = useState(expense?.name ?? "");
  const [amountText, setAmountText] = useState(expense ? (expense.amountPaise / 100).toFixed(2) : "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [payerId, setPayerId] = useState(expense?.payerId ?? me?.id ?? order[0] ?? "");
  const [date, setDate] = useState(expense?.spentOn ?? (currentMonth() === month ? today() : `${month}-01`));
  const [mode, setMode] = useState<SplitMode>(expense?.splitMode ?? "equal");
  const [included, setIncluded] = useState<string[]>(expense && expense.splitMode === "equal" ? Object.keys(expense.shares) : order);
  const [raw, setRaw] = useState<Record<string, string>>(() => {
    if (!expense) return {};
    const o: Record<string, string> = {};
    for (const [rid, v] of Object.entries(expense.shares)) o[rid] = expense.splitMode === "percent" ? "" : (v / 100).toFixed(2);
    return o;
  });
  const [note, setNote] = useState(expense?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [keepReceipt, setKeepReceipt] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const total = parseRupees(amountText);
  const split = computeSplit({ mode, total: total ?? 0, order, payerId, included, raw });

  const fieldErrors = {
    name: name.trim() ? "" : "Give this expense a name.",
    amount: amountText.trim() === "" ? "Enter the amount." : total === null ? "Enter a valid amount (up to 2 decimals)." : total <= 0 ? "Amount must be greater than zero." : "",
    category: categoryId ? "" : "Choose a category.",
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? "" : "Pick a date.",
  };
  const splitErrorShown = total !== null && total > 0 && !split.ok;
  const valid = Object.values(fieldErrors).every((e) => !e) && split.ok;
  const show = (k: keyof typeof fieldErrors) => (submitted ? fieldErrors[k] : "");

  const onSubmit = async () => {
    setSubmitted(true);
    if (!valid || total === null || !me) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    setBusy(true);
    try {
      let receiptUrl = keepReceipt ? (expense?.receiptUrl ?? null) : null;
      if (file) receiptUrl = await uploadReceipt(file, date.slice(0, 7));
      await saveExpense(
        { name, amountPaise: total, categoryId, categoryLabel: cat.label, payerId, splitMode: mode, shares: split.shares, spentOn: date, receiptUrl, note },
        me.id,
        expense,
      );
      toast.success(expense ? "Expense updated" : "Expense saved");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!expense || !me) return;
    setBusy(true);
    try {
      await deleteExpense(expense, me.id);
      toast.success("Expense deleted and balances updated");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const err = (t: string) => (t ? <p className="mt-1 text-xs font-medium text-destructive" role="alert">{t}</p> : null);

  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && !busy && onClose()} title={expense ? "Edit expense" : "Add expense"} description={`Recorded in ${date.slice(0, 7)}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void onSubmit(); }} noValidate>
        <div>
          <Label htmlFor="exp-name">What was it for?</Label>
          <Input id="exp-name" className="mt-1.5 h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly vegetables" aria-invalid={!!show("name")} />
          {err(show("name"))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="exp-amount">Amount (₹)</Label>
            <Input id="exp-amount" inputMode="decimal" className="num mt-1.5 h-11 text-lg font-semibold" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" aria-invalid={!!show("amount")} />
            {err(show("amount"))}
          </div>
          <div>
            <Label htmlFor="exp-date">Date</Label>
            <Input id="exp-date" type="date" className="num mt-1.5 h-11" value={date} onChange={(e) => setDate(e.target.value)} />
            {err(show("date"))}
          </div>
        </div>

        <div>
          <Label htmlFor="exp-cat">Category</Label>
          <div className="mt-1.5"><CategoryPicker id="exp-cat" categories={categories} value={categoryId} onChange={setCategoryId} invalid={!!show("category")} /></div>
          {err(show("category"))}
        </div>

        <div>
          <Label>Paid by</Label>
          <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Paid by">
            {roommates.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={payerId === r.id} onClick={() => setPayerId(r.id)}
                className={cx("press flex h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium", payerId === r.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card")}>
                <Avatar name={r.name} className="size-6 text-xs" />{r.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>How is it split?</Label>
          <div className="mt-1.5 grid grid-cols-4 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Split method">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                className={cx("press h-10 rounded-lg text-sm font-semibold", mode === m.id ? "bg-card text-primary shadow-soft" : "text-muted-foreground")}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)?.hint}</p>

          {mode !== "personal" ? (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
              {roommates.map((r) => {
                const share = split.shares[r.id];
                return (
                  <li key={r.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                    {mode === "equal" ? (
                      <Checkbox id={`inc-${r.id}`} checked={included.includes(r.id)} onCheckedChange={(c) => setIncluded((cur) => (c ? [...cur, r.id] : cur.filter((x) => x !== r.id)))} className="size-5" />
                    ) : null}
                    <label htmlFor={mode === "equal" ? `inc-${r.id}` : `raw-${r.id}`} className="flex flex-1 items-center gap-2 text-sm font-medium">
                      <Avatar name={r.name} className="size-7 text-xs" />{r.name}
                    </label>
                    {mode === "equal" ? (
                      <Money paise={share ?? 0} className={cx("text-sm font-semibold", !share && "text-muted-foreground")} />
                    ) : (
                      <div className="w-32">
                        <Input id={`raw-${r.id}`} inputMode="decimal" className="num h-10 text-right" placeholder={mode === "percent" ? "0 %" : "₹ 0"} value={raw[r.id] ?? ""}
                          onChange={(e) => setRaw((cur) => ({ ...cur, [r.id]: e.target.value }))} aria-invalid={!!split.errors[r.id]} aria-describedby={`raw-err-${r.id}`} />
                        {mode === "percent" && share ? <p className="num mt-0.5 text-right text-xs text-muted-foreground"><Money paise={share} /></p> : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl border border-border bg-muted/50 p-3 text-sm">Only <strong>{nameOf(payerId)}</strong> bears this ₹ amount. It counts toward their Personal Vault but creates no debt.</p>
          )}
          {Object.entries(split.errors).filter(([k]) => k !== "_form").map(([k, v]) => (
            <p key={k} id={`raw-err-${k}`} className="mt-1 text-xs font-medium text-destructive" role="alert">{nameOf(k)}: {v}</p>
          ))}
          {splitErrorShown && split.errors["_form"] ? <p className="mt-2 text-xs font-medium text-destructive" role="alert">{split.errors["_form"]}</p> : null}
          {split.ok ? <p className="mt-2 text-xs font-medium text-success">Shares add up exactly to <Money paise={total ?? 0} />.</p> : null}
        </div>

        <div>
          <Label>Receipt (optional)</Label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <label className="press inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-4 text-sm font-medium hover:bg-muted">
              <Camera className="size-4" />{file ? "Change photo" : expense?.receiptUrl && keepReceipt ? "Replace photo" : "Add photo"}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setKeepReceipt(true); }} />
            </label>
            {file ? <span className="truncate text-xs text-muted-foreground">{file.name}</span> : null}
            {(file || (expense?.receiptUrl && keepReceipt)) ? (
              <button type="button" aria-label="Remove receipt" onClick={() => { setFile(null); setKeepReceipt(false); }} className="grid size-11 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
            ) : null}
          </div>
        </div>

        <div>
          <Label htmlFor="exp-note">Note (optional)</Label>
          <Input id="exp-note" className="mt-1.5 h-11" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-between">
          {expense ? (
            <Button type="button" variant="ghost" className="h-11 text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 className="mr-2 size-4" />Delete</Button>
          ) : <span />}
          <Button type="submit" className="bg-grad-primary h-11 px-6 text-white" disabled={busy}>
            {busy ? <><Loader2 className="mr-2 size-4 animate-spin" />Saving…</> : expense ? "Save changes" : "Save expense"}
          </Button>
        </div>
      </form>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
            <AlertDialogDescription>Everyone's balances and Personal Vaults will be recalculated. This is recorded in the audit log.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResponsiveSheet>
  );
}
