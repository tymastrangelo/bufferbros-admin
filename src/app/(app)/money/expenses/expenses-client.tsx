"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconDownload } from "@/components/icons";
import { EmptyState, ErrorNote, Field, Sheet } from "@/components/ui";
import { deleteExpense, saveExpense } from "@/lib/actions/money";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import { EXPENSE_CATEGORIES, type Expense } from "@/lib/types";

export function ExpensesClient({ rows }: { rows: Expense[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("supplies");
  const [memo, setMemo] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [edit, setEdit] = useState<Expense | null>(null);

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
        <a className="btn btn-sm" href={`/api/export?type=expenses&from=2000-01-01&to=${todayYmd()}`}>
          <IconDownload width={14} height={14} /> CSV
        </a>
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
    </div>
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
