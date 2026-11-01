"use client";

// Per-weekday hours for one worker: Business (inherit) · Custom (two native time
// inputs, HIG pickers.md: pick in context, no view switch) · Rather not (bookable, but
// flagged — saved as employees.prefers_off, 0034) · Off. Hours save as employees.hours;
// the slot engine honors them (0029).
import { useState } from "react";
import { SuccessButton } from "@/components/ui";
import { updateEmployee } from "@/lib/actions/employees";
import { minToLabel, WEEKDAYS_SHORT } from "@/lib/time";
import type { EmployeeHours, WeeklyHours } from "@/lib/types";

type Mode = "business" | "custom" | "soft" | "off";
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday-first display; stored by weekday 0–6

const toClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const fromClock = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export function HoursEditor({ employeeId, hours, prefersOff, business }: { employeeId: string; hours: EmployeeHours | null; prefersOff: number[]; business: WeeklyHours[] }) {
  const biz = new Map(business.map((b) => [b.weekday, b]));
  const [draft, setDraft] = useState<Record<number, { mode: Mode; open: number; close: number }>>(() => {
    const d: Record<number, { mode: Mode; open: number; close: number }> = {};
    for (const wd of ORDER) {
      const own = hours?.[String(wd)];
      const b = biz.get(wd);
      d[wd] = {
        mode: own === false ? "off" : Array.isArray(own) ? "custom" : prefersOff.includes(wd) ? "soft" : "business",
        open: Array.isArray(own) ? own[0] : b?.open_min ?? 480,
        close: Array.isArray(own) ? own[1] : b?.close_min ?? 1080,
      };
    }
    return d;
  });
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");

  const set = (wd: number, patch: Partial<{ mode: Mode; open: number; close: number }>) => setDraft((cur) => ({ ...cur, [wd]: { ...cur[wd], ...patch } }));

  async function save() {
    setState("saving");
    const out: EmployeeHours = {};
    const soft: number[] = [];
    for (const wd of ORDER) {
      const r = draft[wd];
      if (r.mode === "off") out[String(wd)] = false;
      else if (r.mode === "custom") out[String(wd)] = [r.open, r.close];
      else if (r.mode === "soft") soft.push(wd);
    }
    const res = await updateEmployee(employeeId, { hours: Object.keys(out).length ? out : null, prefers_off: soft.sort() });
    if (!res.ok) return setState(res.error ?? "Couldn't save hours.");
    setState("saved");
    setTimeout(() => setState("idle"), 1600);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card divide-y divide-line overflow-hidden">
        {ORDER.map((wd) => {
          const r = draft[wd];
          const b = biz.get(wd);
          return (
            <div key={wd} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="w-10 text-sm font-semibold">{WEEKDAYS_SHORT[wd]}</span>
              <div className="flex gap-1" role="group" aria-label={`${WEEKDAYS_SHORT[wd]} hours`}>
                {(["business", "custom", "soft", "off"] as Mode[]).map((m) => (
                  <button key={m} type="button" className="choice h-8 px-2.5 text-dense" aria-pressed={r.mode === m} onClick={() => set(wd, { mode: m })}>
                    {m === "business" ? "Business" : m === "custom" ? "Custom" : m === "soft" ? "Rather not" : "Off"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-faint num ml-auto">
                {r.mode === "off" ? "day off" : r.mode === "soft" ? "bookable, flagged" : r.mode === "business" ? (b?.enabled ? `${minToLabel(b.open_min)} – ${minToLabel(b.close_min)}` : "closed") : null}
              </span>
              {r.mode === "custom" && (
                <div className="basis-full flex items-center gap-2 pl-12">
                  <input type="time" step={900} className="input num h-9 w-auto" value={toClock(r.open)} aria-label={`${WEEKDAYS_SHORT[wd]} start`} onChange={(e) => { const v = fromClock(e.target.value); if (v != null) set(wd, { open: v }); }} />
                  <span className="text-faint">–</span>
                  <input type="time" step={900} className="input num h-9 w-auto" value={toClock(r.close)} aria-label={`${WEEKDAYS_SHORT[wd]} end`} onChange={(e) => { const v = fromClock(e.target.value); if (v != null) set(wd, { close: v }); }} />
                  {r.open >= r.close && <span className="text-xs text-bad">Start must be before end</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs text-faint">Business hours live in Settings; Custom overrides them for this person; Rather not keeps the day bookable but flags it on the calendar and when assigning; Off means no bookings that day.</p>
        <SuccessButton state={state} onClick={save} doneLabel="Hours saved" disabled={ORDER.some((wd) => draft[wd].mode === "custom" && draft[wd].open >= draft[wd].close)}>
          Save hours
        </SuccessButton>
      </div>
    </div>
  );
}
