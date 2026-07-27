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
}

/** What one payment implies for the transfer between Tyler and the worker. */
export function transfer(row: PayoutRow, washerPct: number) {
  const net = row.amount - (row.fee ?? 0);
  const workerCut = row.selfDone ? 0 : (net * (row.pct ?? washerPct)) / 100;
  if (row.collectedBy === "owner") {
    // Tyler holds the cash, owes the worker their cut.
    return { direction: "owner_to_washer" as const, amount: workerCut };
  }
  // The worker holds the cash, keeps their cut, owes Tyler the remainder.
  return { direction: "washer_to_owner" as const, amount: net - workerCut };
}

/**
 * Net across the unsettled money-in rows. Positive => the worker owes Tyler; negative =>
 * Tyler owes the worker. `count` is the number of unsettled rows.
 */
export function netOwed(rows: PayoutRow[], washerPct: number) {
  let net = 0;
  let count = 0;
  for (const row of rows) {
    if (row.settledOn) continue;
    count++;
    const t = transfer(row, washerPct);
    net += t.direction === "washer_to_owner" ? t.amount : -t.amount;
  }
  return { net, count };
}
