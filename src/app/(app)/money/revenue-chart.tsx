"use client";

// Stacked monthly revenue, hand-rolled: thin bars, 2px surface gaps between
// segments, rounded data-end on the stack top, per-bar hover tooltip. One axis,
// no gridline noise — the max label and baseline carry the scale.
import { useState } from "react";
import { money } from "@/lib/format";
import { fmtMonth } from "@/lib/time";

export interface MonthBar {
  ym: string;
  plans: number;
  oneTime: number;
}

const H = 160;

export function RevenueChart({ bars }: { bars: MonthBar[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.plans + b.oneTime), 1);
  const px = (v: number) => Math.round((v / max) * (H - 8));

  return (
    <div>
      <div className="flex items-end justify-between text-[10px] text-faint num mb-1">
        <span>{money(max)} peak</span>
        {hover != null && (
          <span className="text-ink font-medium" aria-live="polite">
            {fmtMonth(bars[hover].ym)}: {money(bars[hover].plans + bars[hover].oneTime)}
            {bars[hover].plans > 0 && ` · plans ${money(bars[hover].plans)}`}
            {bars[hover].oneTime > 0 && ` · one-time ${money(bars[hover].oneTime)}`}
          </span>
        )}
      </div>
      <div className="flex items-end gap-1 md:gap-1.5 border-b border-line-2" style={{ height: H }} onMouseLeave={() => setHover(null)}>
        {bars.map((b, i) => {
          const total = b.plans + b.oneTime;
          const plansH = px(b.plans);
          const oneH = px(b.oneTime);
          return (
            <button
              key={b.ym}
              type="button"
              className="relative flex-1 h-full flex flex-col items-center justify-end group outline-offset-2"
              onMouseEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              aria-label={`${fmtMonth(b.ym)}: ${money(total)} total — ${money(b.plans)} plans, ${money(b.oneTime)} one-time`}
            >
              <span className="w-full max-w-[26px] flex flex-col justify-end" style={{ height: "100%" }}>
                {/* stack top = one-time, base = plans (the backbone sits on the baseline) */}
                {b.oneTime > 0 && (
                  <span
                    className={`w-full bg-[#0d9488] rounded-t-[4px] ${hover != null && hover !== i ? "opacity-40" : ""}`}
                    style={{ height: oneH, marginBottom: b.plans > 0 ? 2 : 0 }}
                  />
                )}
                {b.plans > 0 && (
                  <span
                    className={`w-full bg-[#2563eb] ${b.oneTime === 0 ? "rounded-t-[4px]" : ""} ${hover != null && hover !== i ? "opacity-40" : ""}`}
                    style={{ height: plansH }}
                  />
                )}
                {total === 0 && <span className="w-full h-[2px] bg-line" />}
              </span>
            </button>
          );
        })}
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
