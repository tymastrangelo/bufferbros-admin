"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wheel } from "@/components/brand";
import { createPlan, updatePlan, type PlanFields } from "@/lib/actions/plans";
import { BOAT_MAINTENANCE_ID, boatQuote, initialDetailPrice, planPrice, visitsPerQuarter, type Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { labelToMin, minToLabel, todayYmd, WEEKDAYS } from "@/lib/time";
import { PAYMENT_METHODS, type PaymentMethod, type Plan, type PlanCadence, type SizeId, type Vehicle } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { VehiclePicker } from "./vehicle-picker";
import { ErrorNote, Field, Sheet } from "./ui";

const CADENCES: { id: PlanCadence; label: string }[] = [
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly", label: "Monthly" },
  { id: "custom", label: "Custom" },
];

export function PlanFormSheet({
  open,
  onClose,
  catalog,
  plan,
  defaultCustomer,
  upcomingCount = 0,
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog;
  plan?: (Plan & { vehicles?: Vehicle[] }) | null;
  defaultCustomer?: PickedCustomer | null;
  /** scheduled future visits on this plan — drives the "apply to visits?" ask */
  upcomingCount?: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [customer, setCustomer] = useState<PickedCustomer | null>(defaultCustomer ?? null);
  const [vehicles, setVehicles] = useState<Vehicle[]>(defaultCustomer?.vehicles ?? []);
  const [vehicleIds, setVehicleIds] = useState<string[]>(
    plan?.vehicle_id ? [plan.vehicle_id] : defaultCustomer?.vehicles?.[0] ? [defaultCustomer.vehicles[0].id] : []
  );
  const [cadence, setCadence] = useState<PlanCadence>(plan?.cadence ?? "biweekly");
  const [intervalDays, setIntervalDays] = useState(plan?.interval_days ? String(plan.interval_days) : "21");
  const [price, setPrice] = useState(plan ? String(plan.per_visit_price) : "");
  const [dow, setDow] = useState<string>(plan?.preferred_dow != null ? String(plan.preferred_dow) : "");
  const [time, setTime] = useState(plan?.preferred_min != null ? minToLabel(plan.preferred_min) : "9:00 AM");
  const [duration, setDuration] = useState(String(plan?.duration_min ?? 120));
  const [address, setAddress] = useState(plan?.address ?? defaultCustomer?.addresses?.[0]?.address ?? "");
  const [startsOn, setStartsOn] = useState(plan?.starts_on ?? todayYmd());
  const [endsOn, setEndsOn] = useState(plan?.ends_on ?? "");
  const [billingNote, setBillingNote] = useState(plan?.billing_note ?? "");
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [emailConf, setEmailConf] = useState(plan?.email_confirmations ?? false);
  const [skipEntry, setSkipEntry] = useState(plan?.skip_entry ?? false);
  const [prepay, setPrepay] = useState(false);
  const [prepayVisits, setPrepayVisits] = useState("");
  const [prepayMethod, setPrepayMethod] = useState<PaymentMethod>("zelle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmApply, setConfirmApply] = useState<PlanFields | null>(null);

  // For editing, load the plan's customer + vehicles (and which cars the plan covers) once.
  useEffect(() => {
    if (!plan || customer) return;
    (async () => {
      const [{ data }, pvQ] = await Promise.all([
        supabase.from("customers").select("*, vehicles(*)").eq("id", plan.customer_id).single(),
        supabase.from("plan_vehicles").select("vehicle_id").eq("plan_id", plan.id),
      ]);
      if (data) {
        setCustomer(data as PickedCustomer);
        setVehicles((data as PickedCustomer).vehicles ?? []);
      }
      const ids = ((pvQ.data ?? []) as { vehicle_id: string }[]).map((r) => r.vehicle_id);
      if (ids.length) setVehicleIds(ids);
    })();
  }, [plan, customer, supabase]);

  if (!open) return null;

  // Entry-detail pricing is a car thing — boats join plans at the maintenance-wash rate.
  const sizesOf = (ids: string[]): SizeId[] =>
    vehicles.filter((v) => ids.includes(v.id) && v.kind !== "boat").map((v) => v.size_id);
  const firstSize: SizeId = sizesOf(vehicleIds)[0] ?? "sedan";
  const multiPct = vehicleIds.length > 1 ? catalog.rules.multiCarDiscountPct : 0;

  const boatMaintenance = (v: Vehicle) => boatQuote(catalog, v.length_ft, { componentIds: [BOAT_MAINTENANCE_ID] });

  /** Cars at their plan price + boats at the maintenance wash rate, minus the multi-vehicle discount. */
  function suggestPrice(nextCadence: PlanCadence, ids: string[]) {
    if (nextCadence === "custom") return;
    const sel = vehicles.filter((v) => ids.includes(v.id));
    if (!sel.length) return;
    const carPrices = sel.filter((v) => v.kind !== "boat").map((v) => planPrice(catalog, nextCadence, v.size_id));
    if (carPrices.some((p) => p == null)) return;
    const raw =
      (carPrices as number[]).reduce((s, p) => s + p, 0) +
      sel.filter((v) => v.kind === "boat").reduce((s, v) => s + boatMaintenance(v).price, 0);
    const pct = ids.length > 1 ? catalog.rules.multiCarDiscountPct : 0;
    setPrice(String(Math.round(raw * (1 - pct / 100))));
  }

  function suggestDuration(ids: string[]) {
    const mins = vehicles
      .filter((v) => ids.includes(v.id))
      .map((v) => (v.kind === "boat" ? boatMaintenance(v).minutes || 60 : catalog.detail[v.size_id]?.minutes ?? 120));
    if (mins.length) setDuration(String(mins.reduce((a, b) => a + b, 0)));
  }

  function pickVehicles(ids: string[]) {
    setVehicleIds(ids);
    suggestDuration(ids);
    suggestPrice(cadence, ids);
  }

  function pickCustomer(c: PickedCustomer | null) {
    setCustomer(c);
    setVehicles(c?.vehicles ?? []);
    setVehicleIds([]);
    if (c) {
      if (!address) setAddress(c.addresses?.[0]?.address ?? "");
      const v = c.vehicles?.[0];
      if (v) {
        setVehicleIds([v.id]);
        if (v.kind === "boat") {
          const q = boatMaintenance(v);
          setDuration(String(q.minutes || 60));
          if (!plan && q.price) setPrice(String(q.price));
        } else {
          setDuration(String(catalog.detail[v.size_id]?.minutes ?? 120));
          if (!plan) {
            const p = planPrice(catalog, cadence, v.size_id);
            if (p != null) setPrice(String(p));
          }
        }
      }
    }
  }

  function buildFields(): PlanFields | null {
    setError(null);
    if (!customer && !plan) {
      setError("Pick a customer.");
      return null;
    }
    const preferredMin = labelToMin(time);
    if (time && preferredMin == null) {
      setError("Time should look like 9:00 AM.");
      return null;
    }
    const prepayN = Math.floor(Number(prepayVisits) || 0);
    if (!plan && prepay) {
      if (!(Number(price) > 0)) {
        setError("Set the per-visit price before recording an upfront payment.");
        return null;
      }
      if (prepayN < 1) {
        setError("How many visits are they paying for upfront?");
        return null;
      }
    }
    return {
      customerId: plan?.customer_id ?? customer!.id,
      vehicleIds,
      cadence,
      intervalDays: Number(intervalDays) || null,
      perVisitPrice: Number(price) || 0,
      preferredDow: dow === "" ? null : Number(dow),
      preferredMin,
      durationMin: Number(duration) || 120,
      address,
      startsOn,
      endsOn: endsOn || null,
      billingNote,
      notes,
      emailConfirmations: emailConf,
      skipEntry,
      prepay: !plan && prepay ? { visits: prepayN, method: prepayMethod } : null,
    };
  }

  /** did price / duration / time / address change vs the saved plan? */
  function visitFieldsChanged(f: PlanFields): boolean {
    if (!plan) return false;
    return (
      f.perVisitPrice !== Number(plan.per_visit_price) ||
      f.durationMin !== plan.duration_min ||
      (f.preferredMin ?? null) !== (plan.preferred_min ?? null) ||
      ((f.address ?? "").trim() || null) !== (plan.address ?? null)
    );
  }

  function submit() {
    const fields = buildFields();
    if (!fields) return;
    if (plan && upcomingCount > 0 && visitFieldsChanged(fields)) {
      setConfirmApply(fields); // ask before touching the calendar
      return;
    }
    void doSave(fields, false);
  }

  async function doSave(fields: PlanFields, applyToScheduled: boolean) {
    setPending(true);
    const res = plan ? await updatePlan(plan.id, fields, applyToScheduled) : await createPlan(fields);
    setPending(false);
    if (!res.ok) {
      setConfirmApply(null);
      return setError(res.error);
    }
    if (!plan && res.id) {
      const pe = (res as { prepayError?: string }).prepayError;
      if (pe) window.alert(`Plan created, but recording the upfront payment failed: ${pe} — use “Record prepay” on the plan page.`);
      // navigate straight to the new plan — don't run onClose's URL rewrite first
      router.push(`/plans/${res.id}`);
    } else {
      onClose();
      router.refresh();
    }
  }

  return (
    <Sheet open onClose={onClose} title={plan ? "Edit plan" : "New plan"}>
      <div className="flex flex-col gap-4">
        {!plan && (
          <Field label="Customer">
            <CustomerPicker value={customer} onChange={pickCustomer} autoFocus />
          </Field>
        )}

        {customer && (
          <Field
            label={`Vehicles${vehicleIds.length > 1 ? ` — ${vehicleIds.length} cars per visit` : ""}`}
            hint={multiPct > 0 ? `${multiPct}% multi-car discount applies to the suggested price` : undefined}
          >
            <VehiclePicker
              customerId={customer.id}
              vehicles={vehicles}
              selected={vehicleIds}
              onChange={pickVehicles}
              onVehiclesChange={setVehicles}
            />
          </Field>
        )}

        {!plan &&
          (() => {
            const sizes = sizesOf(vehicleIds);
            const entryPrice = (sizes.length ? sizes : [firstSize]).reduce((s, size) => s + initialDetailPrice(catalog, size), 0);
            return (
              <Field label="Getting started">
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSkipEntry(false)}
                    className={`card p-3 text-left transition-colors duration-150 ${!skipEntry ? "border-brand" : "hover:border-brand"}`}
                  >
                    <p className="text-sm font-semibold">
                      Entry detail first — <span className="num">{money(entryPrice)}</span>
                    </p>
                    <p className="text-[12px] text-ink-2 mt-0.5">
                      Full Standard Detail at {catalog.rules.planInitialDiscountPct}% off to get the car to maintenance
                      shape — book it as a one-time job before visits start.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSkipEntry(true)}
                    className={`card p-3 text-left transition-colors duration-150 ${skipEntry ? "border-brand" : "hover:border-brand"}`}
                  >
                    <p className="text-sm font-semibold">Straight to maintenance</p>
                    <p className="text-[12px] text-ink-2 mt-0.5">
                      Skip the entry detail — the car&apos;s already in shape, visits start at the plan rate.
                    </p>
                  </button>
                </div>
              </Field>
            );
          })()}

        <Field label="Cadence">
          <div className="grid grid-cols-2 gap-1.5">
            {CADENCES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCadence(c.id);
                  suggestPrice(c.id, vehicleIds);
                }}
                className={`h-9 rounded-md border text-[13px] font-medium transition-colors duration-150 ${
                  cadence === c.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </Field>
        {cadence === "custom" && (
          <Field label="Every N days">
            <input type="number" min={1} className="input num" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Per-visit price" hint="Auto-suggested from plan pricing — adjust per customer">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" min={0} className="input num pl-7" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </Field>
          <Field label="Duration (min)">
            <input type="number" min={15} step={15} className="input num" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </Field>
        </div>
        {!plan && (
          <Field label="Billing">
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { v: false, label: "Collects per visit" },
                { v: true, label: "Pays upfront" },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => {
                    setPrepay(o.v);
                    if (o.v && !prepayVisits) setPrepayVisits(String(visitsPerQuarter(cadence, Number(intervalDays) || null)));
                  }}
                  className={`h-9 rounded-md border text-[13px] font-medium transition-colors duration-150 ${
                    prepay === o.v ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Field>
        )}
        {!plan &&
          prepay &&
          (() => {
            const per = Number(price) || 0;
            const q = visitsPerQuarter(cadence, Number(intervalDays) || null);
            const n = Math.max(0, Math.floor(Number(prepayVisits) || 0));
            const qualifies = n >= q;
            const discount = qualifies ? Math.round((per * n * catalog.rules.prepayDiscountPct) / 100) : 0;
            const due = per * n - discount;
            return (
              <div className="flex flex-col gap-2 -mt-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { label: "Quarter", mult: 1 },
                    { label: "Half year", mult: 2 },
                    { label: "Full year", mult: 4 },
                  ].map((b) => {
                    const bn = q * b.mult;
                    const total = Math.round(per * bn * (1 - catalog.rules.prepayDiscountPct / 100));
                    return (
                      <button
                        key={b.label}
                        type="button"
                        onClick={() => setPrepayVisits(String(bn))}
                        className={`chip cursor-pointer num ${n === bn ? "bg-ink text-white" : "bg-[#f1f4f9] text-ink-2 hover:bg-line"}`}
                      >
                        {b.label} · {bn}v{per > 0 ? ` · ${money(total)}` : ""}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Visits paid upfront">
                    <input
                      type="number"
                      min={1}
                      className="input num"
                      value={prepayVisits}
                      onChange={(e) => setPrepayVisits(e.target.value)}
                    />
                  </Field>
                  <Field label="Paying via">
                    <select className="select" value={prepayMethod} onChange={(e) => setPrepayMethod(e.target.value as PaymentMethod)}>
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m[0].toUpperCase() + m.slice(1)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {n > 0 && per > 0 && (
                  <p className="text-[13px] text-ink-2 num">
                    {n} × {money(per)}
                    {discount > 0 ? ` − ${catalog.rules.prepayDiscountPct}%` : ""} ={" "}
                    <span className="font-semibold text-ink">{money(due)}</span> onto their balance when you save
                    {!qualifies ? ` — under ${q} visits, so no prepay discount` : ""}.
                  </p>
                )}
              </div>
            );
          })()}
        {Number(price) > 0 &&
          !prepay &&
          (() => {
            const q = visitsPerQuarter(cadence, Number(intervalDays) || null);
            const block = (n: number) => money(Math.round(Number(price) * n * (1 - catalog.rules.prepayDiscountPct / 100)));
            return (
              <p className="text-[13px] text-ink-2 -mt-1.5 num">
                Paying upfront saves {catalog.rules.prepayDiscountPct}%: quarter ({q}v) {block(q)} · half year {block(q * 2)} · full
                year {block(q * 4)}
                {plan ? " — record it from the plan page." : " — switch Billing to “Pays upfront” to record it now."}
              </p>
            );
          })()}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Preferred day">
            <select className="select" value={dow} onChange={(e) => setDow(e.target.value)}>
              <option value="">No preference</option>
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Preferred time">
            <input className="input num" placeholder="9:00 AM" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>

        <Field label="Address">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input type="date" className="input num" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label="Ends (optional)">
            <input type="date" className="input num" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>

        <Field label="Billing note" hint="e.g. pays monthly · prepaid through Dec 2026">
          <input className="input" value={billingNote} onChange={(e) => setBillingNote(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={emailConf} onChange={(e) => setEmailConf(e.target.checked)} />
          Email a confirmation for each generated visit
        </label>

        <ErrorNote>{error}</ErrorNote>
        {confirmApply ? (
          <div className="card p-4 flex flex-col gap-3 bg-surface">
            <p className="text-sm">
              This plan already has{" "}
              <span className="font-semibold">
                {upcomingCount} scheduled visit{upcomingCount === 1 ? "" : "s"}
              </span>{" "}
              on the calendar. Apply the new price, duration, time and address to them too?
            </p>
            <button className="btn btn-primary h-11" disabled={pending} onClick={() => doSave(confirmApply, true)}>
              {pending ? (
                <>
                  <Wheel size={18} /> Saving…
                </>
              ) : (
                `Save + update ${upcomingCount} visit${upcomingCount === 1 ? "" : "s"}`
              )}
            </button>
            <button className="btn" disabled={pending} onClick={() => doSave(confirmApply, false)}>
              Save — future visits only
            </button>
            <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setConfirmApply(null)}>
              Back
            </button>
          </div>
        ) : (
          <button className="btn btn-primary h-11" onClick={submit} disabled={pending}>
            {pending ? (
              <>
                <Wheel size={18} /> Saving…
              </>
            ) : plan ? (
              "Save plan"
            ) : (
              "Create plan"
            )}
          </button>
        )}
      </div>
    </Sheet>
  );
}
