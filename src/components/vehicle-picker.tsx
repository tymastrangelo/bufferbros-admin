"use client";

// Pick which of a customer's cars a visit covers — and add a new car inline,
// which saves straight to the customer so it shows on their profile too.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SIZES, vehicleLabel, type SizeId, type Vehicle } from "@/lib/types";

const SIZE_SHORT: Record<SizeId, string> = { sedan: "Sedan", midsize: "Midsize", large: "Large" };

export function VehiclePicker({
  customerId,
  vehicles,
  selected,
  onChange,
  onVehiclesChange,
  allowAdd = true,
}: {
  customerId: string;
  vehicles: Vehicle[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** New inline-added vehicles get appended through here so the parent's list stays current. */
  onVehiclesChange?: (vehicles: Vehicle[]) => void;
  allowAdd?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [sizeId, setSizeId] = useState<SizeId>("sedan");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function addVehicle() {
    setError(null);
    setSaving(true);
    const { data, error: err } = await supabase
      .from("vehicles")
      .insert({ customer_id: customerId, size_id: sizeId, make: make.trim() || null, model: model.trim() || null })
      .select("*")
      .single();
    setSaving(false);
    if (err || !data) {
      setError(err?.message ?? "Couldn't save the vehicle.");
      return;
    }
    const v = data as Vehicle;
    onVehiclesChange?.([...vehicles, v]);
    onChange([...selected, v.id]);
    setAdding(false);
    setMake("");
    setModel("");
  }

  return (
    <div className="flex flex-col gap-1">
      {vehicles.map((v) => (
        <label key={v.id} className="flex items-center gap-2.5 text-sm py-0.5">
          <input
            type="checkbox"
            checked={selected.includes(v.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, v.id] : selected.filter((id) => id !== v.id))}
          />
          <span className="grow truncate">{vehicleLabel(v)}</span>
          <span className="text-xs text-faint shrink-0">{SIZE_SHORT[v.size_id] ?? v.size_id}</span>
        </label>
      ))}
      {vehicles.length === 0 && !adding && <p className="text-[13px] text-faint">No vehicles on file yet.</p>}
      {allowAdd &&
        (adding ? (
          <div className="mt-1 border border-line-2 rounded-md p-2.5 flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSizeId(s.id)}
                  className={`h-8 rounded-md border text-[12px] font-medium transition-colors duration-150 ${
                    sizeId === s.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                  }`}
                >
                  {SIZE_SHORT[s.id]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Make (optional)" value={make} onChange={(e) => setMake(e.target.value)} />
              <input className="input" placeholder="Model (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            {error && <p className="text-[13px] text-bad">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={addVehicle}>
                {saving ? "Saving…" : "Add vehicle"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="self-start text-[13px] text-brand-deep underline underline-offset-2"
            onClick={() => setAdding(true)}
          >
            + Add a vehicle
          </button>
        ))}
    </div>
  );
}
