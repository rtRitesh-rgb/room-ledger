import { useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Inbox, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLedger } from "@/lib/data";
import { formatPaise } from "@/lib/money";
import { currentMonth, isMonth, monthLabel, shiftMonth } from "@/lib/ledger";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Money({ paise, className, sign }: { paise: number; className?: string; sign?: boolean }) {
  return <span className={cx("num", className)}>{formatPaise(paise, { sign: sign ?? false })}</span>;
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export function ResponsiveSheet({
  open, onOpenChange, title, description, children,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  const mobile = useIsMobile();
  if (mobile)
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description ? <DrawerDescription>{description}</DrawerDescription> : null}
          </DrawerHeader>
          <div className="sheet-pad overflow-y-auto px-4">{children}</div>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Native <select> — opens the phone's own picker, which is the most reliable control on Android (also inside bottom sheets). */
export function NativeSelect({
  value, onChange, options, className, id, ...aria
}: { value: string; onChange: (v: string) => void; options: (string | { value: string; label: string })[]; className?: string; id?: string; "aria-label"?: string }) {
  return (
    <div className={cx("relative", className)}>
      <select id={id} aria-label={aria["aria-label"]} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full appearance-none rounded-md border border-input bg-card px-3 pr-9 text-base font-medium md:text-sm">
        {options.map((o) => { const v = typeof o === "string" ? o : o.value; return <option key={v} value={v}>{typeof o === "string" ? o : o.label}</option>; })}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" aria-hidden />
    </div>
  );
}

/** Month + year pickers built from native selects. (<input type="month"> doesn't exist in Firefox.) */
export function MonthField({ value, onChange, id }: { value: string; onChange: (m: string) => void; id?: string }) {
  const v = isMonth(value) ? value : currentMonth();
  const [y = "", m = "01"] = v.split("-");
  const nowY = Number(currentMonth().slice(0, 4));
  const years = [...new Set([nowY - 3, nowY - 2, nowY - 1, nowY, nowY + 1, nowY + 2, Number(y)])].sort();
  return (
    <div className="mt-1.5 grid grid-cols-[1fr_6.5rem] gap-2">
      <NativeSelect id={id ?? ""} aria-label="Month" value={m} onChange={(mm) => onChange(`${y}-${mm}`)} options={MONTHS.map((n, i) => ({ value: String(i + 1).padStart(2, "0"), label: n }))} />
      <NativeSelect aria-label="Year" value={y} onChange={(yy) => onChange(`${yy}-${m}`)} options={years.map(String)} />
    </div>
  );
}

export function MonthSwitcher({ className }: { className?: string }) {
  const { month, setMonth } = useLedger();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  return (
    <>
      <div className={cx("inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-soft", className)} role="group" aria-label="Month">
        <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="press grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"><ChevronLeft className="size-4" /></button>
        <button type="button" onClick={() => { setYear(Number(month.slice(0, 4))); setOpen(true); }} className="press flex h-11 min-w-0 items-center gap-1.5 px-2 text-sm font-semibold" aria-live="polite" aria-label={`${monthLabel(month)}. Change month`}>
          <CalendarDays className="size-4 shrink-0 opacity-70" aria-hidden /><span className="truncate">{monthLabel(month)}</span>
        </button>
        <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="press grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"><ChevronRight className="size-4" /></button>
      </div>
      <ResponsiveSheet open={open} onOpenChange={setOpen} title="Choose month">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" aria-label="Previous year" className="press grid size-11 place-items-center rounded-full border border-border" onClick={() => setYear((y) => y - 1)}><ChevronLeft className="size-4" /></button>
          <span className="num text-lg font-extrabold">{year}</span>
          <button type="button" aria-label="Next year" className="press grid size-11 place-items-center rounded-full border border-border" onClick={() => setYear((y) => y + 1)}><ChevronRight className="size-4" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((n, i) => { const val = `${year}-${String(i + 1).padStart(2, "0")}`; return (
            <button key={n} type="button" onClick={() => { setMonth(val); setOpen(false); }} className={cx("press h-12 rounded-xl border text-sm font-semibold", val === month ? "border-primary bg-primary/10 text-primary" : "border-border bg-card")}>{n}</button>
          ); })}
        </div>
      </ResponsiveSheet>
    </>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {action}
        <MonthSwitcher />
      </div>
    </header>
  );
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneCls = { default: "", success: "text-success", warning: "text-warning-foreground dark:text-warning", danger: "text-destructive" }[tone];
  return (
    <div className="tile p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cx("num mt-1 truncate text-xl font-extrabold", toneCls)}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatusBadge({ tone, children }: { tone: "ok" | "warn" | "danger" | "info" | "muted"; children: ReactNode }) {
  const cls = {
    ok: "bg-success/12 text-success", warn: "bg-warning/18 text-warning-foreground dark:text-warning", danger: "bg-destructive/12 text-destructive",
    info: "bg-primary/12 text-primary", muted: "bg-muted text-muted-foreground",
  }[tone];
  const Icon = tone === "ok" ? CheckCircle2 : tone === "danger" || tone === "warn" ? AlertTriangle : null;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>
      {Icon ? <Icon className="size-3" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground"><Inbox className="size-5" /></div>
      <p className="font-semibold">{title}</p>
      {body ? <p className="max-w-xs text-sm text-muted-foreground">{body}</p> : null}
      {action}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="grid place-items-center gap-2 py-16 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel grid place-items-center gap-3 p-8 text-center" role="alert">
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <p className="max-w-sm text-sm">{message}</p>
      <Button variant="outline" onClick={onRetry ?? (() => location.reload())}><RotateCcw className="mr-2 size-4" />Retry</Button>
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const hue = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 4;
  const bg = ["bg-primary/15 text-primary", "bg-mint/25 text-success", "bg-violet/15 text-violet", "bg-warning/20 text-warning-foreground dark:text-warning"][hue];
  return <span aria-hidden className={cx("grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold", bg, className)}>{name.slice(0, 1).toUpperCase()}</span>;
}

export function ProgressBar({ value, tone }: { value: number; tone?: "ok" | "low" | "over" | "unset" }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const bar = tone === "over" ? "bg-destructive" : tone === "low" ? "bg-warning" : "bg-grad-primary";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className={cx("h-full rounded-full transition-[width] duration-500", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
