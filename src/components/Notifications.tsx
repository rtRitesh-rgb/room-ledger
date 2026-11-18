import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, BellRing, CalendarClock, CheckCheck, HandCoins, Megaphone, Receipt, Trash2, Undo2, UserCog, Wallet, X, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ResponsiveSheet, cx } from "./kit";
import { useNotifications } from "@/lib/notify";
import { pushConfigured } from "@/lib/push";
import { useInstallPrompt } from "@/lib/pwa";
import type { AppNotification, NotifType } from "@/lib/notifications";

const ICONS: Record<NotifType, { icon: LucideIcon; tone: string }> = {
  nudge: { icon: Megaphone, tone: "bg-warning/20 text-warning-foreground dark:text-warning" },
  month_end: { icon: CalendarClock, tone: "bg-warning/20 text-warning-foreground dark:text-warning" },
  new_month: { icon: CalendarClock, tone: "bg-primary/15 text-primary" },
  expense: { icon: Receipt, tone: "bg-primary/15 text-primary" },
  payment: { icon: HandCoins, tone: "bg-success/20 text-success" },
  reversal: { icon: Undo2, tone: "bg-destructive/15 text-destructive" },
  bill: { icon: Zap, tone: "bg-primary/15 text-primary" },
  wallet: { icon: Wallet, tone: "bg-destructive/15 text-destructive" },
  manager: { icon: UserCog, tone: "bg-primary/15 text-primary" },
  test: { icon: BellRing, tone: "bg-success/20 text-success" },
};

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Bell button for the header / sidebar. Opens the notification centre. */
export function NotificationBell({ full }: { full?: boolean }) {
  const { unread } = useNotifications();
  const [open, setOpen] = useState(false);
  const badge = unread > 0 ? <span className="num absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white ring-2 ring-background">{unread > 9 ? "9+" : unread}</span> : null;
  return (
    <>
      {full ? (
        <Button type="button" variant="outline" onClick={() => setOpen(true)} className="relative h-11 w-full justify-start gap-2">
          {unread ? <BellRing className="size-4" /> : <Bell className="size-4" />}Notifications
          {unread > 0 ? <span className="num ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-white">{unread > 9 ? "9+" : unread}</span> : null}
        </Button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="press relative grid size-11 place-items-center rounded-full border border-border bg-card hover:bg-muted">
          {unread ? <BellRing className="size-4" /> : <Bell className="size-4" />}{badge}
        </button>
      )}
      {open ? <NotificationSheet onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function NotificationSheet({ onClose }: { onClose: () => void }) {
  const { items, unread, loaded, permission, enableAlerts, pushState, sendTest, read, readAll, remove, clearRead } = useNotifications();
  const navigate = useNavigate();
  const hasRead = items.some((n) => n.readAtMs);

  const go = (n: AppNotification) => {
    if (!n.readAtMs) read(n.id);
    onClose();
    const u = new URL(n.link || "/", "http://x");
    void navigate({ to: u.pathname as never, search: Object.fromEntries(u.searchParams) as never });
  };

  const turnOn = async () => {
    const r = await enableAlerts();
    if (r === "granted") toast.success("Alerts are on for this device");
    else if (r === "denied") toast.error("Alerts are blocked. Allow notifications for this site in your browser settings.");
    else toast("Alerts aren't available here", { description: "On iPhone, first tap Share → Add to Home Screen, then open the installed app." });
  };

  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && onClose()} title="Notifications" description={unread ? `${unread} unread` : "You're all caught up"}>
      <div className="space-y-3 pb-2">
        {permission === "granted" ? (
          <div className="flex items-center gap-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            <BellRing className="size-4 shrink-0 text-success" aria-hidden />
            <span className="flex-1">{pushState === "ok" ? "Alerts are on for this phone, even when the app is closed." : pushConfigured ? "Alerts are on while the app is open. Background push isn't active on this device yet." : "Alerts are on while the app is open."}</span>
            <Button size="sm" variant="outline" className="h-8" onClick={async () => { const r = await sendTest(); if (r === "blocked") toast.error("Couldn't send", { description: "Publish the latest firestore.rules in Firebase, then try again." }); else if (r === "failed") toast.error("Couldn't send the test. Check your connection."); }}>Send test</Button>
          </div>
        ) : null}
        {permission === "default" ? (
          <button type="button" onClick={() => void turnOn()} className="press flex w-full items-center gap-3 rounded-xl bg-accent p-3 text-left text-accent-foreground">
            <BellRing className="size-5 shrink-0" aria-hidden />
            <span className="text-sm"><b>Turn on device alerts</b><span className="block text-xs opacity-80">Get a pop-up when someone nudges you or a bill is added while the app is open or in the background.</span></span>
          </button>
        ) : permission === "denied" ? (
          <p className="rounded-xl bg-muted p-3 text-xs text-muted-foreground">Device alerts are blocked for this site. You'll still see everything here.</p>
        ) : null}

        {items.length > 0 ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-9 flex-1" disabled={!unread} onClick={readAll}><CheckCheck className="mr-1.5 size-4" />Mark all read</Button>
            <Button variant="ghost" size="sm" className="h-9" disabled={!hasRead} onClick={clearRead}><Trash2 className="mr-1.5 size-4" />Clear read</Button>
          </div>
        ) : null}

        {!loaded ? <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
          <div className="grid place-items-center gap-2 py-10 text-center text-muted-foreground">
            <Bell className="size-8" aria-hidden />
            <p className="text-sm font-semibold text-foreground">Nothing yet</p>
            <p className="max-w-xs text-xs">Nudges from roommates, month-end reminders and new bills or payments will show up here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((n) => {
              const { icon: Icon, tone } = ICONS[n.type] ?? ICONS.expense;
              return (
                <li key={n.id} className={cx("flex items-start gap-3 p-3", !n.readAtMs && "bg-primary/5")}>
                  <button type="button" onClick={() => go(n)} className="press flex min-w-0 flex-1 items-start gap-3 text-left">
                    <span className={cx("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", tone)}><Icon className="size-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className={cx("block text-sm", !n.readAtMs ? "font-bold" : "font-semibold")}>{n.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{n.body}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{ago(n.createdAtMs)}</span>
                    </span>
                    {!n.readAtMs ? <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                  </button>
                  <button type="button" aria-label="Dismiss notification" onClick={() => remove(n.id)} className="press grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><Trash2 className="size-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ResponsiveSheet>
  );
}

const DISMISS_KEY = "room-ledger-notif-prompt-dismissed";

/** Friendly banner at the top of the app that asks for notification access (browsers require a tap to show the permission pop-up). */
export function NotificationPrompt() {
  const { permission, enableAlerts } = useNotifications();
  const { iosHint } = useInstallPrompt();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < 7 * 24 * 3600 * 1000); } catch { setHidden(false); }
  }, []);
  if (hidden) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ } setHidden(true); };

  if (permission === "default")
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-3" role="region" aria-label="Turn on notifications">
        <span className="bg-grad-primary grid size-10 shrink-0 place-items-center rounded-full text-white"><BellRing className="size-5" aria-hidden /></span>
        <p className="min-w-0 flex-1 text-sm"><b>Get nudges and reminders</b><span className="block text-xs text-muted-foreground">Know when a roommate nudges you, pays you, or the month is ending.</span></p>
        <Button size="sm" className="h-9" onClick={async () => { const r = await enableAlerts(); if (r === "granted") { toast.success("Notifications are on"); setHidden(true); } else if (r === "denied") { toast.error("Blocked. Allow notifications for this app in your phone settings."); dismiss(); } }}>Turn on</Button>
        <button type="button" aria-label="Not now" onClick={dismiss} className="press grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
      </div>
    );
  if (permission === "unsupported" && iosHint)
    return (
      <div className="mb-4 flex items-center gap-3 rounded-2xl border border-border bg-muted p-3 text-xs text-muted-foreground" role="note">
        <BellRing className="size-5 shrink-0" aria-hidden />
        <p className="flex-1">To get notifications on iPhone: tap Share → <b>Add to Home Screen</b>, then open Room Ledger from your home screen.</p>
        <button type="button" aria-label="Dismiss" onClick={dismiss} className="press grid size-8 shrink-0 place-items-center rounded-full hover:bg-card"><X className="size-4" /></button>
      </div>
    );
  return null;
}
