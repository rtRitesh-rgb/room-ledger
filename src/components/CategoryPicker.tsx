import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { CATEGORY_GROUPS, type Category } from "@/lib/categories";
import { categoryIcon } from "./category-icons";

export function CategoryChip({ category, className }: { category: Pick<Category, "icon" | "color">; className?: string }) {
  const Icon = categoryIcon(category.icon);
  return (
    <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${className ?? ""}`} style={{ background: `${category.color}1f`, color: category.color }} aria-hidden>
      <Icon className="size-5" />
    </span>
  );
}

export function CategoryPicker({ categories, value, onChange, id, invalid }: { categories: Category[]; value: string; onChange: (id: string) => void; id?: string; invalid?: boolean }) {
  // Inline list (not a popover): popovers inside bottom sheets lose touch scrolling on Android.
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const active = categories.filter((c) => c.active || c.id === value);
  const selected = categories.find((c) => c.id === value);
  const term = q.trim().toLowerCase();
  const matches = (c: Category) => !term || `${c.label} ${c.group}`.toLowerCase().includes(term);
  const groups = [...new Set([...CATEGORY_GROUPS, ...active.map((c) => c.group)])];
  const pick = (c: Category) => { onChange(c.id); setOpen(false); setQ(""); };

  const item = (c: Category, key: string) => (
    <li key={key}>
      <button type="button" onClick={() => pick(c)} className="press flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left text-sm font-medium hover:bg-muted">
        <CategoryChip category={c} className="!size-8 rounded-lg" /><span className="flex-1">{c.label}</span>{c.id === value ? <Check className="size-4 text-primary" aria-label="Selected" /> : null}
      </button>
    </li>
  );
  const heading = (t: string) => <p className="px-2 pb-1 pt-3 text-xs font-semibold text-muted-foreground">{t}</p>;
  const popular = active.filter((c) => c.popular && matches(c));

  return (
    <div>
      <button id={id} type="button" aria-expanded={open} aria-invalid={invalid} onClick={() => setOpen((o) => !o)} className="press flex h-11 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-sm">
        {selected ? <span className="flex items-center gap-2"><CategoryChip category={selected} className="!size-6 rounded-md" />{selected.label}</span> : <span className="text-muted-foreground">Choose a category</span>}
        <ChevronsUpDown className="size-4 opacity-50" aria-hidden />
      </button>
      {open ? (
        <div className="fade-in mt-2 rounded-xl border border-border bg-card p-2">
          <div className="relative"><Search className="absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden /><input aria-label="Search categories" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search categories…" className="h-11 w-full rounded-md border border-input bg-background pl-9 pr-3" /></div>
          <div className="mt-1 max-h-64 overflow-y-auto overscroll-contain">
            {!term && popular.length ? <>{heading("Popular")}<ul>{popular.map((c) => item(c, `p-${c.id}`))}</ul></> : null}
            {groups.map((g) => { const rows = active.filter((c) => c.group === g && matches(c) && (term || !c.popular)); return rows.length ? <div key={g}>{heading(g)}<ul>{rows.map((c) => item(c, `${g}-${c.id}`))}</ul></div> : null; })}
            {active.filter(matches).length === 0 ? <p className="p-4 text-center text-sm text-muted-foreground">No category found.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
