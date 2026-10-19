import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "./firebase";
import { C } from "./db";

type Status = "loading" | "signed-out" | "unclaimed" | "ready";

type SessionValue = {
  status: Status;
  user: User | null;
  /** Roommate id linked to this Firebase account. */
  roommateId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionValue>({
  status: "loading", user: null, roommateId: null,
  signIn: async () => {}, signOut: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [roommateId, setRoommateId] = useState<string | null>(null);
  const [memberReady, setMemberReady] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
        if (!u) {
          setRoommateId(null);
          setMemberReady(false);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, C.members, user.uid),
      (snap) => {
        setRoommateId(snap.exists() ? ((snap.data() as { roommateId?: string }).roommateId ?? null) : null);
        setMemberReady(true);
      },
      () => setMemberReady(true),
    );
  }, [user]);

  const value = useMemo<SessionValue>(() => {
    const status: Status = !authReady ? "loading" : !user ? "signed-out" : !memberReady ? "loading" : roommateId ? "ready" : "unclaimed";
    return {
      status, user, roommateId,
      signIn: async (email, password) => {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      },
      signOut: () => fbSignOut(auth),
    };
  }, [authReady, user, memberReady, roommateId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
