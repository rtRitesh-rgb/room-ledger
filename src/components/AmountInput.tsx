import { useRef, useState } from "react";
import { Calculator, Delete } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cx } from "./kit";
import { evalAmount, isExpression } from "@/lib/calc";
import { formatPaise } from "@/lib/money";

/** Flip the sign of the last number in the expression ("12+5" → "12+-5" → "12+5"). */
function toggleSign(t: string): string {
  const m = /^(.*?)(-?)(\d*\.?\d*)$/.exec(t);
  if (!m || m[3] === "") return t.endsWith("-") ? t.slice(0, -1) : `${t}-`;
  const [, head = "", neg = "", num = ""] = m;
  return neg ? `${head}${num}` : `${head}-${num}`;
}

const KEY = "press grid h-12 place-items-center rounded-xl text-lg font-semibold active:bg-primary/15";

/**
 * Amount field that accepts sums: type or tap 12+13.5+16 and the total shows underneath.
 * `value` is always the raw text; call `resolveAmountText(value)` (or evalAmount) when saving.
 */
export function AmountInput({
  value, onChange, id, className, invalid, label, placeholder = "0.00", compact, keypad = true,
}: {
  value: string; onChange: (v: string) => void; id?: string; className?: string; invalid?: boolean;
  label?: string; placeholder?: string; compact?: boolean; keypad?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const expr = isExpression(value);
  const total = expr ? evalAmount(value) : null;

  const press = (k: string) => {
    if (k === "back") return onChange(value.slice(0, -1));
    if (k === "clear") return onChange("");
    if (k === "sign") return onChange(toggleSign(value));
    if (k === "=") return total !== null && onChange((total / 100).toFixed(2));
    if (k === "." && /\d*\.\d*$/.test(value)) return; // one dot per number
    onChange(value + k);
  };

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const ops: [string, string][] = [["+", "+"], ["-", "−"], ["*", "×"], ["/", "÷"], [".", "."]];

  return (
    <div className={className}>
      <div className="relative">
        <Input
          ref={ref} id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          inputMode={open ? "none" : "decimal"} autoComplete="off" aria-invalid={invalid}
          className={cx("num h-11 pr-12 font-semibold", compact ? "text-base" : "text-lg")}
        />
        {keypad ? (
          <button type="button" aria-label={open ? "Hide calculator" : "Open calculator"} aria-expanded={open} onClick={() => { setOpen((o) => !o); if (!open) ref.current?.blur(); }}
            className={cx("press absolute right-1 top-1 grid size-9 place-items-center rounded-lg", open ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            <Calculator className="size-4" />
          </button>
        ) : null}
      </div>

      {expr ? (
        <p className="num mt-1 text-sm" aria-live="polite">
          {total !== null ? <>Total <strong className="text-primary">{formatPaise(total)}</strong></> : <span className="text-destructive">Finish the sum (e.g. 12+13.5+16)</span>}
        </p>
      ) : null}

      {open ? (
        <div className="pop mt-2 grid grid-cols-[1fr_3.25rem] gap-2 rounded-2xl border border-border bg-muted/50 p-2" role="group" aria-label="Calculator keypad">
          <div className="grid grid-cols-3 gap-1">
            {digits.map((d) => <button key={d} type="button" className={KEY} onClick={() => press(d)}>{d}</button>)}
            <button type="button" aria-label="Toggle minus sign" className={cx(KEY, "bg-primary text-sm text-primary-foreground")} onClick={() => press("sign")}>+/−</button>
            <button type="button" className={KEY} onClick={() => press("0")}>0</button>
            <button type="button" aria-label="Backspace" className={KEY} onClick={() => press("back")}><Delete className="size-5" /></button>
            <button type="button" className={cx(KEY, "text-sm text-muted-foreground")} onClick={() => press("clear")}>Clear</button>
            <button type="button" disabled={total === null || !expr} className={cx(KEY, "col-span-2 bg-grad-primary text-base text-white disabled:opacity-40")} onClick={() => press("=")}>
              {total !== null && expr ? `= ${formatPaise(total)}` : "="}
            </button>
          </div>
          <div className="flex flex-col justify-between rounded-2xl bg-card py-1 shadow-soft">
            {ops.map(([k, l]) => <button key={k} type="button" aria-label={`Operator ${l}`} className="press grid min-h-11 flex-1 place-items-center text-xl font-bold text-primary" onClick={() => press(k)}>{l}</button>)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
