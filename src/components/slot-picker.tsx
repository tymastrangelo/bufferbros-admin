"use client";

// Availability-aware time picker: shows real open slots from the RPC, with an
// explicit off-grid custom time + "book anyway" escape hatch for the owners.
import { useEffect, useState } from "react";
import { Wheel } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { minToLabel } from "@/lib/time";

export function SlotPicker({
  date,
  durationMin,
  value,
  onChange,
  excludeAppointmentId,
  employeeIds,
}: {
  date: string;
  durationMin: number;
  value: number | null;
  onChange: (min: number | null, offGrid: boolean) => void;
  /** informational only — when rescheduling, its own slot shows as busy */
  excludeAppointmentId?: string;
  /**
   * Whose free time to show: [] = the owner (business calendar only), ids = times
   * every listed worker is free. Omit for the website-toggle/whole-business view.
   */
  employeeIds?: string[];
}) {
  const [slots, setSlots] = useState<number[] | null>(null);
  const [custom, setCustom] = useState(false);
  const supabase = createClient();

  // Reset to loading when the query changes (state adjustment during render).
  const empKey = employeeIds ? employeeIds.join(",") : "∅";
  const fetchKey = `${date}:${durationMin}:${empKey}`;
  const [prevKey, setPrevKey] = useState(fetchKey);
  if (prevKey !== fetchKey) {
    setPrevKey(fetchKey);
    setSlots(null);
  }

  useEffect(() => {
    if (!date || !durationMin) return;
    let stale = false;
    supabase
      .rpc("get_available_slots", {
        p_date: date,
        p_duration_min: durationMin,
        ...(employeeIds ? { p_employee_ids: employeeIds } : {}),
      })
      .then(({ data }) => {
        if (!stale) setSlots(((data ?? []) as { slot_min: number }[]).map((r) => r.slot_min));
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- empKey stands in for the employeeIds array identity
  }, [date, durationMin, empKey, supabase]);

  const onGrid = value != null && slots?.includes(value);

  return (
    <div>
      {slots === null ? (
        <div className="flex items-center gap-2.5 py-1 text-dense text-faint">
          <Wheel size={22} /> Checking the schedule…
        </div>
      ) : slots.length === 0 && !custom ? (
        <p className="text-sm note note-warn">
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
              className="choice h-8 px-2.5 text-dense num" aria-pressed={value === s && !custom}
            >
              {minToLabel(s)}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-dense text-ink-2">
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
            className="input h-8! w-auto! text-dense"
            value={value != null ? `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` : ""}
            onChange={(e) => {
              const [h, m] = e.target.value.split(":").map(Number);
              if (!Number.isNaN(h)) onChange(h * 60 + m, true);
            }}
          />
        )}
        {custom && value != null && !onGrid && (
          <span className="text-label font-semibold uppercase tracking-wide text-warn">books anyway</span>
        )}
      </div>
    </div>
  );
}
