"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BlockSheet } from "@/components/block-sheet";
import { ErrorNote } from "@/components/ui";
import {
  type AddonInput,
  changePassword,
  deleteAddon,
  deleteBlock,
  saveAddons,
  savePlanPricing,
  saveServicePricing,
  saveSettings,
  saveWeeklyHours,
  sendTestEmail,
} from "@/lib/actions/settings";
import { createClient } from "@/lib/supabase/client";
import { fmtDateShort, minToLabel, todayYmd, WEEKDAYS } from "@/lib/time";
import type { Block, PlanCadence, PlanPricing, Service, ServicePricing, SizeId, WeeklyHours } from "@/lib/types";

// ponytail: tables fill 100% width; tighter cell padding on mobile so the pricing
// grids fit a phone without side-scroll. overflow-x-auto stays as a last-resort guard.
const GRID_TABLE = "tbl w-full [&_th]:px-2 [&_td]:px-2 sm:[&_th]:px-3 sm:[&_td]:px-3";

const SIZE_IDS: SizeId[] = ["sedan", "midsize", "large"];
const SIZE_SHORT = { sedan: "Sedan", midsize: "Midsize", large: "Large" };
const CADENCE_IDS: PlanCadence[] = ["weekly", "biweekly", "monthly"];

function minToInput(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function inputToMin(v: string) {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function useSave() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setState("saving");
    const res = await fn();
    if (!res.ok) return setState(res.error ?? "Failed.");
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 2000);
  }
  return { state, run };
}

function SaveButton({ state, onClick }: { state: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn btn-primary btn-sm" onClick={onClick} disabled={state === "saving"}>
        {state === "saving" ? "Saving…" : "Save"}
      </button>
      {state === "saved" && <span className="text-sm text-ok">Saved.</span>}
      {state !== "idle" && state !== "saving" && state !== "saved" && <span className="text-sm text-bad">{state}</span>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 md:p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {note && <p className="text-[13px] text-ink-2 mt-0.5">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function SettingsClient({
  services,
  pricing,
  planPricing,
  hours,
  blocks,
  settings,
  emailFrom,
  userEmail,
}: {
  services: Service[];
  pricing: ServicePricing[];
  planPricing: PlanPricing[];
  hours: WeeklyHours[];
  blocks: Block[];
  settings: Record<string, string>;
  emailFrom: string;
  userEmail: string;
}) {
  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-3xl flex flex-col gap-4">
      <h1 className="text-xl md:text-2xl font-bold">Settings</h1>
      <PricingSection pricing={pricing} />
      <AddonsSection services={services} pricing={pricing} />
      <PlanPricingSection planPricing={planPricing} />
      <HoursSection hours={hours} settings={settings} />
      <SplitSection settings={settings} />
      <BlocksSection blocks={blocks} />
      <EmailSection emailFrom={emailFrom} />
      <AccountSection userEmail={userEmail} />
    </div>
  );
}

function PricingSection({ pricing }: { pricing: ServicePricing[] }) {
  const { state, run } = useSave();
  const [rows, setRows] = useState(() => {
    const map = new Map<string, ServicePricing>();
    for (const p of pricing) if (p.service_id === "standard") map.set(p.size_id, p);
    return map;
  });
  const get = (size: string) => rows.get(size) ?? { service_id: "standard", size_id: size, price: 0, minutes: 0 };
  const set = (size: string, field: "price" | "minutes", v: number) =>
    setRows(new Map(rows).set(size, { ...get(size), [field]: v }));

  return (
    <Section
      title="The Standard Detail"
      note="Saved to the database — drives both this dashboard and the public booking site."
    >
      <div className="overflow-x-auto">
        <table className={GRID_TABLE}>
          <thead>
            <tr>
              <th>Size</th>
              <th>Price</th>
              <th>Minutes</th>
            </tr>
          </thead>
          <tbody>
            {SIZE_IDS.map((size) => (
              <tr key={size}>
                <td className="font-medium">{SIZE_SHORT[size]}</td>
                <td>
                  <input
                    type="number"
                    className="input num max-w-[90px]! h-8!"
                    value={get(size).price}
                    onChange={(e) => set(size, "price", Number(e.target.value))}
                    aria-label={`${size} price`}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step={15}
                    className="input num max-w-[90px]! h-8!"
                    value={get(size).minutes}
                    onChange={(e) => set(size, "minutes", Number(e.target.value))}
                    aria-label={`${size} minutes`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <SaveButton state={state} onClick={() => run(() => saveServicePricing([...rows.values()]))} />
      </div>
    </Section>
  );
}

interface AddonDraft {
  id: string | null; // null = not saved yet; id is minted from the name on save
  name: string;
  note: string;
  perSize: boolean;
  flat: { price: number; minutes: number };
  sizes: Record<SizeId, { price: number; minutes: number }>;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function AddonsSection({ services, pricing }: { services: Service[]; pricing: ServicePricing[] }) {
  const { state, run } = useSave();
  const [open, setOpen] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<AddonDraft[]>(() =>
    services
      .filter((s) => s.kind === "addon")
      .map((s) => {
        const rows = pricing.filter((p) => p.service_id === s.id);
        const flat = rows.find((p) => p.size_id === "*") ?? rows[0] ?? { price: 0, minutes: 0 };
        const perSize = rows.some((p) => p.size_id !== "*");
        const sizeRow = (size: SizeId) => {
          const r = rows.find((p) => p.size_id === size) ?? flat;
          return { price: r.price, minutes: r.minutes };
        };
        return {
          id: s.id,
          name: s.name,
          note: s.note ?? "",
          perSize,
          flat: { price: flat.price, minutes: flat.minutes },
          sizes: { sedan: sizeRow("sedan"), midsize: sizeRow("midsize"), large: sizeRow("large") },
        };
      })
  );

  const patch = (i: number, p: Partial<AddonDraft>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...p } : d)));

  async function remove(i: number) {
    const d = drafts[i];
    if (d.id && !window.confirm(`Remove “${d.name}”? It disappears from the booking site immediately; past appointments keep their records.`)) return;
    if (d.id) {
      const res = await deleteAddon(d.id);
      if (!res.ok) return alert(res.error);
    }
    setOpen(null);
    setDrafts(drafts.filter((_, j) => j !== i));
  }

  const priceSummary = (d: AddonDraft) =>
    d.perSize
      ? `$${Math.min(...SIZE_IDS.map((s) => d.sizes[s].price))}–${Math.max(...SIZE_IDS.map((s) => d.sizes[s].price))}`
      : `$${d.flat.price} · ${d.flat.minutes}m`;

  function save() {
    run(async () => {
      const taken = new Set(drafts.map((d) => d.id).filter(Boolean) as string[]);
      const payload: AddonInput[] = [];
      for (const d of drafts) {
        let id = d.id;
        if (!id) {
          id = slugify(d.name);
          if (!id) return { ok: false as const, error: "Every add-on needs a name." };
          while (taken.has(id) || id === "standard") id = `${id}-2`;
          taken.add(id);
        }
        payload.push({
          id,
          name: d.name,
          note: d.note || null,
          pricing: d.perSize
            ? SIZE_IDS.map((s) => ({ size_id: s, ...d.sizes[s] }))
            : [{ size_id: "*", ...d.flat }],
        });
      }
      return saveAddons(payload);
    });
  }

  const numInput = (value: number, onChange: (v: number) => void, label: string, step = 1) => (
    <input
      type="number"
      step={step}
      className="input num max-w-[90px]! h-8!"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
    />
  );

  return (
    <Section title="Add-ons" note="Tap an add-on to edit it. Name, note, and prices show on the booking site exactly as entered here.">
      <div className="flex flex-col divide-y divide-line border border-line rounded-md overflow-hidden">
        {drafts.map((d, i) => (
          <div key={d.id ?? `new-${i}`} className="bg-card">
            <button
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
              onClick={() => setOpen(open === i ? null : i)}
              aria-expanded={open === i}
            >
              <span className="text-sm font-medium grow truncate">{d.name || "New add-on"}</span>
              <span className="text-[13px] text-faint num shrink-0">{priceSummary(d)}</span>
              <span className={`text-faint text-xs transition-transform ${open === i ? "rotate-90" : ""}`}>▸</span>
            </button>
            {open === i && (
              <div className="px-3 pb-3 flex flex-col gap-2">
                <input
                  className="input h-8!"
                  placeholder="Add-on name"
                  value={d.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
                <input
                  className="input h-8!"
                  placeholder="Short note shown under the name (optional)"
                  value={d.note}
                  onChange={(e) => patch(i, { note: e.target.value })}
                />
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={d.perSize}
                    onChange={(e) =>
                      patch(i, {
                        perSize: e.target.checked,
                        // seed all sizes from the flat price when switching over
                        sizes: e.target.checked ? { sedan: d.flat, midsize: d.flat, large: d.flat } : d.sizes,
                        flat: e.target.checked ? d.flat : d.sizes.sedan,
                      })
                    }
                  />
                  Price varies by vehicle size
                </label>
                {d.perSize ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-[70px_1fr_1fr] gap-2 items-center text-[12px] text-faint">
                      <span />
                      <span>Price</span>
                      <span>Extra min</span>
                    </div>
                    {SIZE_IDS.map((s) => (
                      <div key={s} className="grid grid-cols-[70px_1fr_1fr] gap-2 items-center">
                        <span className="text-[13px] font-medium">{SIZE_SHORT[s]}</span>
                        {numInput(d.sizes[s].price, (v) => patch(i, { sizes: { ...d.sizes, [s]: { ...d.sizes[s], price: v } } }), `${d.name} ${s} price`)}
                        {numInput(d.sizes[s].minutes, (v) => patch(i, { sizes: { ...d.sizes, [s]: { ...d.sizes[s], minutes: v } } }), `${d.name} ${s} minutes`, 15)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="text-faint">Price</span>
                    {numInput(d.flat.price, (v) => patch(i, { flat: { ...d.flat, price: v } }), `${d.name} price`)}
                    <span className="text-faint ml-2">Extra min</span>
                    {numInput(d.flat.minutes, (v) => patch(i, { flat: { ...d.flat, minutes: v } }), `${d.name} minutes`, 15)}
                  </div>
                )}
                <button className="btn btn-sm btn-danger self-start mt-1" onClick={() => remove(i)}>
                  Remove add-on
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          className="btn btn-sm"
          onClick={() => {
            setDrafts([
              ...drafts,
              {
                id: null,
                name: "",
                note: "",
                perSize: false,
                flat: { price: 0, minutes: 30 },
                sizes: { sedan: { price: 0, minutes: 30 }, midsize: { price: 0, minutes: 30 }, large: { price: 0, minutes: 30 } },
              },
            ]);
            setOpen(drafts.length);
          }}
        >
          Add add-on
        </button>
        <SaveButton state={state} onClick={save} />
      </div>
    </Section>
  );
}

function PlanPricingSection({ planPricing }: { planPricing: PlanPricing[] }) {
  const { state, run } = useSave();
  const [rows, setRows] = useState(() => new Map(planPricing.map((p) => [`${p.cadence}:${p.size_id}`, p.price])));
  return (
    <Section title="Maintenance plan pricing" note="Per-visit price by cadence and size. Auto-suggested when creating a plan.">
      <div className="overflow-x-auto">
        <table className={GRID_TABLE}>
          <thead>
            <tr>
              <th>Cadence</th>
              {SIZE_IDS.map((s) => (
                <th key={s}>{SIZE_SHORT[s]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CADENCE_IDS.map((c) => (
              <tr key={c}>
                <td className="font-medium capitalize">{c}</td>
                {SIZE_IDS.map((s) => (
                  <td key={s}>
                    <input
                      type="number"
                      className="input num max-w-[80px]! h-8!"
                      value={rows.get(`${c}:${s}`) ?? 0}
                      onChange={(e) => setRows(new Map(rows).set(`${c}:${s}`, Number(e.target.value)))}
                      aria-label={`${c} ${s} price`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <SaveButton
          state={state}
          onClick={() =>
            run(() =>
              savePlanPricing(
                [...rows.entries()].map(([k, price]) => {
                  const [cadence, size_id] = k.split(":");
                  return { cadence, size_id, price };
                })
              )
            )
          }
        />
      </div>
    </Section>
  );
}

function HoursSection({ hours, settings }: { hours: WeeklyHours[]; settings: Record<string, string> }) {
  const { state, run } = useSave();
  const [rows, setRows] = useState<WeeklyHours[]>(
    Array.from({ length: 7 }, (_, d) => hours.find((h) => h.weekday === d) ?? { weekday: d, enabled: true, open_min: 480, close_min: 1080 })
  );
  const [gran, setGran] = useState(settings.slot_granularity_min ?? "30");
  const [lead, setLead] = useState(settings.min_lead_min ?? "180");
  const [buffer, setBuffer] = useState(settings.buffer_min ?? "30");

  const setRow = (d: number, patch: Partial<WeeklyHours>) =>
    setRows(rows.map((r) => (r.weekday === d ? { ...r, ...patch } : r)));

  return (
    <Section title="Hours & booking rules" note="Drives the public booking page and the availability engine.">
      <div className="flex flex-col divide-y divide-line border border-line rounded-md overflow-hidden">
        {rows.map((r) => (
          <div key={r.weekday} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 bg-card">
            <label className="flex items-center gap-2.5 w-28 shrink-0 text-sm font-medium">
              <input type="checkbox" checked={r.enabled} onChange={(e) => setRow(r.weekday, { enabled: e.target.checked })} />
              {WEEKDAYS[r.weekday].slice(0, 3)}
            </label>
            {r.enabled ? (
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="time"
                  step={1800}
                  className="input num h-8! w-auto!"
                  value={minToInput(r.open_min)}
                  onChange={(e) => setRow(r.weekday, { open_min: inputToMin(e.target.value) })}
                  aria-label={`${WEEKDAYS[r.weekday]} open`}
                />
                <span className="text-faint">–</span>
                <input
                  type="time"
                  step={1800}
                  className="input num h-8! w-auto!"
                  value={minToInput(r.close_min)}
                  onChange={(e) => setRow(r.weekday, { close_min: inputToMin(e.target.value) })}
                  aria-label={`${WEEKDAYS[r.weekday]} close`}
                />
              </div>
            ) : (
              <span className="text-sm text-faint">Closed</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <label className="block">
          <span className="label block mb-1">Slot step (min)</span>
          <input type="number" step={15} className="input num" value={gran} onChange={(e) => setGran(e.target.value)} />
        </label>
        <label className="block">
          <span className="label block mb-1">Min lead (min)</span>
          <input type="number" step={30} className="input num" value={lead} onChange={(e) => setLead(e.target.value)} />
        </label>
        <label className="block">
          <span className="label block mb-1">Buffer (min)</span>
          <input type="number" step={15} className="input num" value={buffer} onChange={(e) => setBuffer(e.target.value)} />
        </label>
      </div>
      <div className="mt-3">
        <SaveButton
          state={state}
          onClick={() =>
            run(async () => {
              const a = await saveWeeklyHours(rows);
              if (!a.ok) return a;
              return saveSettings({ slot_granularity_min: gran, min_lead_min: lead, buffer_min: buffer });
            })
          }
        />
      </div>
    </Section>
  );
}

function SplitSection({ settings }: { settings: Record<string, string> }) {
  const { state, run } = useSave();
  const [washer, setWasher] = useState(settings.split_washer_pct ?? "60");
  const [ceo, setCeo] = useState(settings.split_ceo_pct ?? "10");
  const total = Number(washer || 0) + Number(ceo || 0);
  return (
    <Section title="Payout split" note="Splits apply to money as it's collected — changing them only affects new payments.">
      <div className="flex gap-3">
        <label className="block max-w-[160px]">
          <span className="label block mb-1">Washer (Gabe) %</span>
          <input type="number" min={0} max={100} className="input num" value={washer} onChange={(e) => setWasher(e.target.value)} />
        </label>
        <label className="block max-w-[160px]">
          <span className="label block mb-1">CEO (Tyler) %</span>
          <input type="number" min={0} max={100} className="input num" value={ceo} onChange={(e) => setCeo(e.target.value)} />
        </label>
      </div>
      <p className={`text-[13px] mt-2 ${total > 100 ? "text-bad" : "text-ink-2"}`}>
        {total > 100 ? "Splits can't exceed 100%." : `Company capital keeps the remaining ${100 - total}%.`}
      </p>
      <div className="mt-3">
        <SaveButton
          state={state}
          onClick={() =>
            run(async () =>
              total > 100
                ? { ok: false as const, error: "Splits can't exceed 100%." }
                : saveSettings({ split_washer_pct: washer, split_ceo_pct: ceo })
            )
          }
        />
      </div>
    </Section>
  );
}

function BlocksSection({ blocks }: { blocks: Block[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Section title="Blocked time" note="Upcoming blocks — also manageable straight from the calendar.">
      <div className="flex flex-col divide-y divide-line border border-line rounded-md overflow-hidden">
        {blocks.length === 0 && <p className="px-3 py-3 text-sm text-faint bg-card">Nothing blocked ahead.</p>}
        {blocks.map((b) => (
          <div key={b.id} className="flex items-center gap-3 px-3 py-2 bg-card">
            <p className="text-sm grow num">
              <span className="font-medium">{fmtDateShort(b.date)}</span> ·{" "}
              {b.start_min === 0 && b.end_min === 1440 ? "all day" : `${minToLabel(b.start_min)} – ${minToLabel(b.end_min)}`}
              {b.reason && <span className="text-faint"> · {b.reason}</span>}
            </p>
            <button
              className="btn btn-sm btn-danger"
              disabled={pending === b.id}
              onClick={async () => {
                setPending(b.id);
                await deleteBlock(b.id);
                setPending(null);
                router.refresh();
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-sm mt-3" onClick={() => setOpen(true)}>
        Block time
      </button>
      <BlockSheet open={open} onClose={() => setOpen(false)} defaultDate={todayYmd()} />
    </Section>
  );
}

function EmailSection({ emailFrom }: { emailFrom: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  return (
    <Section title="Email" note="Confirmation, update, and cancellation emails send through Resend. Templates live in code.">
      <p className="text-sm">
        From: <span className="font-medium num">{emailFrom}</span>
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          className="btn btn-sm"
          disabled={state === "sending"}
          onClick={async () => {
            setState("sending");
            const res = await sendTestEmail();
            setState(res.ok ? "sent" : (res as { error?: string }).error ?? "Failed.");
          }}
        >
          {state === "sending" ? "Sending…" : "Send me a test email"}
        </button>
        {state === "sent" && <span className="text-sm text-ok">Sent — check your inbox.</span>}
        {state !== "idle" && state !== "sending" && state !== "sent" && <span className="text-sm text-bad">{state}</span>}
      </div>
    </Section>
  );
}

function AccountSection({ userEmail }: { userEmail: string }) {
  const supabase = createClient();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  return (
    <Section title="Account">
      <p className="text-sm">
        Signed in as <span className="font-medium">{userEmail}</span>
      </p>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
        <input
          type="password"
          className="input"
          placeholder="New password"
          autoComplete="new-password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <input
          type="password"
          className="input"
          placeholder="Repeat it"
          autoComplete="new-password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          className="btn btn-sm"
          disabled={state === "saving" || pw.length === 0}
          onClick={async () => {
            if (pw !== pw2) return setState("Passwords don't match.");
            setState("saving");
            const res = await changePassword(pw);
            setState(res.ok ? "saved" : (res as { error?: string }).error ?? "Failed.");
            if (res.ok) {
              setPw("");
              setPw2("");
            }
          }}
        >
          {state === "saving" ? "Updating…" : "Change password"}
        </button>
        {state === "saved" && <span className="text-sm text-ok">Password updated.</span>}
        {state !== "idle" && state !== "saving" && state !== "saved" && <ErrorNote>{state}</ErrorNote>}
      </div>
      <button
        className="btn btn-sm btn-danger mt-4"
        onClick={async () => {
          await supabase.auth.signOut();
          window.location.href = "/login";
        }}
      >
        Sign out
      </button>
    </Section>
  );
}
