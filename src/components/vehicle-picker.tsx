"use client";

// Pick which of a customer's cars/boats a visit covers — and add a new one inline,
// which saves straight to the customer so it shows on their profile too.
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SIZES, vehicleLabel, type SizeId, type Vehicle } from "@/lib/types";
import { Busy } from "./ui";
import { IconPlus } from "./icons";

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
  const [kind, setKind] = useState<"car" | "boat">("car");
  const [sizeId, setSizeId] = useState<SizeId>("sedan");
  const [lengthFt, setLengthFt] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [color, setColor] = useState("");
  const [plate, setPlate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function addVehicle() {
    setError(null);
    if (kind === "boat" && !(Number(lengthFt) > 0)) {
      setError("How long is the boat? Pricing runs per foot.");
      return;
    }
    setSaving(true);
    const { data, error: err } = await supabase
      .from("vehicles")
      .insert({
        customer_id: customerId,
        size_id: sizeId,
        kind,
        length_ft: kind === "boat" ? Number(lengthFt) : null,
        make: make.trim() || null,
        model: model.trim() || null,
        year: Number(year) >= 1900 ? Number(year) : null,
        color: color.trim() || null,
        plate: plate.trim().toUpperCase() || null,
      })
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
    setYear("");
    setColor("");
    setPlate("");
    setLengthFt("");
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
          <span className="grow truncate">
            {vehicleLabel(v)}
            {(v.color || v.plate) && (
              <span className="text-xs text-faint">
                {v.color ? ` · ${v.color}` : ""}
                {v.plate ? ` · ${v.plate}` : ""}
              </span>
            )}
          </span>
          <span className="text-xs text-faint shrink-0">
            {v.kind === "boat" ? (v.length_ft ? `${v.length_ft} ft boat` : "Boat") : SIZE_SHORT[v.size_id] ?? v.size_id}
          </span>
        </label>
      ))}
      {vehicles.length === 0 && !adding && <p className="text-dense text-faint">No vehicles on file yet.</p>}
      {allowAdd &&
        (adding ? (
          <div className="mt-1 border border-line-2 rounded-md p-2.5 flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-1.5">
              {(["car", "boat"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className="choice h-8 text-xs capitalize" aria-pressed={kind === k}
                >
                  {k}
                </button>
              ))}
            </div>
            {kind === "car" ? (
              <div className="grid grid-cols-3 gap-1.5">
                {SIZES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSizeId(s.id)}
                    className="choice h-8 text-xs" aria-pressed={sizeId === s.id}
                  >
                    {SIZE_SHORT[s.id]}
                  </button>
                ))}
              </div>
            ) : (
              <input
                type="number"
                min={1}
                className="input num h-8!"
                placeholder="Length in feet — drives the price"
                value={lengthFt}
                onChange={(e) => setLengthFt(e.target.value)}
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <input className="input" placeholder="Make (optional)" value={make} onChange={(e) => setMake(e.target.value)} />
              <input className="input" placeholder="Model (optional)" value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input className="input num" inputMode="numeric" placeholder="Year" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year" />
              <input className="input" placeholder="Color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" />
              <input className="input" placeholder="Plate" value={plate} onChange={(e) => setPlate(e.target.value)} aria-label="Plate" />
            </div>
            {error && <p className="text-dense text-bad">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-sm" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={addVehicle}>
                {saving ? <Busy>Saving…</Busy> : kind === "boat" ? "Add boat" : "Add vehicle"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="self-start add-link"
            onClick={() => setAdding(true)}
          >
            <IconPlus width={13} height={13} />
            Add a vehicle or boat
          </button>
        ))}
    </div>
  );
}
