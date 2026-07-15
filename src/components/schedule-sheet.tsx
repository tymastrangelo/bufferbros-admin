"use client";

// "Schedule visits through…" — pick how far out to materialize recurring visits.
// Used from a single plan's page and from the Plans index (all active plans).
import { useState } from "react";
import { schedulePlanVisits } from "@/lib/actions/plans";
import type { GenerateResult } from "@/lib/occurrences";
import { addDays, fmtDateLong } from "@/lib/time";
import { Wheel } from "./brand";
import { ErrorNote, Field, Sheet } from "./ui";

export function ScheduleSheet({
  open,
  onClose,
  today,
  planId,
  scopeLabel,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  today: string;
  planId?: string; // omit = all active plans
  scopeLabel: string; // "Joan Delgado's plan" | "all active plans"
  onDone: (result: GenerateResult) => void;
}) {
  const [until, setUntil] = useState(addDays(today, 56));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function submit() {
    setError(null);
    setPending(true);
    const res = await schedulePlanVisits(planId, until);
    setPending(false);
    if (!res.ok) return setError(res.error);
    onDone(res.result);
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Schedule visits">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          Create every upcoming visit for <span className="font-medium text-ink">{scopeLabel}</span>, from
          today through the date you pick — each at the plan&apos;s preferred day and time.
        </p>
        <Field label="Through" hint={`Everything up to and including ${fmtDateLong(until)}`}>
          <input
            type="date"
            className="input num"
            value={until}
            min={addDays(today, 1)}
            onChange={(e) => setUntil(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "8 weeks", d: 56 },
            { label: "3 months", d: 91 },
            { label: "6 months", d: 182 },
            { label: `Rest of ${today.slice(0, 4)}`, ymd: `${today.slice(0, 4)}-12-31` },
          ].map((p) => {
            const value = "ymd" in p && p.ymd ? p.ymd : addDays(today, p.d as number);
            if (value <= today) return null;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => setUntil(value)}
                className={`chip cursor-pointer ${until === value ? "bg-ink text-white" : "bg-[#f1f4f9] text-ink-2 hover:bg-line"}`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-ink-2">
          Already-scheduled dates are skipped, so this never duplicates. Times that collide with another
          job or a block get flagged for manual placement instead of being moved.
        </p>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary h-11" disabled={pending} onClick={submit}>
          {pending ? (
            <>
              <Wheel size={18} /> Scheduling…
            </>
          ) : (
            "Schedule visits"
          )}
        </button>
      </div>
    </Sheet>
  );
}
