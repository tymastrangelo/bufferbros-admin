"use client";

// Monthly cash flow, hand-rolled: money in rises from the baseline, money out
// (worker cuts, then expenses) hangs below it, one $ scale for both directions.
// Thin bars, 2px surface gaps between stacked segments, rounded data-ends, a
// per-month hover tooltip that answers the real question: what did we keep?
import { useState } from "react";
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

const H_UP = 120;
const H_DOWN = 72;
// Categorical trio, CVD-validated (dataviz six-checks, light surface).
const C_IN = "#2563eb";
const C_CUT = "#0d9488";
const C_EXP = "#d97706";

export function CashflowChart({ bars }: { bars: CashflowBar[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const maxUp = Math.max(...bars.map((b) => b.collected), 1);
  const maxDown = Math.max(...bars.map((b) => b.workerCut + b.expenses), 1);
  // One $-per-px scale for both directions — the mirrored halves stay comparable.
  const k = Math.max(maxUp / (H_UP - 6), maxDown / (H_DOWN - 6));
  const px = (v: number) => Math.round(v / k);

  const kept = (b: CashflowBar) => b.collected - b.workerCut - b.expenses;
  const focus = hover != null ? bars[hover] : bars[bars.length - 1];
  const focusLabel = hover != null ? fmtMonth(focus.ym) : `${fmtMonth(focus.ym)} so far`;

  return (
    <div>
      <p className="text-[12px] num mb-1" aria-live="polite">
        <span className="font-semibold text-ink">
          {focusLabel}: kept {money(kept(focus))}
        </span>
        <span className="text-ink-2">
          {" "}
          — {money(focus.collected)} in · {money(focus.workerCut)} worker cut · {money(focus.expenses)} expenses
        </span>
      </p>
      <div className="flex flex-col" onMouseLeave={() => setHover(null)}>
        {/* money in */}
        <div className="flex items-end gap-1 md:gap-1.5" style={{ height: H_UP }}>
          {bars.map((b, i) => (
            <button
              key={b.ym}
              type="button"
              className="relative flex-1 h-full flex flex-col items-center justify-end outline-offset-2"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${fmtMonth(b.ym)}: collected ${money(b.collected)}, worker cut ${money(b.workerCut)}, expenses ${money(b.expenses)}, kept ${money(kept(b))}`}
            >
              {b.collected > 0 ? (
                <span
                  className={`w-full max-w-[26px] rounded-t-[4px] ${hover != null && hover !== i ? "opacity-40" : ""}`}
                  style={{ height: Math.max(px(b.collected), 2), background: C_IN }}
                />
              ) : (
                <span className="w-full max-w-[26px] h-[2px] bg-line" />
              )}
            </button>
          ))}
        </div>
        {/* baseline */}
        <div className="border-t border-line-2" />
        {/* money out: worker cut on the baseline, expenses below it */}
        <div className="flex items-start gap-1 md:gap-1.5" style={{ height: H_DOWN }}>
          {bars.map((b, i) => {
            const cutH = px(b.workerCut);
            const expH = px(b.expenses);
            return (
              <button
                key={b.ym}
                type="button"
                className="relative flex-1 h-full flex flex-col items-center justify-start outline-offset-2"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                tabIndex={-1}
                aria-hidden="true"
              >
                <span className="w-full max-w-[26px] flex flex-col">
                  {b.workerCut > 0 && (
                    <span
                      className={`w-full ${expH === 0 ? "rounded-b-[4px]" : ""} ${hover != null && hover !== i ? "opacity-40" : ""}`}
                      style={{ height: cutH, background: C_CUT, marginBottom: expH > 0 ? 2 : 0 }}
                    />
                  )}
                  {b.expenses > 0 && (
                    <span
                      className={`w-full rounded-b-[4px] ${hover != null && hover !== i ? "opacity-40" : ""}`}
                      style={{ height: expH, background: C_EXP }}
                    />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1 md:gap-1.5 mt-1">
        {bars.map((b, i) => (
          <span key={b.ym} className={`flex-1 text-center text-[10px] num ${hover === i ? "text-ink font-semibold" : "text-faint"}`}>
            {b.ym.slice(5) === "01" ? b.ym.slice(0, 4) : fmtMonth(b.ym).slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  );
}
