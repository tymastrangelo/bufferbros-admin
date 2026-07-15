"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { IconDownload, IconPlus } from "@/components/icons";
import { LedgerEntrySheet } from "@/components/ledger-entry-sheet";
import { EmptyState } from "@/components/ui";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import { PAYMENT_METHODS, type LedgerEntry } from "@/lib/types";

export type PaymentRow = LedgerEntry & { customers: { id: string; name: string } | null };

export function PaymentsClient({ rows, openNew }: { rows: PaymentRow[]; openNew: boolean }) {
  const [sheet, setSheet] = useState<{ entry?: PaymentRow } | null>(openNew ? {} : null);
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setSheet({});
  }
  const closeSheet = () => {
    setSheet(null);
    window.history.replaceState(null, "", "/money/payments");
  };
  const [method, setMethod] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (method && r.method !== method) return false;
        if (from && r.occurred_on < from) return false;
        if (to && r.occurred_on > to) return false;
        if (q && !(r.customers?.name ?? "").toLowerCase().includes(q.toLowerCase()) && !(r.memo ?? "").toLowerCase().includes(q.toLowerCase()))
          return false;
        return true;
      }),
    [rows, method, q, from, to]
  );
  const total = filtered.reduce((s, r) => s + r.amount, 0);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-auto! grow md:grow-0 md:w-56!" placeholder="Filter by customer or memo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select w-auto!" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method filter">
          <option value="">All methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input type="date" className="input num w-auto!" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className="input num w-auto!" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <div className="flex gap-1.5 ml-auto">
          <a
            className="btn btn-sm"
            href={`/api/export?type=payments&from=${from || "2000-01-01"}&to=${to || todayYmd()}`}
          >
            <IconDownload width={14} height={14} /> CSV
          </a>
          <button className="btn btn-primary btn-sm" onClick={() => setSheet({})}>
            <IconPlus width={13} height={13} /> Record
          </button>
        </div>
      </div>

      <p className="mt-2 text-sm text-ink-2">
        {filtered.length} entr{filtered.length === 1 ? "y" : "ies"} ·{" "}
        <span className="num font-medium text-ink">{money(total)}</span> net
      </p>

      <div className="mt-2 card overflow-x-auto">
        {filtered.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? "No payments recorded yet." : "Nothing matches those filters."}
            hint={
              rows.length === 0
                ? "Record your first payment — or complete a job and take payment right in the finalize sheet."
                : undefined
            }
            action={
              rows.length === 0 ? (
                <button className="btn btn-primary" onClick={() => setSheet({})}>
                  Record a payment
                </button>
              ) : undefined
            }
          />
        ) : (
          <table className="tbl tbl-link tbl-stack min-w-[560px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Kind</th>
                <th>Method</th>
                <th>Memo</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => setSheet({ entry: r })}>
                  <td data-label="Date" className="num whitespace-nowrap">{fmtDateShort(r.occurred_on)}</td>
                  <td data-label="Customer" className="font-medium whitespace-nowrap">
                    {r.customers ? (
                      <Link href={`/customers/${r.customers.id}`} className="hover:underline underline-offset-2" onClick={(e) => e.stopPropagation()}>
                        {r.customers.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Kind" className="capitalize">{r.kind}</td>
                  <td data-label="Method" className="capitalize">{r.method ?? "—"}</td>
                  <td data-label="Memo" className="text-ink-2 max-w-[220px] truncate">{r.memo}</td>
                  <td data-label="Amount" className={`num text-right font-medium ${r.amount < 0 ? "text-bad" : "text-ok"}`}>
                    {r.amount < 0 ? "−" : "+"}
                    {money(Math.abs(r.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sheet && <LedgerEntrySheet open onClose={closeSheet} entry={sheet.entry ?? null} />}
    </div>
  );
}
