"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wheel } from "@/components/brand";
import { createPlan, updatePlan, type PlanFields } from "@/lib/actions/plans";
import { initialDetailPrice, planPrice, type Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { labelToMin, minToLabel, todayYmd, WEEKDAYS } from "@/lib/time";
import type { Plan, PlanCadence, SizeId, Vehicle } from "@/lib/types";
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

  const sizesOf = (ids: string[]): SizeId[] => vehicles.filter((v) => ids.includes(v.id)).map((v) => v.size_id);
  const firstSize: SizeId = sizesOf(vehicleIds)[0] ?? "sedan";
  const multiPct = vehicleIds.length > 1 ? catalog.rules.multiCarDiscountPct : 0;

  /** Sum of per-size plan prices, minus the multi-car discount when 2+ cars share the visit. */
  function suggestPrice(nextCadence: PlanCadence, ids: string[]) {
    if (nextCadence === "custom") return;
    const prices = sizesOf(ids).map((s) => planPrice(catalog, nextCadence, s));
    if (!prices.length || prices.some((p) => p == null)) return;
    const raw = (prices as number[]).reduce((s, p) => s + p, 0);
    const pct = ids.length > 1 ? catalog.rules.multiCarDiscountPct : 0;
    setPrice(String(Math.round(raw * (1 - pct / 100))));
  }

  function suggestDuration(ids: string[]) {
    const mins = sizesOf(ids).map((s) => catalog.detail[s]?.minutes ?? 120);
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
        setDuration(String(catalog.detail[v.size_id]?.minutes ?? 120));
        if (!plan) {
          const p = planPrice(catalog, cadence, v.size_id);
          if (p != null) setPrice(String(p));
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

        {!plan && (
          <p className="text-[13px] bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2.5">
            New plan clients get an initial full Standard Detail at {catalog.rules.planInitialDiscountPct}% off (
            <span className="num font-medium">{money(initialDetailPrice(catalog, firstSize))}</span> for this size) to
            bring the car to maintenance shape — book it as a one-time job before the plan starts.
          </p>
        )}

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
