import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ExpenseForm } from "./ExpenseForm";
import { PaymentDialog } from "./PaymentDialog";
import { UtilityDialog } from "./UtilityDialog";
import type { Balance, Expense } from "@/lib/ledger";

type Open =
  | { type: "expense"; expense?: Expense }
  | { type: "utility" }
  | { type: "payment"; balance: Balance }
  | null;

type Api = {
  addExpense: () => void;
  editExpense: (e: Expense) => void;
  addUtility: () => void;
  pay: (b: Balance) => void;
};

const Ctx = createContext<Api | null>(null);

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const api = useMemo<Api>(
    () => ({
      addExpense: () => setOpen({ type: "expense" }),
      editExpense: (expense) => setOpen({ type: "expense", expense }),
      addUtility: () => setOpen({ type: "utility" }),
      pay: (balance) => setOpen({ type: "payment", balance }),
    }),
    [],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      {open?.type === "expense" ? <ExpenseForm key={open.expense?.id ?? "new"} {...(open.expense ? { expense: open.expense } : {})} onClose={close} /> : null}
      {open?.type === "utility" ? <UtilityDialog onClose={close} /> : null}
      {open?.type === "payment" ? <PaymentDialog balance={open.balance} onClose={close} /> : null}
    </Ctx.Provider>
  );
}

export function useDialogs(): Api {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDialogs must be used inside DialogsProvider");
  return v;
}
