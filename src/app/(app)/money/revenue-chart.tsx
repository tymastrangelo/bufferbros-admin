"use client";

// Monthly cash flow on the shared Bars primitive: money in rises from the baseline,
// money out (worker cuts, then expenses) hangs below it, one $ scale for both.
// The focus line answers the real question: what did we keep?
import { Bars } from "@/components/bars";
import { money } from "@/lib/format";
import { fmtMonth } from "@/lib/time";

export interface CashflowBar {
  ym: string;
  /** payments + credits − refunds actually collected */
  collected: number;
  /** worker payout rows mirrored off those payments */
  workerCut: number;
  expenses: number;
}

export function CashflowChart({ bars }: { bars: CashflowBar[] }) {
  const kept = (b: CashflowBar) => b.collected - b.workerCut - b.expenses;
  return (
    <Bars
      labels={bars.map((b) => (b.ym.slice(5) === "01" ? b.ym.slice(0, 4) : fmtMonth(b.ym).slice(0, 3)))}
      up={[{ key: "in", label: "Collected", color: "var(--color-viz-1)", values: bars.map((b) => b.collected) }]}
      down={[
        { key: "cut", label: "Worker cut", color: "var(--color-viz-2)", values: bars.map((b) => b.workerCut) },
        { key: "exp", label: "Expenses", color: "var(--color-viz-3)", values: bars.map((b) => b.expenses) },
      ]}
      caption={(i) => {
        const b = bars[i];
        const last = i === bars.length - 1;
        return (
          <>
            <span className="font-semibold text-ink">
              {fmtMonth(b.ym)}
              {last ? " so far" : ""}: kept {money(kept(b))}
            </span>
            <span className="text-ink-2"> — {money(b.collected)} in · {money(b.workerCut)} worker cut · {money(b.expenses)} expenses</span>
          </>
        );
      }}
      ariaLabel={(i) => {
        const b = bars[i];
        return `${fmtMonth(b.ym)}: collected ${money(b.collected)}, worker cut ${money(b.workerCut)}, expenses ${money(b.expenses)}, kept ${money(kept(b))}`;
      }}
    />
  );
}
