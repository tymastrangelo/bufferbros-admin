// Reconciliation math for the owner <-> worker split. A payment's client cash is either
// collected by the owner (Tyler owes the worker their %) or by the worker (they keep
// their %, owe Tyler the rest). Pure functions so the Payouts view and its check share
// one source.

export type CollectedBy = "owner" | "washer";

export interface PayoutRow {
  amount: number; // client payment, positive
  /** Processor fee (Stripe). Cuts run on the net that actually arrived. */
  fee?: number;
  collectedBy: CollectedBy;
  settledOn: string | null;
  /** Keep-all-the-money job — the worker's cut is 0 on this payment. */
  selfDone?: boolean;
  /** Per-row worker % (each employee has their own); falls back to the call-level pct. */
  pct?: number;
  /** Tip on this payment: 100% the worker's, outside the split (0030). */
  tip?: number;
}

/** What one payment implies for the transfer between Tyler and the worker. */
export function transfer(row: PayoutRow, washerPct: number) {
  const net = row.amount - (row.fee ?? 0);
  const workerCut = row.selfDone ? 0 : (net * (row.pct ?? washerPct)) / 100;
  const tip = row.selfDone ? 0 : (row.tip ?? 0);
  if (row.collectedBy === "owner") {
    // Tyler holds the cash (and the tip), owes the worker their cut plus the tip.
    return { direction: "owner_to_washer" as const, amount: workerCut + tip };
  }
  // The worker holds the cash, keeps their cut and the whole tip, owes Tyler the remainder.
  return { direction: "washer_to_owner" as const, amount: net - workerCut };
}

/** An expense a worker paid out of pocket; Tyler owes it back until `reimbursedOn` is set. */
export interface FrontedExpense {
  amount: number;
  reimbursedOn: string | null;
}

/**
 * Net across the unsettled money-in rows and unreimbursed fronted expenses. Positive =>
 * the worker owes Tyler; negative => Tyler owes the worker. `count` = unsettled items.
 */
export function netOwed(rows: PayoutRow[], washerPct: number, fronted: FrontedExpense[] = []) {
  let net = 0;
  let count = 0;
  for (const row of rows) {
    if (row.settledOn) continue;
    count++;
    const t = transfer(row, washerPct);
    net += t.direction === "washer_to_owner" ? t.amount : -t.amount;
  }
  for (const f of fronted) {
    if (f.reimbursedOn) continue;
    count++;
    net -= f.amount;
  }
  return { net, count };
}

/** The shape of a money-in ledger row that payee resolution needs. */
export interface PayeeSource {
  appointments: { employee_id: string | null; plan_id?: string | null; self_done?: boolean } | null;
  employee_id: string | null;
  plan_id: string | null;
}

/**
 * Who a payment's worker cut goes to — the TS twin of the `mirror_cash_split` trigger
 * (0029): the job's worker, else the payment's explicit worker, else the plan's worker,
 * else nobody (null). Keep in lockstep with the SQL.
 */
export function payeeOf(e: PayeeSource, planWorker: (planId: string) => string | null): string | null {
  if (e.appointments?.self_done) return null; // owner kept it all: no worker cut, whatever the plan says
  if (e.appointments?.employee_id) return e.appointments.employee_id;
  if (e.employee_id) return e.employee_id;
  const planId = e.plan_id ?? e.appointments?.plan_id ?? null;
  return planId ? planWorker(planId) : null;
}

/** A mirrored company_ledger row as My Pay needs it. */
export interface MirrorRow {
  id: string;
  kind: string;
  ledger_entry_id: string | null;
  employee_id: string | null;
  amount: number;
  memo: string | null;
  collected_by: string | null;
  settled_on: string | null;
  occurred_on: string;
}

export const isTipRow = (memo: string | null | undefined) => !!memo && memo.startsWith("tip — ");

/**
 * The worker's view of their payout rows: what they keep, and on cash they collected
 * themselves, what they send Tyler (net − cut; a tip never enters the transfer). The
 * revenue lookup skips the pass-through tip rows that share the same ledger entry.
 */
export function myPayRows(entries: MirrorRow[], employeeId: string) {
  const revenueByEntry = new Map(
    entries.filter((e) => e.kind === "revenue" && e.ledger_entry_id && !isTipRow(e.memo)).map((e) => [e.ledger_entry_id as string, e.amount])
  );
  return entries
    .filter((e) => e.kind === "payout" && e.employee_id === employeeId)
    .map((e) => {
      const keep = -e.amount; // payouts are stored negative
      const isTip = isTipRow(e.memo);
      const collected = e.ledger_entry_id ? revenueByEntry.get(e.ledger_entry_id) ?? null : null;
      const send = !isTip && e.collected_by === "washer" && collected != null ? collected - keep : isTip ? 0 : null;
      return { ...e, keep, send, isTip, settled: !!e.settled_on };
    });
}
