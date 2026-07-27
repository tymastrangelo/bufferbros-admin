"use client";

// New-appointment sheet: phone bookings, walk-ups, and calendar taps all land here.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Wheel } from "@/components/brand";
import { createAppointment } from "@/lib/actions/appointments";
import { addonQuote, boatQuote, boatRatePerFt, computeQuote, computeVehiclesQuote, type BaseService, type Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { todayYmd } from "@/lib/time";
import { useOwner } from "@/lib/use-owner";
import { SIZES, sizeLabel, vehicleLabel, type Employee, type SizeId, type Vehicle } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { SlotPicker } from "./slot-picker";
import { VehiclePicker } from "./vehicle-picker";
import { ErrorNote, Field, Sheet } from "./ui";

export function AppointmentSheet({
  open,
  onClose,
  catalog,
  defaultDate,
  defaultStartMin,
  defaultCustomer,
  defaultKind = "car",
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog;
  defaultDate?: string;
  defaultStartMin?: number;
  defaultCustomer?: PickedCustomer | null;
  /** "boat" opens the boat-detail flow: boats preselected, per-foot pricing, no car add-ons. */
  defaultKind?: "car" | "boat";
}) {
  const boatMode = defaultKind === "boat";
  /** The vehicle a picked customer starts with — their first boat in boat mode, first car otherwise. */
  const preferredVehicle = (list: Vehicle[] | undefined) =>
    list?.find((v) => (boatMode ? v.kind === "boat" : v.kind !== "boat")) ?? list?.[0];
  const router = useRouter();
  const owner = useOwner();
  // Who's doing the job: [] = "Me" (the owner books against the business calendar
  // only); worker ids narrow the slot grid to times they're ALL free. A washer
  // booking is auto-assigned to themselves (their RLS-visible row is just their own).
  const [assignees, setAssignees] = useState<string[]>([]);
  const [workers, setWorkers] = useState<Pick<Employee, "id" | "name" | "active" | "user_id">[]>([]);
  useEffect(() => {
    let stale = false;
    (async () => {
      const db = createClient();
      const [{ data: rows }, { data: sess }] = await Promise.all([
        db.from("employees").select("id,name,active,user_id").eq("active", true).order("created_at"),
        db.auth.getSession(),
      ]);
      if (stale) return;
      const list = (rows as Pick<Employee, "id" | "name" | "active" | "user_id">[]) ?? [];
      setWorkers(list);
      // A washer booking a job is the one doing it — self-assign their row.
      const mine = list.find((w) => w.user_id === sess.session?.user.id);
      if (sess.session?.user.app_metadata?.role !== "owner" && mine) {
        setAssignees((cur) => (cur.length ? cur : [mine.id]));
      }
    })();
    return () => {
      stale = true;
    };
  }, []);
  const [customer, setCustomer] = useState<PickedCustomer | null>(defaultCustomer ?? null);
  const [oneOff, setOneOff] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState(defaultCustomer?.addresses?.[0]?.address ?? "");
  const [sizeId, setSizeId] = useState<SizeId>(defaultCustomer?.vehicles?.[0]?.size_id ?? "sedan");
  const [boatFt, setBoatFt] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>(defaultCustomer?.vehicles ?? []);
  const [vehicleIds, setVehicleIds] = useState<string[]>(() => {
    const v = preferredVehicle(defaultCustomer?.vehicles);
    return v ? [v.id] : [];
  });
  const [service, setService] = useState<BaseService>("standard");
  const [garageOk, setGarageOk] = useState(false);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [date, setDate] = useState(defaultDate ?? todayYmd());
  const [startMin, setStartMin] = useState<number | null>(defaultStartMin ?? null);
  const [offGrid, setOffGrid] = useState(false);
  const [priceOverride, setPriceOverride] = useState<string>("");
  const [durationOverride, setDurationOverride] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selVehicles = useMemo(() => vehicles.filter((v) => vehicleIds.includes(v.id)), [vehicles, vehicleIds]);
  const selCars = useMemo(() => selVehicles.filter((v) => v.kind !== "boat"), [selVehicles]);
  const selBoats = useMemo(() => selVehicles.filter((v) => v.kind === "boat"), [selVehicles]);
  const boatsOnly = selVehicles.length > 0 && selCars.length === 0;
  const mixed = selCars.length > 0 && selBoats.length > 0;
  // Boat-flavored booking: boats selected, or boat mode quoting a bare length.
  const boatish = boatsOnly || (boatMode && selVehicles.length === 0);
  const quote = useMemo(
    () =>
      selVehicles.length
        ? computeVehiclesQuote(catalog, selVehicles, addonIds, service)
        : boatMode
          ? boatQuote(catalog, Number(boatFt) || null)
          : computeQuote(catalog, sizeId, addonIds, service),
    [catalog, selVehicles, sizeId, addonIds, service, boatMode, boatFt]
  );
  const ceramic = service === "ceramic" && catalog.ceramic;
  const price = priceOverride !== "" ? Number(priceOverride) : quote.price;
  const duration = durationOverride !== "" ? Number(durationOverride) : quote.minutes;
  const contactEmail = customer?.email || email;

  function pickCustomer(c: PickedCustomer | null) {
    setCustomer(c);
    setVehicles(c?.vehicles ?? []);
    const v = preferredVehicle(c?.vehicles);
    setVehicleIds(v ? [v.id] : []);
    if (c) {
      setOneOff(false);
      if (!address) setAddress(c.addresses?.[0]?.address ?? "");
      if (v && v.kind !== "boat") setSizeId(v.size_id);
    }
  }

  async function submit() {
    setError(null);
    if (!customer && !name.trim()) {
      setError("Pick a customer or enter a name.");
      return;
    }
    if (startMin == null) {
      setError("Pick a time.");
      return;
    }
    if (ceramic && !garageOk) {
      setError("Ceramic coating needs a garage — confirm with the client before booking.");
      return;
    }
    setPending(true);
    // Multi-car visit: each add-on is priced per car at that car's size, summed.
    // Add-ons are car things — boats don't take them.
    const addonPrice = (a: Catalog["addons"][number]) =>
      selVehicles.length
        ? selCars.reduce((s, v) => s + addonQuote(a, v.size_id).price, 0)
        : addonQuote(a, sizeId).price;
    const res = await createAppointment({
      date,
      startMin,
      durationMin: duration,
      price,
      sizeId: selVehicles.length > 1 || boatish ? null : selVehicles[0]?.size_id ?? sizeId,
      sizeLabel: selVehicles.length
        ? selVehicles.map(vehicleLabel).join(" + ")
        : boatMode
          ? `Boat${Number(boatFt) > 0 ? ` — ${Number(boatFt)} ft` : ""}`
          : sizeLabel(sizeId),
      serviceName: ceramic
        ? catalog.ceramic!.name
        : boatish && catalog.boat
          ? catalog.boat.name
          : mixed && catalog.boat
            ? `The Standard Detail + ${catalog.boat.name}`
            : undefined,
      ceramic: !!ceramic,
      addons: catalog.addons
        .filter((a) => addonIds.includes(a.id))
        .map((a) => ({ id: a.id, name: a.name, price: addonPrice(a) })),
      name: customer?.name ?? name,
      phone: customer ? null : phone,
      email: customer ? null : email,
      address,
      notes: ceramic ? [notes.trim(), "Ceramic: garage confirmed — car stays garaged 24h after coating."].filter(Boolean).join("\n") : notes,
      customerId: customer?.id ?? null,
      vehicleIds,
      employeeIds: assignees,
      force: offGrid,
      notify: notify && !!contactEmail,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title={boatMode ? "New boat detail" : "New appointment"}>
      <div className="flex flex-col gap-4">
        <Field label="Customer">
          {!oneOff ? (
            <>
              <CustomerPicker value={customer} onChange={pickCustomer} autoFocus />
              {!customer && (
                <button type="button" className="mt-1.5 text-[13px] text-brand-deep underline underline-offset-2" onClick={() => setOneOff(true)}>
                  New customer — just type the details
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <input className="input" placeholder="Name (required)" value={name} onChange={(e) => setName(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <input className="input num" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <p className="text-[12px] text-faint -mt-0.5">
                Saved to your client list automatically (matched by phone/email if they already exist). Add an email if
                they&apos;ll pay by Stripe link.
              </p>
              <button type="button" className="self-start text-[13px] text-brand-deep underline underline-offset-2" onClick={() => setOneOff(false)}>
                Search existing customers instead
              </button>
            </div>
          )}
        </Field>

        <Field label="Address">
          <input className="input" placeholder="Where's the car?" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        {customer ? (
          <Field
            label={`Vehicles${selVehicles.length > 1 ? ` — ${selVehicles.length} this visit` : ""}`}
            hint={
              selVehicles.length > 1
                ? selVehicles
                    .map((v) =>
                      v.kind === "boat"
                        ? `${catalog.boat?.name ?? "Boat"} ${money(boatQuote(catalog, v.length_ft).price)}`
                        : `${ceramic ? catalog.ceramic!.name : "Standard Detail"} ${money(computeQuote(catalog, v.size_id, addonIds, service).price)}`
                    )
                    .join(" + ")
                : selVehicles[0]?.kind === "boat" && catalog.boat
                  ? `${catalog.boat.name} — ${money(boatRatePerFt(catalog))}/ft${selVehicles[0].length_ft ? "" : " — add the boat's length for a price"}`
                  : undefined
            }
          >
            <VehiclePicker
              customerId={customer.id}
              vehicles={vehicles}
              selected={vehicleIds}
              onChange={setVehicleIds}
              onVehiclesChange={setVehicles}
            />
          </Field>
        ) : null}

        {selBoats.length > 0 && catalog.boat && (
          <Field
            label={`${catalog.boat.name}${mixed ? " — the boat's side of the visit" : ""}`}
            hint={`${catalog.boat.components.map((c) => `${c.name.toLowerCase()} ${money(c.ratePerFt)}/ft`).join(" · ")} — set in Settings`}
          >
            <div className="card divide-y divide-line">
              {selBoats.map((b) => {
                const q = boatQuote(catalog, b.length_ft);
                return (
                  <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="font-medium truncate">{vehicleLabel(b)}</span>
                    <span className="num text-ink-2 shrink-0">
                      {b.length_ft ? `${b.length_ft} ft · ${money(q.price)} · ${q.minutes}m` : "add length for a price"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Field>
        )}
        {selVehicles.length === 0 &&
          (boatMode ? (
            <Field
              label="Boat length (ft)"
              hint={
                catalog.boat
                  ? `${money(boatRatePerFt(catalog))}/ft — ${catalog.boat.components.map((c) => `${c.name.toLowerCase()} ${money(c.ratePerFt)}`).join(" + ")}`
                  : "No boat pricing set — add it in Settings"
              }
            >
              <input
                type="number"
                min={1}
                className="input num"
                placeholder="Length in feet — drives the price"
                value={boatFt}
                onChange={(e) => setBoatFt(e.target.value)}
              />
            </Field>
          ) : (
            <Field label="Vehicle size" hint={customer ? "No vehicle picked — quoting by size only" : undefined}>
              <div className="grid grid-cols-3 gap-1.5">
                {SIZES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSizeId(s.id)}
                    className={`h-9 rounded-md border text-[13px] font-medium transition-colors duration-150 ${
                      sizeId === s.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                    }`}
                  >
                    {s.id === "sedan" ? "Sedan" : s.id === "midsize" ? "Midsize" : "Large"}
                  </button>
                ))}
              </div>
            </Field>
          ))}

        {catalog.ceramic && !boatish && (
          <Field label={mixed ? "Service — for the cars" : "Service"} hint={mixed ? "The boat prices per foot above, on its own" : undefined}>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { id: "standard", label: "The Standard Detail" },
                  { id: "ceramic", label: catalog.ceramic.name },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setService(s.id)}
                  className={`h-9 rounded-md border px-1 text-[13px] font-medium transition-colors duration-150 ${
                    service === s.id ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {ceramic && (
              <div className="mt-2 text-[13px] bg-warn-wash border border-[#fde68a] rounded-md px-3 py-2.5 flex flex-col gap-1.5">
                <p className="font-semibold">Ceramic coating rules</p>
                <p>
                  Includes the full in-and-out detail · books ~{Math.round(quote.minutes / 60)}h on site · at least{" "}
                  {catalog.rules.ceramicLeadDays} days notice · collect a{" "}
                  <span className="font-semibold num">
                    {money(Math.round((price * catalog.rules.ceramicDepositPct) / 100))}
                  </span>{" "}
                  ({catalog.rules.ceramicDepositPct}%) deposit up front.
                </p>
                <label className="flex items-center gap-2.5 font-medium">
                  <input type="checkbox" checked={garageOk} onChange={(e) => setGarageOk(e.target.checked)} />
                  Client has a garage and can keep the car in it 24h after
                </label>
              </div>
            )}
          </Field>
        )}

        {!boatish && (
          <Field label="Add-ons" hint={selCars.length > 0 && selVehicles.length > selCars.length ? "Add-ons apply to the cars only" : undefined}>
            <div className="flex flex-col gap-1">
              {catalog.addons.map((a) => (
                <label key={a.id} className="flex items-center gap-2.5 text-sm py-0.5">
                  <input
                    type="checkbox"
                    checked={addonIds.includes(a.id)}
                    onChange={(e) =>
                      setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((i) => i !== a.id)))
                    }
                  />
                  <span className="grow">{a.name}</span>
                  <span className="text-xs text-faint num">
                    {selCars.length > 1
                      ? `${money(selCars.reduce((s, v) => s + addonQuote(a, v.size_id).price, 0))} · ${selCars.reduce((s, v) => s + addonQuote(a, v.size_id).minutes, 0)}m`
                      : `${money(addonQuote(a, selCars[0]?.size_id ?? sizeId).price)} · ${addonQuote(a, selCars[0]?.size_id ?? sizeId).minutes}m`}
                  </span>
                </label>
              ))}
            </div>
          </Field>
        )}

        {owner && workers.length > 0 && (
          <Field
            label="Who's doing it?"
            hint={
              assignees.length === 0
                ? "You — times come from the business calendar; your own time is assumed free."
                : assignees.length > 1
                  ? "Times shown are when they're all free."
                  : "Times shown are when they're free."
            }
          >
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAssignees([]);
                  setStartMin(null);
                }}
                className={`h-9 px-3 rounded-md border text-[13px] font-medium transition-colors duration-150 ${
                  assignees.length === 0 ? "bg-ink border-ink text-white" : "bg-card border-line-2 hover:border-ink"
                }`}
              >
                Me
              </button>
              {workers.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => {
                    setAssignees((ids) => (ids.includes(w.id) ? ids.filter((i) => i !== w.id) : [...ids, w.id]));
                    setStartMin(null);
                  }}
                  className={`h-9 px-3 rounded-md border text-[13px] font-medium transition-colors duration-150 ${
                    assignees.includes(w.id) ? "bg-ink border-ink text-white" : "bg-card border-line-2 hover:border-ink"
                  }`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input type="date" className="input num" value={date} onChange={(e) => { setDate(e.target.value); setStartMin(null); }} />
          </Field>
          <Field label="Duration (min)">
            <input
              type="number"
              step={15}
              min={15}
              className="input num"
              value={duration}
              onChange={(e) => setDurationOverride(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Time">
          <SlotPicker
            date={date}
            durationMin={duration}
            value={startMin}
            employeeIds={assignees}
            onChange={(min, off) => {
              setStartMin(min);
              setOffGrid(off);
            }}
          />
        </Field>

        <Field label="Quoted price" hint={priceOverride !== "" ? `Standard quote: ${money(quote.price)}` : "Auto from size + add-ons — tap to adjust"}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
            <input
              type="number"
              step={1}
              min={0}
              className="input num pl-7"
              value={price}
              onChange={(e) => setPriceOverride(e.target.value)}
            />
          </div>
        </Field>

        <Field label="Notes">
          <textarea className="textarea" placeholder="Gate code, dog in yard, extra dirty…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {contactEmail && (
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Send confirmation email to {contactEmail}
          </label>
        )}

        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary h-11" onClick={submit} disabled={pending}>
          {pending ? (
            <>
              <Wheel size={18} /> Booking…
            </>
          ) : (
            `Book — ${money(price)}`
          )}
        </button>
      </div>
    </Sheet>
  );
}
