// Reconciliation math for the Tyler <-> Gabe split. A payment's client cash is either
// collected by the owner (Tyler owes Gabe his washer %) or by the washer (Gabe keeps his
// %, owes Tyler the rest). Pure functions so the Payouts view and its check share one source.

export type CollectedBy = "owner" | "washer";

export interface PayoutRow {
  amount: number; // client payment, positive
  /** Processor fee (Stripe). Cuts run on the net that actually arrived. */
  fee?: number;
  collectedBy: CollectedBy;
  settledOn: string | null;
}

/** What one payment implies for the transfer between the two of them. */
export function transfer(row: PayoutRow, washerPct: number) {
  const net = row.amount - (row.fee ?? 0);
  const gabeCut = (net * washerPct) / 100;
  if (row.collectedBy === "owner") {
    // Tyler holds the cash, owes Gabe his cut.
    return { direction: "owner_to_washer" as const, amount: gabeCut };
  }
  // Gabe holds the cash, keeps his cut, owes Tyler the remainder.
  return { direction: "washer_to_owner" as const, amount: net - gabeCut };
}

/**
 * Net across the unsettled money-in rows. Positive => Gabe owes Tyler; negative => Tyler
 * owes Gabe. `count` is the number of unsettled rows.
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
