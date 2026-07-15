"use client";

// New-appointment sheet: phone bookings, walk-ups, and calendar taps all land here.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createAppointment } from "@/lib/actions/appointments";
import { computeQuote, type Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { todayYmd } from "@/lib/time";
import { SIZES, sizeLabel, type SizeId } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { SlotPicker } from "./slot-picker";
import { ErrorNote, Field, Sheet } from "./ui";

export function AppointmentSheet({
  open,
  onClose,
  catalog,
  defaultDate,
  defaultStartMin,
  defaultCustomer,
}: {
  open: boolean;
  onClose: () => void;
  catalog: Catalog;
  defaultDate?: string;
  defaultStartMin?: number;
  defaultCustomer?: PickedCustomer | null;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState<PickedCustomer | null>(defaultCustomer ?? null);
  const [oneOff, setOneOff] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [sizeId, setSizeId] = useState<SizeId>("sedan");
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

  const quote = useMemo(() => computeQuote(catalog, sizeId, addonIds), [catalog, sizeId, addonIds]);
  const price = priceOverride !== "" ? Number(priceOverride) : quote.price;
  const duration = durationOverride !== "" ? Number(durationOverride) : quote.minutes;
  const contactEmail = customer?.email || email;

  function pickCustomer(c: PickedCustomer | null) {
    setCustomer(c);
    if (c) {
      setOneOff(false);
      if (!address) setAddress(c.addresses?.[0]?.address ?? "");
      const v = c.vehicles?.[0];
      if (v) setSizeId(v.size_id);
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
    setPending(true);
    const res = await createAppointment({
      date,
      startMin,
      durationMin: duration,
      price,
      sizeId,
      sizeLabel: sizeLabel(sizeId),
      addons: catalog.addons.filter((a) => addonIds.includes(a.id)).map(({ id, name, price }) => ({ id, name, price })),
      name: customer?.name ?? name,
      phone: customer ? null : phone,
      email: customer ? null : email,
      address,
      notes,
      customerId: customer?.id ?? null,
      vehicleId: customer?.vehicles?.find((v) => v.size_id === sizeId)?.id ?? null,
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
    <Sheet open={open} onClose={onClose} title="New appointment">
      <div className="flex flex-col gap-4">
        <Field label="Customer">
          {!oneOff ? (
            <>
              <CustomerPicker value={customer} onChange={pickCustomer} autoFocus />
              {!customer && (
                <button type="button" className="mt-1.5 text-[13px] text-brand-deep underline underline-offset-2" onClick={() => setOneOff(true)}>
                  One-off customer — just type the details
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
              <button type="button" className="self-start text-[13px] text-brand-deep underline underline-offset-2" onClick={() => setOneOff(false)}>
                Search existing customers instead
              </button>
            </div>
          )}
        </Field>

        <Field label="Address">
          <input className="input" placeholder="Where's the car?" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>

        <Field label="Vehicle size">
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

        <Field label="Add-ons">
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
                  {money(a.price)} · {a.minutes}m
                </span>
              </label>
            ))}
          </div>
        </Field>

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
          {pending ? "Booking…" : `Book — ${money(price)}`}
        </button>
      </div>
    </Sheet>
  );
}
