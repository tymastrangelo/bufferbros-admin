"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Wheel } from "@/components/brand";
import { addonQuote, computeQuote, planPrice, type Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { addDays, fmtDateShort, minToLabel, todayYmd, weekdayOf, WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/time";
import { SIZES, sizeLabel, type PlanCadence, type SizeId } from "@/lib/types";
import { IconCalendar, IconPlus, IconSparkle, IconX } from "@/components/icons";

type Mode = "once" | "plan";

interface QuoteVehicle {
  key: number;
  name: string; // optional free text, e.g. "Range Rover"
  size: SizeId;
  addons: string[];
}

const CADENCES: { id: PlanCadence; label: string; visitsPerMonth: number }[] = [
  { id: "weekly", label: "Weekly", visitsPerMonth: 52 / 12 },
  { id: "biweekly", label: "Every 2 weeks", visitsPerMonth: 26 / 12 },
  { id: "monthly", label: "Monthly", visitsPerMonth: 1 },
];

// ponytail: fixed discount tiers (2 cars = 5%, 3+ = 10%), tappable override. Make it a
// settings row if the tiers ever need to change without a deploy.
const suggestedDiscount = (n: number) => (n >= 3 ? 10 : n === 2 ? 5 : 0);
const DISCOUNT_CHOICES = [0, 5, 10, 15];

/** Price for one vehicle. One-time: detail + addons. Plan: per-visit plan price + addons. */
function vehicleQuote(catalog: Catalog, v: QuoteVehicle, mode: Mode, cadence: PlanCadence) {
  if (mode === "once") return computeQuote(catalog, v.size, v.addons);
  const base = planPrice(catalog, cadence, v.size) ?? catalog.detail[v.size]?.price ?? 0;
  const extras = catalog.addons.filter((a) => v.addons.includes(a.id)).map((a) => addonQuote(a, v.size));
  const detail = catalog.detail[v.size] ?? { minutes: 120 };
  return {
    price: base + extras.reduce((s, a) => s + a.price, 0),
    minutes: detail.minutes + extras.reduce((s, a) => s + a.minutes, 0),
  };
}

const fmtHours = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

export function QuoteClient({ catalog, owner }: { catalog: Catalog; owner: boolean }) {
  const [mode, setMode] = useState<Mode>("once");
  const [cadence, setCadence] = useState<PlanCadence>("biweekly");
  const [vehicles, setVehicles] = useState<QuoteVehicle[]>([{ key: 1, name: "", size: "sedan", addons: [] }]);
  const [discountOverride, setDiscountOverride] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const nextKey = useRef(2);

  const quotes = vehicles.map((v) => vehicleQuote(catalog, v, mode, cadence));
  const subtotal = quotes.reduce((s, q) => s + q.price, 0);
  const minutes = quotes.reduce((s, q) => s + q.minutes, 0);
  const discountPct = discountOverride ?? suggestedDiscount(vehicles.length);
  const total = Math.round(subtotal * (1 - discountPct / 100));
  const discountAmt = subtotal - total; // so the displayed lines always add up exactly
  const visitsPerMonth = CADENCES.find((c) => c.id === cadence)?.visitsPerMonth ?? 1;

  const patch = (key: number, p: Partial<QuoteVehicle>) =>
    setVehicles((vs) => vs.map((v) => (v.key === key ? { ...v, ...p } : v)));
  const addVehicle = (copyOf?: QuoteVehicle) =>
    setVehicles((vs) => [
      ...vs,
      copyOf
        ? { ...copyOf, key: nextKey.current++, name: copyOf.name ? `${copyOf.name} (copy)` : "" }
        : { key: nextKey.current++, name: "", size: "sedan", addons: [] },
    ]);

  if (revealed) {
    return (
      <QuoteResult
        catalog={catalog}
        owner={owner}
        mode={mode}
        cadence={cadence}
        vehicles={vehicles}
        quotes={quotes}
        subtotal={subtotal}
        discountPct={discountPct}
        discountAmt={discountAmt}
        total={total}
        visitsPerMonth={visitsPerMonth}
        onBack={() => setRevealed(false)}
        onReset={() => {
          setVehicles([{ key: nextKey.current++, name: "", size: "sedan", addons: [] }]);
          setDiscountOverride(null);
          setMode("once");
          setCadence("biweekly");
          setRevealed(false);
        }}
      />
    );
  }

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-2xl">
      <h1 className="text-xl md:text-2xl font-bold">Quote builder</h1>
      <p className="mt-1 text-sm text-ink-2">Live prices from Settings. Build it, then hit generate.</p>

      {/* One-time vs plan */}
      <div className="mt-4 grid grid-cols-2 gap-1.5">
        {(
          [
            { id: "once", label: "One-time detail" },
            { id: "plan", label: "Recurring plan" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`h-10 rounded-md border text-sm font-medium transition-colors duration-150 ${
              mode === m.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === "plan" && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {CADENCES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCadence(c.id)}
              className={`h-9 rounded-md border text-[13px] font-medium transition-colors duration-150 ${
                cadence === c.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Vehicles */}
      <div className="mt-4 flex flex-col gap-3">
        {vehicles.map((v, i) => (
          <div key={v.key} className="card p-3.5">
            <div className="flex items-center gap-2">
              <input
                className="input h-9 grow font-medium"
                placeholder={`Vehicle ${i + 1} — e.g. Range Rover (optional)`}
                value={v.name}
                onChange={(e) => patch(v.key, { name: e.target.value })}
              />
              <span className="text-sm font-bold num whitespace-nowrap">
                {money(vehicleQuote(catalog, v, mode, cadence).price)}
                {mode === "plan" && <span className="font-normal text-faint text-xs"> /visit</span>}
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => addVehicle(v)}
                  className="btn btn-sm px-2"
                  title="Duplicate vehicle"
                >
                  <IconPlus width={14} height={14} />
                </button>
                {vehicles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setVehicles((vs) => vs.filter((x) => x.key !== v.key))}
                    className="btn btn-sm px-2 text-bad"
                    title="Remove vehicle"
                  >
                    <IconX width={14} height={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => patch(v.key, { size: s.id })}
                  className={`min-h-9 rounded-md border px-1 py-1.5 text-[12px] font-medium leading-tight transition-colors duration-150 ${
                    v.size === s.id ? "bg-brand-wash border-brand text-brand-deep" : "bg-card border-line-2 hover:border-brand"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {catalog.addons.length > 0 && (
              <div className="mt-2.5">
                <p className="label mb-1.5">Add-ons</p>
                <div className="flex flex-wrap gap-1.5">
                  {catalog.addons.map((a) => {
                    const on = v.addons.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() =>
                          patch(v.key, { addons: on ? v.addons.filter((x) => x !== a.id) : [...v.addons, a.id] })
                        }
                        className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors duration-150 ${
                          on ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                        }`}
                      >
                        {a.name} <span className={`num ${on ? "text-white/80" : "text-faint"}`}>+{money(addonQuote(a, v.size).price)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={() => addVehicle()} className="btn mt-3 w-full">
        <IconPlus width={15} height={15} /> Add another vehicle
      </button>

      {/* Discount */}
      {vehicles.length > 1 && (
        <div className="mt-4 card p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">Multi-vehicle discount</p>
            <div className="flex gap-1.5">
              {DISCOUNT_CHOICES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDiscountOverride(d)}
                  className={`h-8 min-w-11 rounded-md border px-2 text-[13px] font-medium num transition-colors duration-150 ${
                    discountPct === d ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                  }`}
                >
                  {d}%
                </button>
              ))}
            </div>
          </div>
          {discountOverride === null && discountPct > 0 && (
            <p className="mt-1.5 text-xs text-faint">Auto-applied for {vehicles.length} vehicles — tap to change.</p>
          )}
        </div>
      )}

      {/* Running total + generate */}
      <div className="mt-4 card p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-ink-2">
            {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"} · ~{fmtHours(minutes)} on site
            {mode === "plan" ? " per visit" : ""}
          </span>
          <span className="num font-semibold">{money(subtotal)}</span>
        </div>
        {discountAmt > 0 && (
          <div className="flex items-baseline justify-between text-sm mt-1">
            <span className="text-ink-2">Discount ({discountPct}%)</span>
            <span className="num font-semibold text-ok">−{money(discountAmt)}</span>
          </div>
        )}
        <button type="button" onClick={() => setRevealed(true)} className="btn btn-primary w-full mt-3 h-12 text-[15px]">
          <IconSparkle width={17} height={17} /> Generate quote
        </button>
      </div>
    </div>
  );
}

/* ---------- Result screen: the number, revealed with some ceremony ---------- */

function QuoteResult({
  catalog,
  owner,
  mode,
  cadence,
  vehicles,
  quotes,
  subtotal,
  discountPct,
  discountAmt,
  total,
  visitsPerMonth,
  onBack,
  onReset,
}: {
  catalog: Catalog;
  owner: boolean;
  mode: Mode;
  cadence: PlanCadence;
  vehicles: QuoteVehicle[];
  quotes: { price: number; minutes: number }[];
  subtotal: number;
  discountPct: number;
  discountAmt: number;
  total: number;
  visitsPerMonth: number;
  onBack: () => void;
  onReset: () => void;
}) {
  const shown = useCountUp(total);
  useEffect(() => fireConfetti(), []);
  const cadenceLabel = CADENCES.find((c) => c.id === cadence)?.label ?? cadence;
  const minutes = quotes.reduce((s, q) => s + q.minutes, 0);

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-2xl">
      <div className="card p-6 text-center overflow-hidden">
        <p className="label">{mode === "plan" ? `Your quote — ${cadenceLabel.toLowerCase()}` : "Your quote"}</p>
        <p className="mt-2 text-5xl md:text-6xl font-bold num tracking-tight">{money(shown)}</p>
        <p className="mt-1.5 text-sm text-ink-2">
          {mode === "plan" ? (
            <>
              per visit · ≈ {money(Math.round(total * visitsPerMonth))}/month
            </>
          ) : (
            <>all-in, {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"}</>
          )}
        </p>
      </div>

      <div className="mt-3 card divide-y divide-line">
        {vehicles.map((v, i) => (
          <div key={v.key} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold truncate">{v.name.trim() || `Vehicle ${i + 1}`}</p>
              <p className="text-sm font-semibold num">{money(quotes[i].price)}</p>
            </div>
            <p className="text-xs text-ink-2 mt-0.5">
              {sizeLabel(v.size)}
              {v.addons.length > 0 &&
                ` · ${catalog.addons
                  .filter((a) => v.addons.includes(a.id))
                  .map((a) => a.name)
                  .join(", ")}`}
            </p>
          </div>
        ))}
        {discountAmt > 0 && (
          <div className="px-4 py-3 flex items-baseline justify-between text-sm">
            <p className="text-ink-2">Multi-vehicle discount ({discountPct}%)</p>
            <p className="num font-semibold text-ok">−{money(discountAmt)}</p>
          </div>
        )}
        <div className="px-4 py-3 flex items-baseline justify-between">
          <p className="font-semibold">{mode === "plan" ? "Total per visit" : "Total"}</p>
          <p className="font-bold num">{money(total)}</p>
        </div>
      </div>
      {discountAmt > 0 && subtotal !== total && (
        <p className="mt-2 text-xs text-faint text-center">
          Regular price {money(subtotal)} — they save {money(discountAmt)} every {mode === "plan" ? "visit" : "time"}.
        </p>
      )}

      {mode === "once" ? (
        <OneTimeFinder durationMin={minutes} />
      ) : (
        <PlanFinder durationMin={minutes} cadence={cadence} owner={owner} />
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onBack} className="btn grow">
          Adjust quote
        </button>
        <button type="button" onClick={onReset} className="btn grow">
          New quote
        </button>
      </div>
    </div>
  );
}

/* ---------- Availability: real open times from the calendar ---------- */

async function fetchSlots(date: string, durationMin: number): Promise<number[]> {
  const { data } = await createClient().rpc("get_available_slots", {
    p_date: date,
    p_duration_min: durationMin,
  });
  return ((data ?? []) as { slot_min: number }[]).map((r) => r.slot_min);
}

/** One-time: pick a day in the next two weeks, see the real open times. */
function OneTimeFinder({ durationMin }: { durationMin: number }) {
  const dates = Array.from({ length: 14 }, (_, i) => addDays(todayYmd(), i + 1));
  const [date, setDate] = useState(dates[0]);
  const [selMin, setSelMin] = useState<number | null>(null);
  const [cache, setCache] = useState<Record<string, number[]>>({});
  const slots = cache[date];

  useEffect(() => {
    if (cache[date]) return;
    let stale = false;
    fetchSlots(date, durationMin).then((s) => {
      if (!stale) setCache((c) => ({ ...c, [date]: s }));
    });
    return () => {
      stale = true;
    };
  }, [date, durationMin, cache]);

  return (
    <div className="mt-3 card p-4">
      <p className="font-semibold text-sm">Find a time</p>
      <p className="text-xs text-ink-2 mt-0.5">Open slots that fit {fmtHours(durationMin)}, next two weeks.</p>
      <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {dates.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => {
              setDate(d);
              setSelMin(null);
            }}
            className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ${
              date === d ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
            }`}
          >
            {fmtDateShort(d)}
          </button>
        ))}
      </div>
      <div className="mt-2.5">
        {slots === undefined ? (
          <div className="flex items-center gap-2.5 py-1 text-[13px] text-faint">
            <Wheel size={22} /> Checking the schedule…
          </div>
        ) : slots.length === 0 ? (
          <p className="text-sm text-faint">Nothing open this day — try another.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {slots.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSelMin(s)}
                className={`h-8 px-2.5 rounded-md border text-[13px] font-medium num transition-colors duration-150 ${
                  selMin === s ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                }`}
              >
                {minToLabel(s)}
              </button>
            ))}
          </div>
        )}
      </div>
      {selMin != null && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-ok-wash border border-[#bbe7c9] px-3 py-2.5">
          <p className="text-sm font-medium text-ok">
            {fmtDateShort(date)} at {minToLabel(selMin)} is open
          </p>
          <Link href={`/calendar?view=day&d=${date}&new=1`} className="btn btn-sm shrink-0">
            <IconCalendar width={14} height={14} /> Book it
          </Link>
        </div>
      )}
    </div>
  );
}

/** Recurring: ask time-of-day + days, then find times open across the next 6 visits. */
const VISITS_CHECKED = 6;
const STEP_DAYS: Record<PlanCadence, number> = { weekly: 7, biweekly: 14, monthly: 28, custom: 14 };
const DAYPARTS = [
  { id: "morning", label: "Morning", hint: "before 12", from: 0, to: 720 },
  { id: "afternoon", label: "Afternoon", hint: "12–4", from: 720, to: 960 },
  { id: "late", label: "Late day", hint: "after 4", from: 960, to: 1440 },
  { id: "any", label: "Anytime", hint: "", from: 0, to: 1440 },
];

interface DayResult {
  dow: number;
  firstDate: string;
  slots: { min: number; count: number }[]; // sorted best-first
}

function PlanFinder({ durationMin, cadence, owner }: { durationMin: number; cadence: PlanCadence; owner: boolean }) {
  const [part, setPart] = useState("any");
  const [days, setDays] = useState<number[]>([]);
  const [results, setResults] = useState<DayResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  const step = STEP_DAYS[cadence];
  const window_ = DAYPARTS.find((p) => p.id === part)!;

  const toggleDay = (d: number) => {
    setResults(null);
    setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]));
  };

  async function search() {
    setLoading(true);
    setResults(null);
    const dows = days.length ? [...days].sort() : [0, 1, 2, 3, 4, 5, 6];
    const found = await Promise.all(
      dows.map(async (dow) => {
        let first = addDays(todayYmd(), 1);
        while (weekdayOf(first) !== dow) first = addDays(first, 1);
        const dates = Array.from({ length: VISITS_CHECKED }, (_, i) => addDays(first, i * step));
        const perDate = await Promise.all(dates.map((d) => fetchSlots(d, durationMin)));
        const counts = new Map<number, number>();
        for (const slots of perDate)
          for (const s of slots) {
            if (s >= window_.from && s < window_.to) counts.set(s, (counts.get(s) ?? 0) + 1);
          }
        const slots = [...counts.entries()]
          .map(([min, count]) => ({ min, count }))
          .sort((a, b) => b.count - a.count || a.min - b.min)
          .slice(0, 4);
        return { dow, firstDate: first, slots };
      })
    );
    setResults(found.filter((r) => r.slots.length > 0).sort((a, b) => (b.slots[0]?.count ?? 0) - (a.slots[0]?.count ?? 0)));
    setLoading(false);
  }

  const best = results?.[0]?.slots[0]?.count === VISITS_CHECKED ? results[0] : null;

  return (
    <div className="mt-3 card p-4">
      <p className="font-semibold text-sm">Find a consistent time</p>
      <p className="text-xs text-ink-2 mt-0.5">
        Checks the calendar across the next {VISITS_CHECKED} {cadence === "weekly" ? "weekly" : cadence === "monthly" ? "monthly" : "biweekly"} visits.
      </p>

      <p className="label mt-3 mb-1.5">What time of day works for them?</p>
      <div className="grid grid-cols-4 gap-1.5">
        {DAYPARTS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPart(p.id);
              setResults(null);
            }}
            className={`min-h-9 rounded-md border px-1 py-1 text-[12px] font-medium leading-tight transition-colors duration-150 ${
              part === p.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
            }`}
          >
            {p.label}
            {p.hint && <span className={`block text-[10px] font-normal ${part === p.id ? "text-white/75" : "text-faint"}`}>{p.hint}</span>}
          </button>
        ))}
      </div>

      <p className="label mt-3 mb-1.5">Which days could work? (blank = any day)</p>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS_SHORT.map((label, d) => (
          <button
            key={d}
            type="button"
            onClick={() => toggleDay(d)}
            className={`h-9 rounded-md border text-[12px] font-medium transition-colors duration-150 ${
              days.includes(d) ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button type="button" onClick={search} disabled={loading} className="btn btn-primary w-full mt-3">
        {loading ? (
          <>
            <Wheel size={18} /> Checking {(days.length || 7) * VISITS_CHECKED} calendar days…
          </>
        ) : (
          "Find times"
        )}
      </button>

      {results && results.length === 0 && (
        <p className="mt-3 text-sm text-warn bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2">
          Nothing fits {fmtHours(durationMin)} in that window — try a different time of day or more days.
        </p>
      )}
      {results && results.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {best && (
            <p className="text-sm font-medium text-ok bg-ok-wash border border-[#bbe7c9] rounded-md px-3 py-2">
              Best bet: {WEEKDAYS[best.dow]}s at {minToLabel(best.slots[0].min)} — open for all {VISITS_CHECKED} upcoming
              visits (starting {fmtDateShort(best.firstDate)}).
            </p>
          )}
          {results.map((r) => (
            <div key={r.dow} className="rounded-md border border-line px-3 py-2.5">
              <p className="text-[13px] font-semibold">{WEEKDAYS[r.dow]}s</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {r.slots.map((s) => (
                  <span
                    key={s.min}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                      s.count === VISITS_CHECKED ? "bg-brand-wash border-brand/40" : "bg-card border-line-2"
                    }`}
                  >
                    <span className={`text-[13px] font-semibold num ${s.count === VISITS_CHECKED ? "text-brand-deep" : "text-ink-2"}`}>
                      {minToLabel(s.min)}
                    </span>
                    <span className={`text-[10px] font-medium uppercase tracking-wide ${s.count === VISITS_CHECKED ? "text-ok" : "text-faint"}`}>
                      {s.count === VISITS_CHECKED ? "every visit" : `${s.count} of ${VISITS_CHECKED}`}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {owner && (
            <Link href="/plans?new=1" className="btn mt-1">
              <IconCalendar width={15} height={15} /> Set up the plan
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf: number;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3)))); // ease-out cubic
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// Tiny canvas confetti — no library. Fires once, cleans itself up.
function fireConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  const colors = ["#2563eb", "#7fb0ff", "#15803d", "#f59e0b", "#e8edf4"];
  const parts = Array.from({ length: 150 }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -10 : canvas.width + 10,
      y: canvas.height * (0.35 + Math.random() * 0.3),
      vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 7),
      vy: -(6 + Math.random() * 7),
      size: 5 + Math.random() * 5,
      color: colors[i % colors.length],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    };
  });
  const t0 = performance.now();
  const tick = (t: number) => {
    const done = t - t0 > 2800;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.25; // gravity
      p.vx *= 0.99;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - (t - t0) / 2800);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (done) canvas.remove();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
