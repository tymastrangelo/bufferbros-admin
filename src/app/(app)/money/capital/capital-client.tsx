"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState, ErrorNote, Field, Sheet } from "@/components/ui";
import { addCapital, deleteCompanyEntry, updateCompanyEntry } from "@/lib/actions/money";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import type { CompanyLedgerEntry } from "@/lib/types";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "payout", label: "Payouts" },
  { id: "gabe", label: "Gabe" },
  { id: "ceo", label: "CEO" },
  { id: "capital", label: "Capital" },
  { id: "expense", label: "Expenses" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

function label(e: CompanyLedgerEntry) {
  if (e.kind === "revenue") return `Payment — ${e.memo ?? "customer"}`;
  if (e.kind === "payout") return `Payout — ${e.party === "gabe" ? "Gabe" : "CEO"}${e.memo ? ` · ${e.memo}` : ""}`;
  if (e.kind === "expense") return e.memo ?? "Expense";
  return e.memo ? `Capital — ${e.memo}` : "Capital added";
}

export function CapitalClient({ rows, balance }: { rows: CompanyLedgerEntry[]; balance: number }) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [addOpen, setAddOpen] = useState(false);
  const [edit, setEdit] = useState<CompanyLedgerEntry | null>(null);

  const shown = rows.filter((e) => {
    if (filter === "all") return true;
    if (filter === "gabe" || filter === "ceo") return e.kind === "payout" && e.party === filter;
    return e.kind === filter;
  });

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="card p-3.5 flex items-center justify-between gap-3">
        <div>
          <p className="label">Company capital</p>
          <p className={`mt-1 text-2xl font-bold num ${balance < 0 ? "text-bad" : ""}`}>{money(balance)}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          Add money
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`btn btn-sm whitespace-nowrap ${filter === f.id ? "btn-primary" : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        {shown.length === 0 ? (
          <EmptyState
            title="Nothing here yet."
            hint="Payments split in automatically as they land. Add money to seed what the company already has."
          />
        ) : (
          <table className="tbl tbl-link tbl-stack min-w-[440px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} onClick={() => (e.kind === "capital" || e.kind === "payout") && setEdit(e)}>
                  <td data-label="Date" className="num whitespace-nowrap">
                    {fmtDateShort(e.occurred_on)}
                  </td>
                  <td data-label="What" className="max-w-[280px] truncate">
                    {label(e)}
                  </td>
                  <td data-label="Amount" className={`num text-right font-medium ${e.amount >= 0 ? "text-ok" : ""}`}>
                    {e.amount < 0 ? `−${money(-e.amount)}` : `+${money(e.amount)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && <AddMoneySheet onClose={() => setAddOpen(false)} />}
      {edit && <EditEntrySheet entry={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function AddMoneySheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet open onClose={onClose} title="Add money">
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
        <Field label="Memo">
          <input className="input" placeholder="Where's it from?" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending || !amount}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await addCapital({ occurredOn: date, amount: Number(amount), memo });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Adding…" : "Add to capital"}
        </button>
      </div>
    </Sheet>
  );
}

function EditEntrySheet({ entry, onClose }: { entry: CompanyLedgerEntry; onClose: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(Math.abs(entry.amount)));
  const [date, setDate] = useState(entry.occurred_on);
  const [memo, setMemo] = useState(entry.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const kind = entry.kind as "capital" | "payout";

  return (
    <Sheet open onClose={onClose} title={kind === "capital" ? "Edit capital" : `Edit payout — ${entry.party === "gabe" ? "Gabe" : "CEO"}`}>
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
            const res = await updateCompanyEntry(entry.id, { kind, occurredOn: date, amount: Number(amount), memo });
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
            await deleteCompanyEntry(entry.id);
            onClose();
            router.refresh();
          }}
        >
          Delete entry
        </button>
      </div>
    </Sheet>
  );
}
