import { useEffect, useState } from "react";
import { Info, Lock } from "lucide-react";
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
  const [info, setInfo] = useState(false);
  if (!me) return null;
  const v = vaultSummary(me.id, month, allocations, wallet, settings.carryForward);
  const d = dailyLimit(v, wallet.filter((w) => w.roommateId === me.id), month, todayISO(), incFixed);
  const muted = onDark ? "text-white/70" : "text-muted-foreground";
  const strong = onDark ? "text-white" : "text-foreground";
  const tone = d.status === "over" ? "over" : d.status === "near" ? "low" : "ok";
  const label = !d.isCurrent ? (d.dayNo === 0 ? "Month not started" : "Month finished") : d.status === "unset" ? "Set your monthly wallet" : d.leftToday < 0 ? "Over today's limit" : d.status === "near" ? "Almost at today's limit" : "Left to spend today";
  const used = d.allowanceToday > 0 ? d.spentToday / d.allowanceToday : d.spentToday > 0 ? 1 : 0;
  const pct = Math.round(Math.min(used, 9.99) * 100);
  const fixedCut = v.available - d.budget;
  // What is still spendable this month, shared out over the days that remain (today included).
  const pool = d.budget - (d.spentMonth - d.spentToday);

  return (
    <section className={cx(!onDark && "panel p-4", className)} aria-label="Daily spending limit">
      <div className="flex items-center justify-between gap-2">
        <h2 className={cx("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider", muted)}><Lock className="size-3" aria-hidden />Daily limit · only you</h2>
        <button
          type="button"
          role="switch"
          aria-checked={incFixed}
          aria-label="Count rent and fixed charges in the daily limit"
          onClick={() => setIncFixed(!incFixed)}
          className={cx("press flex h-8 items-center gap-2 rounded-full border pl-2.5 pr-1.5 text-[11px] font-semibold", onDark ? "border-white/25 text-white/85" : "border-border text-muted-foreground")}
        >
          {incFixed ? "Rent included" : "Rent excluded"}
          <span aria-hidden className={cx("relative h-4 w-7 rounded-full transition-colors", incFixed ? "bg-primary" : onDark ? "bg-white/25" : "bg-muted-foreground/30")}>
            <span className={cx("absolute top-0.5 size-3 rounded-full bg-white shadow transition-[left]", incFixed ? "left-[0.875rem]" : "left-0.5")} />
          </span>
        </button>
      </div>
      <p className={cx("num mt-1 text-3xl font-extrabold", d.leftToday < 0 && d.isCurrent && (onDark ? "text-[#ffb4c2]" : "text-destructive"))} aria-live="polite">{d.status === "unset" ? "—" : formatPaise(d.isCurrent ? d.leftToday : d.perDay)}</p>
      <div className={cx("flex items-center justify-between gap-2 text-xs", muted)}>
        <span>{label}</span>
        {d.isCurrent && d.status !== "unset" ? <span className="num font-semibold">{pct}% used</span> : null}
      </div>
      <div className="mt-2 "><ProgressBar value={used} tone={tone} /></div>
      <dl className={cx("num mt-3 grid grid-cols-3 gap-2 text-center text-[11px]", muted)}>
        <div><dt>Today's limit</dt><dd className={cx("mt-0.5 text-sm font-bold", strong)}>{formatPaise(d.allowanceToday)}</dd></div>
        <div><dt>Spent today</dt><dd className={cx("mt-0.5 text-sm font-bold", strong)}>{formatPaise(d.spentToday)}</dd></div>
        <div><dt>Days left</dt><dd className={cx("mt-0.5 text-sm font-bold", strong)}>{d.daysLeft}</dd></div>
      </dl>
      {d.isCurrent && d.status !== "unset" ? (
        <div className="mt-2">
          <button type="button" aria-expanded={info} onClick={() => setInfo(!info)} className={cx("press -ml-1 flex h-8 items-center gap-1.5 rounded-lg px-1 text-[11px] font-semibold", onDark ? "text-white/80" : "text-primary")}>
            <Info className="size-3.5" aria-hidden />How is this worked out?
          </button>
          {info ? (
            <p className={cx("num mt-1 text-[11px] leading-relaxed", muted)}>
              Today's limit = {formatPaise(Math.max(pool, 0))} still to spend this month ÷ {d.daysLeft} days left. Month budget is {formatPaise(d.budget)}{fixedCut > 0 ? ` (your ${formatPaise(v.available)} wallet minus ${formatPaise(fixedCut)} rent & fixed)` : ""}, planned at {formatPaise(d.perDay)} a day. Spend less today and tomorrow's limit grows; spend more and it shrinks.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
