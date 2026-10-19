import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { collection, getDocs } from "firebase/firestore";
import { Home, Receipt, HandCoins, Users, Plus, Sun, Moon, Monitor, LogOut, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, ErrorBlock, cx } from "./kit";
import { DialogsProvider, useDialogs } from "./dialogs";
import { LedgerProvider, useLedger } from "@/lib/data";
import { C, claimRoommate, fromDoc } from "@/lib/db";
import { db, firebaseConfigured } from "@/lib/firebase";
import { SessionProvider, useSession } from "@/lib/session";
import { useTheme, type ThemePref } from "@/lib/theme";
import type { Roommate } from "@/lib/ledger";

const NAV = [
  { to: "/", label: "Home", icon: Home },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/settlement", label: "Settle Up", icon: HandCoins },
  { to: "/household", label: "Household", icon: Users },
] as const;

export function ThemeToggle({ full }: { full?: boolean }) {
  const { pref, set } = useTheme();
  const opts: { id: ThemePref; icon: typeof Sun; label: string }[] = [
    { id: "light", icon: Sun, label: "Light" }, { id: "dark", icon: Moon, label: "Dark" }, { id: "system", icon: Monitor, label: "System" },
  ];
  if (full)
    return (
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Theme">
        {opts.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={pref === o.id} onClick={() => set(o.id)} className={cx("press flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold", pref === o.id ? "bg-card text-primary shadow-soft" : "text-muted-foreground")}>
            <o.icon className="size-4" />{o.label}
          </button>
        ))}
      </div>
    );
  const next = pref === "light" ? "dark" : pref === "dark" ? "system" : "light";
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  return (
    <button type="button" onClick={() => set(next)} aria-label={`Theme: ${pref}. Switch to ${next}`} className="press grid size-11 place-items-center rounded-full border border-border bg-card hover:bg-muted">
      <Icon className="size-4" />
    </button>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-extrabold tracking-tight">
      <span className="bg-grad-primary grid size-9 place-items-center rounded-xl text-white shadow-lift"><Wallet className="size-5" aria-hidden /></span>
      Room Ledger
    </Link>
  );
}

function Splash({ text = "Loading…" }: { text?: string }) {
  return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status"><span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{text}</span></div>;
}

function LoginScreen() {
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="bg-grad-decor grid min-h-dvh place-items-center px-4">
      <form className="panel fade-in w-full max-w-sm space-y-4 p-6" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setError("");
        try { await signIn(email, password); } catch { setError("Email or password is incorrect."); } finally { setBusy(false); }
      }}>
        <Brand />
        <div><h1 className="text-xl font-extrabold">Welcome back</h1><p className="text-sm text-muted-foreground">Sign in with the account your household set up for you.</p></div>
        <div><Label htmlFor="em">Email</Label><Input id="em" type="email" autoComplete="email" className="mt-1.5 h-11" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><Label htmlFor="pw">Password</Label><Input id="pw" type="password" autoComplete="current-password" className="mt-1.5 h-11" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error ? <p className="text-sm font-medium text-destructive" role="alert">{error}</p> : null}
        <Button type="submit" className="bg-grad-primary h-11 w-full text-white" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
    </div>
  );
}

function ClaimScreen() {
  const { user, signOut } = useSession();
  const [people, setPeople] = useState<Roommate[] | null>(null);
  const [busy, setBusy] = useState("");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    getDocs(collection(db, C.roommates)).then((s) => setPeople(s.docs.map((d) => fromDoc<Roommate>(d)).sort((a, b) => a.order - b.order))).catch((e: Error) => { setLoadError(e.message); setPeople([]); });
  }, []);
  return (
    <div className="bg-grad-decor grid min-h-dvh place-items-center px-4">
      <div className="panel fade-in w-full max-w-sm space-y-4 p-6">
        <Brand />
        <div><h1 className="text-xl font-extrabold">Which roommate are you?</h1><p className="text-sm text-muted-foreground">One-time step. This links {user?.email} to your ledger profile.</p></div>
        {people === null ? <Splash /> : (
          <ul className="space-y-2">
            {people.filter((p) => !p.authUid).map((p) => (
              <li key={p.id}>
                <button type="button" disabled={!!busy} className="press flex h-14 w-full items-center gap-3 rounded-xl border border-border px-3 text-left font-semibold hover:bg-muted" onClick={async () => {
                  setBusy(p.id);
                  try { await claimRoommate(user!.uid, p.id); } catch (e) { toast.error((e as Error).message); setBusy(""); }
                }}><Avatar name={p.name} />{p.name}{busy === p.id ? <Loader2 className="ml-auto size-4 animate-spin" /> : null}</button>
              </li>
            ))}
            {loadError ? <p className="text-sm font-medium text-destructive" role="alert">Couldn't read roommate profiles: {loadError}. Publish firestore.rules in the Firebase console (Firestore → Rules), then reload.</p>
              : people.length === 0 ? <p className="text-sm text-muted-foreground">No roommate profiles exist in Firestore yet. Run the import (npm run migrate, step 3 in SETUP.md), then reload this page.</p>
              : people.every((p) => p.authUid) ? <p className="text-sm text-muted-foreground">All profiles are already linked. Ask an admin to unlink yours in the Firebase console.</p> : null}
          </ul>
        )}
        <Button variant="ghost" className="w-full" onClick={() => void signOut()}>Use a different account</Button>
      </div>
    </div>
  );
}

function AppFrame({ children }: { children: ReactNode }) {
  const { me, error } = useLedger();
  const { signOut } = useSession();
  const { addExpense } = useDialogs();
  return (
    <div className="min-h-dvh md:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border bg-sidebar p-4 md:flex">
        <Brand />
        <Button onClick={addExpense} className="bg-grad-primary mt-6 h-11 justify-start gap-2 text-white"><Plus className="size-4" />Add expense</Button>
        <nav className="mt-5 grid gap-1" aria-label="Primary">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }} className="press flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-muted-foreground hover:bg-muted" activeProps={{ className: "bg-grad-primary !text-white shadow-lift hover:!bg-transparent" }}>
              <n.icon className="size-4" aria-hidden />{n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <ThemeToggle full />
          <div className="flex items-center gap-2"><Avatar name={me?.name ?? "?"} /><span className="flex-1 truncate text-sm font-semibold">{me?.name}</span>
            <button type="button" aria-label="Sign out" onClick={() => void signOut()} className="grid size-11 place-items-center rounded-full hover:bg-muted"><LogOut className="size-4" /></button></div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/90 px-4 py-2 backdrop-blur md:hidden">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 pb-32 pt-5 md:px-8 md:pb-10 md:pt-8">
        {error ? <ErrorBlock message={`Couldn't load data: ${error}`} /> : children}
      </main>

      <button type="button" onClick={addExpense} aria-label="Add expense" className="bg-grad-primary press fixed right-4 z-40 flex h-14 items-center gap-2 rounded-full px-5 font-bold text-white shadow-lift md:hidden" style={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}>
        <Plus className="size-5" />Add
      </button>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-card/95 backdrop-blur md:hidden" aria-label="Primary">
        {NAV.map((n) => (
          <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }} className="press flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground" activeProps={{ className: "!text-primary" }}>
            <n.icon className="size-5" aria-hidden />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function AppGate({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Splash />;
  if (!firebaseConfigured)
    return <div className="grid min-h-dvh place-items-center p-6"><div className="panel max-w-md p-6"><h1 className="text-lg font-extrabold">Firebase isn't configured</h1><p className="mt-2 text-sm text-muted-foreground">Copy <code>.env.example</code> to <code>.env</code> and fill in your Firebase web-app values (see SETUP.md), then restart.</p></div></div>;
  return <SessionProvider><Inner>{children}</Inner></SessionProvider>;
}

function Inner({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading") return <Splash />;
  if (status === "signed-out") return <LoginScreen />;
  if (status === "unclaimed") return <ClaimScreen />;
  return (
    <LedgerProvider>
      <DialogsProvider>
        <AppFrame>{children}</AppFrame>
      </DialogsProvider>
    </LedgerProvider>
  );
}
