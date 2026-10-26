"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconCheck } from "@/components/icons";
import { Busy, EmptyState, Segmented } from "@/components/ui";
import { useToast } from "@/components/toast";
import { attributeLedgerEntry, setExpenseReimbursed, setPaymentSettled } from "@/lib/actions/money";
import { WhoPicker, type EmployeeLite } from "@/components/who-picker";
import { money } from "@/lib/format";
import { netOwed, transfer } from "@/lib/payouts";
import { fmtDateShort } from "@/lib/time";

export interface PayoutEntry {
  id: string;
  amount: number;
  processor_fee: number;
  tip: number;
  occurred_on: string;
  collected_by: "owner" | "washer";
  settled_on: string | null;
  memo: string | null;
  customers: { id: string; name: string } | null;
  employee_id: string | null;
  plan_id: string | null;
  appointments: { self_done: boolean; employee_id: string | null; plan_id: string | null } | null;
}

/** An expense the worker paid out of pocket (expenses.paid_by_employee_id). */
export interface FrontedRow {
  id: string;
  occurred_on: string;
  amount: number;
  memo: string | null;
  category: string;
  paid_by_employee_id: string;
  reimbursed_on: string | null;
}

const FILTERS = [
  { id: "unsettled", label: "Unsettled" },
  { id: "settled", label: "Settled" },
  { id: "all", label: "All" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

export function PayoutsClient({ rows, fronted = [], washerPct, name }: { rows: PayoutEntry[]; fronted?: FrontedRow[]; washerPct: number; name: string }) {
  const [filter, setFilter] = useState<FilterId>("unsettled");
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  const { net, count } = useMemo(
    () =>
      netOwed(
        rows.map((r) => ({ amount: r.amount, fee: r.processor_fee, tip: r.tip, collectedBy: r.collected_by, settledOn: r.settled_on, selfDone: !!r.appointments?.self_done })),
        washerPct,
        fronted.map((f) => ({ amount: f.amount, reimbursedOn: f.reimbursed_on }))
      ),
    [rows, fronted, washerPct]
  );
  const shownFronted = fronted.filter((f) => (filter === "all" ? true : filter === "settled" ? f.reimbursed_on : !f.reimbursed_on));

  async function toggleFronted(f: FrontedRow) {
    const paidBack = !f.reimbursed_on;
    setBusy(f.id);
    const res = await setExpenseReimbursed(f.id, paidBack);
    setBusy(null);
    router.refresh();
    if (!res.ok) return toast({ title: "Couldn't update that", detail: res.error, tone: "bad" });
    toast({
      title: paidBack ? `Paid ${name} back ${money(f.amount)}` : `Marked ${money(f.amount)} still owed`,
      detail: f.memo ?? f.category,
      undoneTitle: paidBack ? "Still owed" : "Paid back",
      undo: async () => {
        const back = await setExpenseReimbursed(f.id, !paidBack);
        if (back.ok) router.refresh();
        return back;
      },
    });
  }

  const shown = rows.filter((r) => (filter === "all" ? true : filter === "settled" ? r.settled_on : !r.settled_on));

  async function toggle(r: PayoutEntry) {
    const settled = !r.settled_on;
    setBusy(r.id);
    const res = await setPaymentSettled(r.id, settled);
    setBusy(null);
    router.refresh();
    if (!res.ok) return toast({ title: "Couldn't update that payment", detail: res.error, tone: "bad" });
    toast({
      title: settled ? `Marked settled · ${money(r.amount)}` : `Marked unsettled · ${money(r.amount)}`,
      detail: r.customers?.name ?? undefined,
      undoneTitle: settled ? "Unsettled again" : "Settled again",
      undo: async () => {
        const back = await setPaymentSettled(r.id, !settled);
        if (back.ok) router.refresh();
        return back;
      },
    });
  }

  // net > 0 => the worker owes Tyler; net < 0 => Tyler owes the worker.
  const banner =
    count === 0
      ? { text: "All squared up", cls: "text-ok" }
      : net > 0
        ? { text: `${name} owes you ${money(net)}`, cls: "text-ok" }
        : net < 0
          ? { text: `You owe ${name} ${money(-net)}`, cls: "text-bad" }
          : { text: "Even — nothing to move", cls: "" };

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="card p-4 md:p-5">
        <p className="label">Net with {name} · unsettled</p>
        <p key={banner.text} className={`page-in mt-1.5 text-2xl font-bold num tracking-tight ${banner.cls}`}>{banner.text}</p>
        <p className="mt-1 text-label text-faint">
          {count} unsettled · {name} {washerPct}% / you {100 - washerPct}% · edit their cut on the Team page
        </p>
      </div>

      {shownFronted.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-line flex items-center justify-between">
            <p className="label">Paid out of pocket</p>
            <Link href={`/money/expenses?paidBy=${fronted[0]?.paid_by_employee_id ?? ""}`} className="link text-dense">
              Log one
            </Link>
          </div>
          <ul className="divide-y divide-line">
            {shownFronted.map((f) => (
              <li key={f.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="num text-faint whitespace-nowrap">{fmtDateShort(f.occurred_on)}</span>
                <span className="min-w-0 grow truncate">
                  {f.memo ?? f.category}
                  <span className="text-faint capitalize"> · {f.category}</span>
                </span>
                <span className="num font-medium text-bad whitespace-nowrap">owe {money(f.amount)}</span>
                {f.reimbursed_on ? (
                  <button className="inline-flex items-center gap-1 text-ok text-dense font-medium hover:underline underline-offset-2 disabled:opacity-50" disabled={busy === f.id} onClick={() => toggleFronted(f)} title="Click to undo">
                    <IconCheck width={14} height={14} /> {fmtDateShort(f.reimbursed_on)}
                  </button>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy === f.id} onClick={() => toggleFronted(f)}>
                    {busy === f.id ? <Busy>Saving…</Busy> : "Paid back"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Segmented
        label="Filter payouts"
        className="self-start"
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
      />

      <div className="card overflow-x-auto">
        {shown.length === 0 ? (
          <EmptyState
            title={filter === "unsettled" ? "Nothing to settle." : "Nothing here."}
            hint={
              filter === "unsettled"
                ? `As payments come in, each one shows up here until you and ${name} square up the split.`
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
                const selfDone = !!r.appointments?.self_done;
                const t = transfer({ amount: r.amount, fee: r.processor_fee, tip: r.tip, collectedBy: r.collected_by, settledOn: r.settled_on, selfDone }, washerPct);
                const transferText = selfDone
                  ? t.amount === 0
                    ? "No worker cut — your job"
                    : `${name} owes you ${money(t.amount)} — your job`
                  : t.direction === "owner_to_washer"
                    ? `Pay ${name} ${money(t.amount)}`
                    : `${name} owes you ${money(t.amount)}`;
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
                      {r.tip > 0 && <span className="block text-micro text-faint">+ {money(r.tip)} tip</span>}
                    </td>
                    <td data-label="Collected" className={r.collected_by === "washer" ? "text-ink" : "text-ink-2"}>
                      {r.collected_by === "washer" ? name : "Me"}
                    </td>
                    <td data-label="Transfer" className={selfDone && t.amount === 0 ? "text-ink-2" : t.direction === "owner_to_washer" ? "text-bad" : "text-ok"}>
                      {transferText}
                    </td>
                    <td data-label="Settle" className="text-right">
                      {r.settled_on ? (
                        <button
                          className="inline-flex items-center gap-1 text-ok text-dense font-medium hover:underline underline-offset-2 disabled:opacity-50"
                          disabled={busy === r.id}
                          onClick={() => toggle(r)}
                          title="Click to undo"
                        >
                          <IconCheck width={14} height={14} /> {fmtDateShort(r.settled_on)}
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={busy === r.id}
                          onClick={() => toggle(r)}
                        >
                          {busy === r.id ? <Busy>Saving…</Busy> : "Mark paid"}
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

/**
 * Payments nobody gets a cut on yet (no job worker, no plan worker): one tap says who did
 * the work, and the split rebuilds itself. Owner-only page, so no role gate here.
 */
export function UnattributedPayouts({ rows, employees }: { rows: PayoutEntry[]; employees: EmployeeLite[] }) {
  const router = useRouter();
  const toast = useToast();
  const [picking, setPicking] = useState<string | null>(null);
  const [choice, setChoice] = useState<{ id: string | null; keepAll: boolean }>({ id: null, keepAll: true });
  const [busy, setBusy] = useState(false);

  async function save(r: PayoutEntry) {
    setBusy(true);
    const res = await attributeLedgerEntry(r.id, choice.id);
    setBusy(false);
    if (!res.ok) return toast({ title: "Couldn't attribute that payment", detail: res.error, tone: "bad" });
    setPicking(null);
    router.refresh();
    const who = choice.id ? employees.find((e) => e.id === choice.id)?.name ?? "worker" : "you";
    toast({ title: `${money(r.amount)} attributed to ${who}`, detail: r.customers?.name ?? undefined });
  }

  return (
    <div className="mt-5 card overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <p className="h-card">Unattributed · {rows.length}</p>
        <p className="text-xs text-ink-2 mt-0.5">No worker gets a cut on these until you say who did the work.</p>
      </div>
      <div className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.id} className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {r.customers ? (
                    <Link href={`/customers/${r.customers.id}`} className="hover:underline underline-offset-2">
                      {r.customers.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                  <span className="text-faint font-normal"> · {r.memo ?? (r.plan_id ? "plan prepay" : r.appointments ? "job" : "balance")}</span>
                </p>
                <p className="text-xs text-faint num">{fmtDateShort(r.occurred_on)} · collected by {r.collected_by === "washer" ? "a worker" : "you"}</p>
              </div>
              <span className="num font-medium shrink-0">{money(r.amount)}</span>
              {picking !== r.id && (
                <button className="btn btn-sm shrink-0" onClick={() => { setPicking(r.id); setChoice({ id: employees[0]?.id ?? null, keepAll: !employees.length }); }}>
                  Who did it
                </button>
              )}
            </div>
            {picking === r.id && (
              <div className="well p-3 flex flex-col gap-3">
                <WhoPicker employees={employees} value={choice.id} keepAll={choice.keepAll} onChange={(id, keepAll) => setChoice({ id, keepAll })} label="Who gets the cut?" allowOwner={!!r.appointments} />
                {!r.appointments && <p className="text-xs text-faint -mt-1">No job on this payment, so it can only go to a worker. If it was yours, just mark it settled.</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn" onClick={() => setPicking(null)} disabled={busy}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" onClick={() => save(r)} disabled={busy || (!r.appointments && !choice.id)}>
                    {busy ? <Busy>Saving…</Busy> : "Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
