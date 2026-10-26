"use client";

// Hand-rolled bar chart on the viz tokens — the one chart primitive (dataviz skill):
// thin marks, 4px rounded data-ends on the baseline, 2px surface gaps between stacked
// segments, one $/px scale across the mirrored halves, a focus line that answers the
// question, legend + direct caption so identity is never color alone, bars grow once.
import { useState, type ReactNode } from "react";
import { money } from "@/lib/format";

export interface BarSeries {
  key: string;
  label: string;
  /** CSS color, e.g. "var(--color-viz-1)". */
  color: string;
  values: number[];
}

export function Bars({
  labels,
  up,
  down = [],
  height = 120,
  downHeight = 72,
  format = money,
  caption,
  ariaLabel,
}: {
  labels: string[];
  up: BarSeries[];
  down?: BarSeries[];
  height?: number;
  downHeight?: number;
  format?: (n: number) => string;
  /** Focus line for bucket i (hover/focus; the last bucket by default). */
  caption?: (i: number) => ReactNode;
  ariaLabel?: (i: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const totalUp = (i: number) => up.reduce((s, sr) => s + (sr.values[i] ?? 0), 0);
  const totalDown = (i: number) => down.reduce((s, sr) => s + (sr.values[i] ?? 0), 0);
  const maxUp = Math.max(...labels.map((_, i) => totalUp(i)), 1);
  const maxDown = Math.max(...labels.map((_, i) => totalDown(i)), 1);
  const k = Math.max(maxUp / (height - 6), down.length ? maxDown / (downHeight - 6) : 0);
  const px = (v: number) => Math.round(v / k);
  const focus = hover ?? n - 1;
  const dim = (i: number) => (hover != null && hover !== i ? "opacity-40" : "");
  const defaultAria = (i: number) =>
    `${labels[i]}: ${[...up, ...down].map((sr) => `${sr.label} ${format(sr.values[i] ?? 0)}`).join(", ")}`;

  return (
    <div>
      {caption && n > 0 && (
        <p className="text-xs num mb-1 min-h-4" aria-live="polite">
          {caption(focus)}
        </p>
      )}
      <div className="flex flex-col" onMouseLeave={() => setHover(null)}>
        <div className="flex items-end gap-1 md:gap-1.5" style={{ height }}>
          {labels.map((_, i) => {
            const segs = up.map((sr) => ({ sr, h: px(sr.values[i] ?? 0) })).filter((s) => s.h > 0);
            return (
              <button
                key={i}
                type="button"
                className="relative flex-1 h-full flex flex-col items-center justify-end outline-offset-2"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                aria-label={(ariaLabel ?? defaultAria)(i)}
              >
                {segs.length ? (
                  <span className="bar-up w-full max-w-[26px] flex flex-col-reverse" style={{ animationDelay: `${i * 25}ms` }}>
                    {segs.map((s, j) => (
                      <span
                        key={s.sr.key}
                        className={`w-full transition-opacity duration-150 ${j === segs.length - 1 ? "rounded-t-[4px]" : ""} ${dim(i)}`}
                        style={{ height: Math.max(s.h, 2), background: s.sr.color, marginTop: j < segs.length - 1 ? 2 : 0 }}
                      />
                    ))}
                  </span>
                ) : (
                  <span className="w-full max-w-[26px] h-[2px] bg-line" />
                )}
              </button>
            );
          })}
        </div>
        <div className="border-t border-line-2" />
        {down.length > 0 && (
          <div className="flex items-start gap-1 md:gap-1.5" style={{ height: downHeight }}>
            {labels.map((_, i) => {
              const segs = down.map((sr) => ({ sr, h: px(sr.values[i] ?? 0) })).filter((s) => s.h > 0);
              return (
                <button key={i} type="button" className="relative flex-1 h-full flex flex-col items-center justify-start outline-offset-2" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} aria-hidden="true">
                  <span className="bar-down w-full max-w-[26px] flex flex-col" style={{ animationDelay: `${120 + i * 25}ms` }}>
                    {segs.map((s, j) => (
                      <span
                        key={s.sr.key}
                        className={`w-full transition-opacity duration-150 ${j === segs.length - 1 ? "rounded-b-[4px]" : ""} ${dim(i)}`}
                        style={{ height: s.h, background: s.sr.color, marginBottom: j < segs.length - 1 ? 2 : 0 }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex gap-1 md:gap-1.5 mt-1">
        {labels.map((l, i) => (
          <span key={i} className={`flex-1 text-center text-micro num truncate ${hover === i ? "text-ink font-semibold" : "text-faint"}`}>
            {l}
          </span>
        ))}
      </div>
      {up.length + down.length > 1 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-micro text-ink-2" aria-label="Legend">
          {[...up, ...down].map((sr) => (
            <li key={sr.key} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: sr.color }} aria-hidden />
              {sr.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
