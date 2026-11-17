import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { ProgressBar, cx } from "./kit";
import { useLedger } from "@/lib/data";
import { dailyLimit, todayISO, vaultSummary } from "@/lib/ledger";
import { formatPaise } from "@/lib/money";

const PREF = "room-ledger-limit-fixed";

/** Remembers (per device) whether rent & fixed charges count towards the daily limit. */
export function useIncludeFixed(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(false);
  useEffect(() => { try { setV(localStorage.getItem(PREF) === "1"); } catch { /* storage unavailable */ } }, []);
  return [v, (n) => { setV(n); try { localStorage.setItem(PREF, n ? "1" : "0"); } catch { /* ignore */ } }];
}

/** Private to the signed-in person: month budget ÷ days, with today's spending against it. */
export function DailyLimitCard({ onDark, className }: { onDark?: boolean; className?: string }) {
  const { me, month, allocations, wallet, settings } = useLedger();
  const [incFixed, setIncFixed] = useIncludeFixed();
  if (!me) return null;
  const v = vaultSummary(me.id, month, allocations, wallet, settings.carryForward);
  const d = dailyLimit(v, wallet.filter((w) => w.roommateId === me.id), month, todayISO(), incFixed);
  const muted = onDark ? "text-white/70" : "text-muted-foreground";
  const tone = d.status === "over" ? "over" : d.status === "near" ? "low" : "ok";
  const label = !d.isCurrent ? (d.dayNo === 0 ? "Month not started" : "Month finished") : d.status === "unset" ? "Set your monthly wallet" : d.leftToday < 0 ? "Over today's limit" : d.status === "near" ? "Almost at today's limit" : "Left to spend today";
  const used = d.allowanceToday > 0 ? d.spentToday / d.allowanceToday : d.spentToday > 0 ? 1 : 0;
  const fixedCut = v.available - d.budget;

  return (
    <section className={cx(!onDark && "panel p-4", className)} aria-label="Daily spending limit">
      <div className="flex items-center justify-between gap-2">
        <h2 className={cx("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", onDark ? "text-white/70" : "text-muted-foreground")}><Lock className="size-3" aria-hidden />Daily limit · only you</h2>
        <button type="button" role="switch" aria-checked={incFixed} onClick={() => setIncFixed(!incFixed)} className={cx("press h-8 rounded-full border px-2.5 text-[11px] font-semibold", onDark ? "border-white/25 text-white/85" : "border-border text-muted-foreground")}>{incFixed ? "Rent included" : "Rent excluded"}</button>
      </div>
      <p className={cx("num mt-1 text-3xl font-extrabold", d.leftToday < 0 && d.isCurrent && (onDark ? "text-[#ffb4c2]" : "text-destructive"))} aria-live="polite">{d.status === "unset" ? "—" : formatPaise(d.isCurrent ? d.leftToday : d.perDay)}</p>
      <p className={cx("text-xs", muted)}>{label}</p>
      <div className="mt-2.5"><ProgressBar value={used} tone={tone} /></div>
      <dl className={cx("num mt-2.5 grid grid-cols-3 gap-2 text-center text-[11px]", muted)}>
        <div><dt>Limit / day</dt><dd className={cx("mt-0.5 text-sm font-bold", onDark ? "text-white" : "text-foreground")}>{formatPaise(d.perDay)}</dd></div>
        <div><dt>Spent today</dt><dd className={cx("mt-0.5 text-sm font-bold", onDark ? "text-white" : "text-foreground")}>{formatPaise(d.spentToday)}</dd></div>
        <div><dt>Days left</dt><dd className={cx("mt-0.5 text-sm font-bold", onDark ? "text-white" : "text-foreground")}>{d.daysLeft}</dd></div>
      </dl>
      <p className={cx("num mt-2 text-[11px]", muted)}>
        {formatPaise(d.budget)} ÷ {d.days} days{fixedCut > 0 ? ` (after ${formatPaise(fixedCut)} rent & fixed)` : ""}. Re-spread daily: {formatPaise(d.allowanceToday)} today.
      </p>
    </section>
  );
}

