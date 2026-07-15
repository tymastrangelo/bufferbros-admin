"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPlan, updatePlan, type PlanFields } from "@/lib/actions/plans";
import { planPrice, type Catalog } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/client";
import { labelToMin, minToLabel, todayYmd, WEEKDAYS } from "@/lib/time";
import type { Plan, PlanCadence, SizeId, Vehicle } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
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
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog;
  plan?: (Plan & { vehicles?: Vehicle[] }) | null;
  defaultCustomer?: PickedCustomer | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [customer, setCustomer] = useState<PickedCustomer | null>(defaultCustomer ?? null);
  const [vehicles, setVehicles] = useState<Vehicle[]>(defaultCustomer?.vehicles ?? []);
  const [vehicleId, setVehicleId] = useState<string | "">(plan?.vehicle_id ?? "");
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

  // For editing, load the plan's customer + vehicles once.
  useEffect(() => {
    if (!plan || customer) return;
    (async () => {
      const { data } = await supabase.from("customers").select("*, vehicles(*)").eq("id", plan.customer_id).single();
      if (data) {
        setCustomer(data as PickedCustomer);
        setVehicles((data as PickedCustomer).vehicles ?? []);
      }
    })();
  }, [plan, customer, supabase]);

  if (!open) return null;

  const sizeOf = (vid: string): SizeId =>
    (vehicles.find((v) => v.id === vid)?.size_id as SizeId) ?? "sedan";

  function suggestPrice(nextCadence: PlanCadence, vid: string) {
    if (nextCadence === "custom") return;
    const p = planPrice(catalog, nextCadence, sizeOf(vid));
    if (p != null) setPrice(String(p));
  }

  function pickCustomer(c: PickedCustomer | null) {
    setCustomer(c);
    setVehicles(c?.vehicles ?? []);
    if (c) {
      if (!address) setAddress(c.addresses?.[0]?.address ?? "");
      const v = c.vehicles?.[0];
      if (v) {
        setVehicleId(v.id);
        setDuration(String(catalog.detail[v.size_id]?.minutes ?? 120));
        if (!plan) suggestPrice(cadence, v.id);
      }
    }
  }

  async function submit() {
    setError(null);
    if (!customer && !plan) return setError("Pick a customer.");
    const preferredMin = labelToMin(time);
    if (time && preferredMin == null) return setError("Time should look like 9:00 AM.");
    setPending(true);
    const fields: PlanFields = {
      customerId: plan?.customer_id ?? customer!.id,
      vehicleId: vehicleId || null,
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
    const res = plan ? await updatePlan(plan.id, fields) : await createPlan(fields);
    setPending(false);
    if (!res.ok) return setError(res.error);
    onClose();
    if (!plan && res.id) router.push(`/plans/${res.id}`);
    else router.refresh();
  }

  return (
    <Sheet open onClose={onClose} title={plan ? "Edit plan" : "New plan"}>
      <div className="flex flex-col gap-4">
        {!plan && (
          <Field label="Customer">
            <CustomerPicker value={customer} onChange={pickCustomer} autoFocus />
          </Field>
        )}

        {vehicles.length > 0 && (
          <Field label="Vehicle">
            <select
              className="select"
              value={vehicleId}
              onChange={(e) => {
                setVehicleId(e.target.value);
                setDuration(String(catalog.detail[sizeOf(e.target.value)]?.minutes ?? 120));
                suggestPrice(cadence, e.target.value);
              }}
            >
              <option value="">No specific vehicle</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {[v.year, v.make, v.model].filter(Boolean).join(" ") || v.size_id}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Cadence">
          <div className="grid grid-cols-2 gap-1.5">
            {CADENCES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCadence(c.id);
                  suggestPrice(c.id, vehicleId);
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
        <button className="btn btn-primary h-11" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : plan ? "Save plan" : "Create plan"}
        </button>
      </div>
    </Sheet>
  );
}
