"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui";
import { setPaymentSettled } from "@/lib/actions/money";
import { money } from "@/lib/format";
import { netOwed, transfer } from "@/lib/payouts";
import { fmtDateShort } from "@/lib/time";

export interface PayoutEntry {
  id: string;
  amount: number;
  processor_fee: number;
  occurred_on: string;
  collected_by: "owner" | "washer";
  settled_on: string | null;
  memo: string | null;
  customers: { id: string; name: string } | null;
}

const FILTERS = [
  { id: "unsettled", label: "Unsettled" },
  { id: "settled", label: "Settled" },
  { id: "all", label: "All" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

export function PayoutsClient({ rows, washerPct }: { rows: PayoutEntry[]; washerPct: number }) {
  const [filter, setFilter] = useState<FilterId>("unsettled");
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const { net, count } = useMemo(
    () => netOwed(rows.map((r) => ({ amount: r.amount, fee: r.processor_fee, collectedBy: r.collected_by, settledOn: r.settled_on })), washerPct),
    [rows, washerPct]
  );

  const shown = rows.filter((r) => (filter === "all" ? true : filter === "settled" ? r.settled_on : !r.settled_on));

  async function toggle(r: PayoutEntry) {
    setBusy(r.id);
    await setPaymentSettled(r.id, !r.settled_on);
    setBusy(null);
    router.refresh();
  }

  // net > 0 => Gabe owes Tyler; net < 0 => Tyler owes Gabe.
  const banner =
    count === 0
      ? { text: "All squared up", cls: "text-ok" }
      : net > 0
        ? { text: `Gabe owes you ${money(net)}`, cls: "text-ok" }
        : net < 0
          ? { text: `You owe Gabe ${money(-net)}`, cls: "text-bad" }
          : { text: "Even — nothing to move", cls: "" };

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="card p-3.5">
        <p className="label">Net with Gabe · unsettled</p>
        <p className={`mt-1 text-2xl font-bold num ${banner.cls}`}>{banner.text}</p>
        <p className="mt-1 text-[11px] text-faint">
          {count} unsettled · Gabe {washerPct}% / you {100 - washerPct}% · edit split in Settings
        </p>
      </div>

      <div className="flex gap-1.5">
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
            title={filter === "unsettled" ? "Nothing to settle." : "Nothing here."}
            hint={
              filter === "unsettled"
                ? "As payments come in, each one shows up here until you and Gabe square up the split."
                : undefined
            }
          />
        ) : (
          <table className="tbl tbl-link tbl-stack min-w-[560px]">
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th className="text-right">Payment</th>
                <th>Collected</th>
                <th>Transfer</th>
                <th className="text-right">Settle</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const t = transfer({ amount: r.amount, fee: r.processor_fee, collectedBy: r.collected_by, settledOn: r.settled_on }, washerPct);
                const transferText =
                  t.direction === "owner_to_washer" ? `Pay Gabe ${money(t.amount)}` : `Gabe owes you ${money(t.amount)}`;
                return (
                  <tr key={r.id}>
                    <td data-label="Date" className="num whitespace-nowrap">
                      {fmtDateShort(r.occurred_on)}
                    </td>
                    <td data-label="Customer" className="font-medium whitespace-nowrap">
                      {r.customers ? (
                        <Link href={`/customers/${r.customers.id}`} className="hover:underline underline-offset-2">
                          {r.customers.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Payment" className="num text-right">
                      {money(r.amount)}
                    </td>
                    <td data-label="Collected" className={r.collected_by === "washer" ? "text-ink" : "text-ink-2"}>
                      {r.collected_by === "washer" ? "Gabe" : "Me"}
                    </td>
                    <td data-label="Transfer" className={t.direction === "owner_to_washer" ? "text-bad" : "text-ok"}>
                      {transferText}
                    </td>
                    <td data-label="Settle" className="text-right">
                      {r.settled_on ? (
                        <button
                          className="text-ok text-[13px] font-medium hover:underline underline-offset-2 disabled:opacity-50"
                          disabled={busy === r.id}
                          onClick={() => toggle(r)}
                          title="Click to undo"
                        >
                          ✓ {fmtDateShort(r.settled_on)}
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy === r.id}
                          onClick={() => toggle(r)}
                        >
                          {busy === r.id ? "…" : "Mark paid"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
