"use client";

// Availability-aware time picker: shows real open slots from the RPC, with an
// explicit off-grid custom time + "book anyway" escape hatch for the owners.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { minToLabel } from "@/lib/time";

export function SlotPicker({
  date,
  durationMin,
  value,
  onChange,
  excludeAppointmentId,
}: {
  date: string;
  durationMin: number;
  value: number | null;
  onChange: (min: number | null, offGrid: boolean) => void;
  /** informational only — when rescheduling, its own slot shows as busy */
  excludeAppointmentId?: string;
}) {
  const [slots, setSlots] = useState<number[] | null>(null);
  const [custom, setCustom] = useState(false);
  const supabase = createClient();

  // Reset to loading when the query changes (state adjustment during render).
  const fetchKey = `${date}:${durationMin}`;
  const [prevKey, setPrevKey] = useState(fetchKey);
  if (prevKey !== fetchKey) {
    setPrevKey(fetchKey);
    setSlots(null);
  }

  useEffect(() => {
    if (!date || !durationMin) return;
    let stale = false;
    supabase
      .rpc("get_available_slots", { p_date: date, p_duration_min: durationMin })
      .then(({ data }) => {
        if (!stale) setSlots(((data ?? []) as { slot_min: number }[]).map((r) => r.slot_min));
      });
    return () => {
      stale = true;
    };
  }, [date, durationMin, supabase]);

  const onGrid = value != null && slots?.includes(value);

  return (
    <div>
      {slots === null ? (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-8 w-[72px]" />
          ))}
        </div>
      ) : slots.length === 0 && !custom ? (
        <p className="text-sm text-warn bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2">
          No open slots this day{excludeAppointmentId ? " (its current time counts as busy)" : ""}. Use a custom
          time to book anyway.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setCustom(false);
                onChange(s, false);
              }}
              className={`h-8 px-2.5 rounded-md border text-[13px] font-medium num transition-colors duration-150 ${
                value === s && !custom
                  ? "bg-brand border-brand text-white"
                  : "bg-card border-line-2 hover:border-brand hover:text-brand-deep"
              }`}
            >
              {minToLabel(s)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={custom}
            onChange={(e) => {
              setCustom(e.target.checked);
              if (!e.target.checked) onChange(null, false);
            }}
          />
          Custom time
        </label>
        {custom && (
          <input
            type="time"
            step={300}
            className="input h-8! w-auto! text-[13px]"
            value={value != null ? `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` : ""}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (!Number.isNaN(h)) onChange(h * 60 + m, true);
            }}
          />
        )}
        {custom && value != null && !onGrid && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-warn">books anyway</span>
        )}
      </div>
    </div>
  );
}
