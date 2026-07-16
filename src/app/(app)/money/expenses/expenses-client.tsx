"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconDownload } from "@/components/icons";
import { EmptyState, ErrorNote, Field, Sheet } from "@/components/ui";
import { deleteExpense, deleteRecurring, saveExpense, saveRecurring } from "@/lib/actions/money";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import { EXPENSE_CATEGORIES, type Expense, type RecurringExpense } from "@/lib/types";

export function ExpensesClient({
  rows,
  recurring,
  due,
}: {
  rows: Expense[];
  recurring: RecurringExpense[];
  due: RecurringExpense[];
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("supplies");
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [edit, setEdit] = useState<Expense | null>(null);
  const [confirm, setConfirm] = useState<RecurringExpense | null>(null);
  const [recurringOpen, setRecurringOpen] = useState(false);

  const monthStart = `${todayYmd().slice(0, 7)}-01`;
  const thisMonth = rows.filter((r) => r.occurred_on >= monthStart).reduce((s, r) => s + r.amount, 0);

  async function quickAdd() {
    setError(null);
    setPending(true);
    const res = await saveExpense({ occurredOn: date, category, amount: Number(amount), memo });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setAmount("");
    setMemo("");
    router.refresh();
  }

  return (
    <div className="mt-4">
      {/* Recurring bills due — tap to confirm the real amount */}
      {due.length > 0 && (
        <div className="card p-3.5 mb-4 border-brand/40">
          <p className="label mb-2">Due this {due.some((d) => d.cadence === "yearly") ? "period" : "month"}</p>
          <div className="flex flex-col gap-1.5">
            {due.map((r) => (
              <button
                key={r.id}
                onClick={() => setConfirm(r)}
                className="flex items-center justify-between rounded-md px-3 py-2.5 bg-[#f8fafd] hover:bg-brand-wash text-left"
              >
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-sm num text-ink-2">
                  due day {r.due_day} · ~{money(r.expected_amount)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick add — thumb-first, no sheet needed */}
      <div className="card p-3.5">
        <p className="label mb-2">Quick add</p>
        <div className="grid grid-cols-2 md:grid-cols-[120px_1fr_140px_150px_auto] gap-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
            <input type="number" inputMode="decimal" min={0} className="input num pl-7" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
          </div>
          <input className="input" placeholder="What was it? (memo)" value={memo} onChange={(e) => setMemo(e.target.value)} aria-label="Memo" />
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
          <button className="btn btn-primary col-span-2 md:col-span-1" disabled={pending || !amount} onClick={quickAdd}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-sm text-ink-2">
          This month: <span className="num font-medium text-ink">{money(thisMonth)}</span>
        </p>
        <div className="flex gap-1.5">
          <button className="btn btn-sm" onClick={() => setRecurringOpen(true)}>
            Recurring{recurring.length > 0 ? ` (${recurring.length})` : ""}
          </button>
          <a className="btn btn-sm" href={`/api/export?type=expenses&from=2000-01-01&to=${todayYmd()}`}>
            <IconDownload width={14} height={14} /> CSV
          </a>
        </div>
      </div>

      <div className="mt-2 card overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="No expenses yet." hint="Log supplies, fuel, gear — anything the business spends. It feeds the net number on the overview." />
        ) : (
          <table className="tbl tbl-link tbl-stack min-w-[440px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Memo</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setEdit(r)}>
                  <td data-label="Date" className="num whitespace-nowrap">{fmtDateShort(r.occurred_on)}</td>
                  <td data-label="Category" className="capitalize">{r.category}</td>
                  <td data-label="Memo" className="text-ink-2 max-w-[240px] truncate">{r.memo}</td>
                  <td data-label="Amount" className="num text-right font-medium">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && <ExpenseEditSheet expense={edit} onClose={() => setEdit(null)} />}
      {confirm && <ConfirmDueSheet item={confirm} onClose={() => setConfirm(null)} />}
      {recurringOpen && <RecurringSheet items={recurring} onClose={() => setRecurringOpen(false)} />}
    </div>
  );
}

function ConfirmDueSheet({ item, onClose }: { item: RecurringExpense; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(item.expected_amount ? String(item.expected_amount) : "");
  const [date, setDate] = useState(todayYmd());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet open onClose={onClose} title={`Post ${item.name}`}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Actual amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" min={0} className="input num pl-7" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          </Field>
          <Field label="Date">
            <input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending || !amount}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await saveExpense({
              occurredOn: date,
              category: item.category,
              amount: Number(amount),
              memo: item.name,
              recurringId: item.id,
            });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Posting…" : "Post expense"}
        </button>
      </div>
    </Sheet>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function RecurringSheet({ items, onClose }: { items: RecurringExpense[]; onClose: () => void }) {
  const [mode, setMode] = useState<RecurringExpense | "new" | null>(null);

  if (mode) {
    return <RecurringForm item={mode === "new" ? null : mode} onBack={() => setMode(null)} onClose={onClose} />;
  }
  return (
    <Sheet open onClose={onClose} title="Recurring expenses">
      <div className="flex flex-col gap-3">
        <button className="btn btn-primary" onClick={() => setMode("new")}>
          Add recurring
        </button>
        <div className="flex flex-col divide-y divide-line border border-line rounded-md overflow-hidden">
          {items.length === 0 && <p className="px-3 py-3 text-sm text-faint bg-card">Nothing recurring yet — add the Supabase bill.</p>}
          {items.map((r) => (
            <button
              key={r.id}
              onClick={() => setMode(r)}
              className={`flex items-center justify-between gap-3 px-3 py-2.5 bg-card text-left hover:bg-[#f8fafd] ${r.active ? "" : "opacity-50"}`}
            >
              <span className="text-sm font-medium">
                {r.name}
                {!r.active && <span className="text-faint font-normal"> · paused</span>}
              </span>
              <span className="text-xs num text-ink-2 shrink-0">
                {r.cadence === "monthly" ? `monthly · day ${r.due_day}` : `yearly · ${MONTHS[(r.due_month ?? 1) - 1]} ${r.due_day}`} · ~
                {money(r.expected_amount)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

function RecurringForm({ item, onBack, onClose }: { item: RecurringExpense | null; onBack: () => void; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "other");
  const [expected, setExpected] = useState(item ? String(item.expected_amount) : "");
  const [cadence, setCadence] = useState<"monthly" | "yearly">(item?.cadence ?? "monthly");
  const [dueDay, setDueDay] = useState(String(item?.due_day ?? 1));
  const [dueMonth, setDueMonth] = useState(String(item?.due_month ?? 1));
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet open onClose={onClose} title={item ? `Edit ${item.name}` : "New recurring expense"}>
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input className="input" placeholder="Supabase" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" min={0} className="input num pl-7" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </div>
          </Field>
          <Field label="Category">
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Repeats">
            <select className="select" value={cadence} onChange={(e) => setCadence(e.target.value as "monthly" | "yearly")}>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
            </select>
          </Field>
          {cadence === "yearly" ? (
            <Field label="Month">
              <select className="select" value={dueMonth} onChange={(e) => setDueMonth(e.target.value)}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Day of month">
              <input type="number" min={1} max={31} className="input num" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            </Field>
          )}
        </div>
        {cadence === "yearly" && (
          <Field label="Day of month">
            <input type="number" min={1} max={31} className="input num" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active — shows in the due list
        </label>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending || !name.trim()}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await saveRecurring(
              {
                name,
                category,
                expectedAmount: Number(expected) || 0,
                cadence,
                dueDay: Math.min(31, Math.max(1, Number(dueDay) || 1)),
                dueMonth: cadence === "yearly" ? Number(dueMonth) || 1 : null,
                active,
              },
              item?.id
            );
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <div className="flex gap-2">
          <button className="btn grow" disabled={pending} onClick={onBack}>
            Back
          </button>
          {item && (
            <button
              className="btn btn-danger grow"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                await deleteRecurring(item.id);
                onClose();
                router.refresh();
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function ExpenseEditSheet({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(expense.amount));
  const [category, setCategory] = useState(expense.category);
  const [memo, setMemo] = useState(expense.memo ?? "");
  const [date, setDate] = useState(expense.occurred_on);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet open onClose={onClose} title="Edit expense">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" min={0} className="input num pl-7" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </Field>
          <Field label="Date">
            <input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Category">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Memo">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await saveExpense({ occurredOn: date, category, amount: Number(amount), memo }, expense.id);
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          className="btn btn-danger"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            await deleteExpense(expense.id);
            onClose();
            router.refresh();
          }}
        >
          Delete expense
        </button>
      </div>
    </Sheet>
  );
}
