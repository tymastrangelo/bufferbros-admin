// LARP mode dataset: a believable, very successful Buffer Bros — ~640 clients, a crew
// running 10–16 jobs a weekday, six-figure months. Deterministic (seeded PRNG keyed to
// today), so the server render and the browser's own queries see identical rows/ids.
// Only the tables listed in FAKE_TABLES are faked; catalog, settings, hours and the
// real employee roster pass through (see client.ts), so pricing and screens stay real.
import { addDays, todayYmd, weekdayOf } from "@/lib/time";
import { seedChecklist } from "@/lib/checklist";

type Row = Record<string, unknown>;
export type Dataset = Record<string, Row[]>;

export const FAKE_TABLES = [
  "customers",
  "vehicles",
  "plans",
  "plan_vehicles",
  "appointments",
  "appointment_vehicles",
  "appointment_employees",
  "appointment_events",
  "appointment_photos",
  "ledger_entries",
  "company_ledger",
  "customer_balances",
  "expenses",
  "recurring_expenses",
  "payment_requests",
  "reminders",
  "outreach_log",
  "blocks",
  "customer_not_duplicates",
  "email_signups",
  // real texts never show in demo mode
  "customer_messages",
  "customer_insights",
  "text_sync_runs",
] as const;

export interface CrewMember {
  id: string;
  split_pct: number;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = "James Olivia Liam Emma Noah Ava Mason Sophia Lucas Isabella Ethan Mia Logan Amelia Jack Harper Aiden Evelyn Carter Abigail Owen Emily Wyatt Ella Grayson Scarlett Leo Grace Hudson Chloe Ryan Lily Nathan Hannah Caleb Zoe Dylan Nora Gavin Riley Tyler Layla Brooks Claire Chase Avery Cole Stella Reid Paige Blake Morgan Grant Quinn Derek Tessa Marco Gianna Vince Lauren Hank Diane Russ Carol Doug Peggy Walt Joan".split(" ");
const LAST = "Anderson Bennett Caldwell Donovan Ellison Fischer Grady Hartman Iverson Jensen Keller Lindqvist Moreno Nakamura O'Neill Prescott Quinlan Ramirez Sullivan Thornton Underwood Vasquez Whitaker Xavier Yates Zimmerman Brooks Castillo Delgado Esposito Fontaine Gallagher Holloway Ingram Jameson Kowalski Lombardi Mancini Navarro Ortega Pellegrino Rinaldi Santoro Torres Valentino Weston Abbott Barrett Calloway".split(" ");
const STREETS = "Collier Blvd|Bald Eagle Dr|San Marco Rd|N Barfield Dr|Heathwood Dr|Kendall Dr|Seagrape Ave|Gulf Shore Blvd|Pelican Bay Blvd|Vanderbilt Beach Rd|Crayton Rd|Mooring Line Dr|Galleon Dr|Tigertail Ct|Seaview Ct|Pine Ridge Rd|Park Shore Dr|Royal Harbor Blvd".split("|");
const TOWNS = ["Marco Island, FL", "Naples, FL"];
const CARS: [string, string, "sedan" | "midsize" | "large"][] = [
  ["Tesla", "Model 3", "sedan"], ["Tesla", "Model Y", "midsize"], ["BMW", "X5", "midsize"], ["Mercedes-Benz", "GLE", "midsize"],
  ["Porsche", "Cayenne", "midsize"], ["Range Rover", "Sport", "large"], ["Cadillac", "Escalade", "large"], ["Chevrolet", "Tahoe", "large"],
  ["Ford", "F-150", "large"], ["Lexus", "RX 350", "midsize"], ["Audi", "Q7", "large"], ["Porsche", "911", "sedan"],
  ["Mercedes-Benz", "S 580", "sedan"], ["GMC", "Yukon Denali", "large"], ["Toyota", "Land Cruiser", "large"], ["Jeep", "Grand Wagoneer", "large"],
  ["Lucid", "Air", "sedan"], ["Rivian", "R1S", "large"], ["BMW", "M5", "sedan"], ["Genesis", "GV80", "midsize"],
];
const BOATS = [["Boston Whaler", "Outrage"], ["Grady-White", "Canyon"], ["Yellowfin", "36"], ["Pursuit", "S 358"], ["Scout", "355 LXF"]];
const COLORS = ["Black", "White", "Silver", "Gray", "Blue", "Red", "Green", "Pearl"];
const METHODS = ["card", "card", "zelle", "zelle", "venmo", "cash", "check"];
const ADDONS = [
  { id: "pet-hair", name: "Pet Hair Removal", price: 50 },
  { id: "engine-bay", name: "Engine Bay", price: 60 },
  { id: "headlights", name: "Headlight Restoration", price: 90 },
  { id: "odor", name: "Odor Treatment", price: 75 },
];
const BASE = { sedan: 229, midsize: 249, large: 269 } as const;
const SIZE_LABEL = { sedan: "Car / Sedan / Coupe", midsize: "Midsize SUV / Truck", large: "Large SUV / Truck" } as const;

const uid = (prefix: number, n: number) =>
  `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
// ponytail: fixed -04:00 offset — demo timestamps only feed durations, never date math.
const iso = (ymd: string, min = 600) => new Date(Date.parse(`${ymd}T00:00:00-04:00`) + min * 60000).toISOString();

let cache: { key: string; data: Dataset } | null = null;

export function larpDataset(crew: CrewMember[], ceoPct = 10): Dataset {
  const today = todayYmd();
  const key = `${today}|${crew.map((c) => `${c.id}:${c.split_pct}`).join(",")}`;
  if (cache?.key === key) return cache.data;

  // Separate streams: customers/vehicles never depend on the crew list, so the browser
  // (which builds before knowing it) and the server agree on every customer id.
  const r1 = mulberry32(0xb0ffe2);
  const pick = <T,>(rnd: () => number, a: readonly T[]) => a[Math.floor(rnd() * a.length)];

  const customers: Row[] = [];
  const vehicles: Row[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < 640; i++) {
    // unique names — otherwise the demo would greet you with "Duplicates found"
    let name = `${pick(r1, FIRST)} ${pick(r1, LAST)}`;
    while (usedNames.has(name)) name = `${pick(r1, FIRST)} ${pick(r1, LAST)}`;
    usedNames.add(name);
    const created = addDays(today, -Math.floor(r1() * 1100) - 10);
    const id = uid(1, i);
    const phone = `+1239${String(2000000 + Math.floor(r1() * 7999999)).padStart(7, "0")}`;
    customers.push({
      id,
      created_at: iso(created),
      name,
      phone,
      email: r1() < 0.8 ? `${name.toLowerCase().replace(/[^a-z]+/g, ".")}${i % 7 === 0 ? i : ""}@gmail.com` : null,
      addresses: [{ label: "Home", address: `${100 + Math.floor(r1() * 1800)} ${pick(r1, STREETS)}, ${pick(r1, TOWNS)}` }],
      notes: r1() < 0.12 ? pick(r1, ["Gate code 1942#", "Park on the left side of the driveway", "Two golden retrievers — lots of hair", "Prefers mornings", "Garage code on file"]) : null,
      site_notes: r1() < 0.2 ? pick(r1, ["Gate 4412 · park on the street", "Hose on the left side of the garage", "Spigot behind the pool cage, no outlet outside", "Dock slip B-14, key in the lockbox 0921"]) : null,
      tags: [r1() < 0.18 && "vip", r1() < 0.1 && "referral", r1() < 0.06 && "seasonal"].filter(Boolean),
      source: pick(r1, ["website", "website", "manual", "contacts-import"]),
      archived: r1() < 0.02,
      stripe_payments: r1() < 0.25,
      outreach_status: r1() < 0.05 ? "seasonal" : "active",
      resume_on: null,
      last_contacted_on: r1() < 0.4 ? addDays(today, -Math.floor(r1() * 90)) : null,
      review_asked_on: r1() < 0.5 ? addDays(today, -Math.floor(r1() * 200)) : null,
      review_left_on: r1() < 0.38 ? addDays(today, -Math.floor(r1() * 200)) : null,
      referred_by: i > 40 && r1() < 0.12 ? uid(1, Math.floor(r1() * i)) : null,
      referral_credited_at: null,
    });
    const nCars = r1() < 0.35 ? 2 : 1;
    for (let v = 0; v < nCars; v++) {
      const boat = r1() < 0.06;
      const car = pick(r1, CARS);
      const b = pick(r1, BOATS);
      vehicles.push({
        id: uid(2, vehicles.length),
        customer_id: id,
        kind: boat ? "boat" : "car",
        size_id: boat ? "large" : car[2],
        length_ft: boat ? 24 + Math.floor(r1() * 18) : null,
        make: boat ? b[0] : car[0],
        model: boat ? b[1] : car[1],
        year: 2017 + Math.floor(r1() * 9),
        color: pick(r1, COLORS),
        plate: null,
        notes: null,
      });
    }
  }
  const carsOf = new Map<string, Row[]>();
  for (const v of vehicles) carsOf.set(v.customer_id as string, [...(carsOf.get(v.customer_id as string) ?? []), v]);

  const r = mulberry32(0x1a2b3c);
  const crewIds = crew.map((c) => c.id);
  const splitOf = new Map(crew.map((c) => [c.id, Number(c.split_pct)]));
  const active = customers.filter((c) => !c.archived);

  // Plans: the recurring backbone.
  const plans: Row[] = [];
  const plan_vehicles: Row[] = [];
  for (let i = 0; i < 185; i++) {
    const c = active[(i * 7) % active.length];
    const car = (carsOf.get(c.id as string) ?? [])[0];
    const cadence = r() < 0.3 ? "weekly" : r() < 0.65 ? "biweekly" : "monthly";
    const status = i < 150 ? "active" : i < 170 ? "paused" : "ended";
    const id = uid(3, i);
    plans.push({
      id,
      created_at: iso(addDays(today, -Math.floor(r() * 500) - 30)),
      customer_id: c.id,
      vehicle_id: car?.id ?? null,
      cadence,
      interval_days: null,
      employee_id: crew.length ? crew[i % crew.length].id : null,
      per_visit_price: cadence === "weekly" ? 129 : cadence === "biweekly" ? 159 : 189,
      preferred_dow: 1 + Math.floor(r() * 5),
      preferred_min: 480 + Math.floor(r() * 16) * 30,
      duration_min: 90,
      address: (c.addresses as { address: string }[])[0]?.address ?? null,
      status,
      starts_on: addDays(today, -Math.floor(r() * 400) - 20),
      ends_on: null,
      billing_note: r() < 0.25 ? "Prepaid quarterly" : null,
      notes: null,
      email_confirmations: true,
      skip_entry: false,
    });
    if (car) plan_vehicles.push({ plan_id: id, vehicle_id: car.id });
  }
  const activePlans = plans.filter((p) => p.status === "active");

  // Appointments: ~400 days of history + 6 weeks ahead.
  const appointments: Row[] = [];
  const appointment_vehicles: Row[] = [];
  const appointment_employees: Row[] = [];
  const appointment_events: Row[] = [];
  const appointment_photos: Row[] = [];
  const STEPS = ["Full interior vacuum, seats, carpets and mats", "Hand wash with a double foam bath", "Layer of protective spray wax", "Wheels, tires and tire shine", "All interior surfaces wiped down", "Interior and exterior glass", "Door jambs cleaned"];
  const ledger_entries: Row[] = [];
  const company_ledger: Row[] = [];
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  let le = 0;
  let cl = 0;
  const mirror = (entry: Row, empId: string | null, name: string) => {
    const amount = Number(entry.amount);
    const fee = Number(entry.processor_fee ?? 0);
    const base = { ledger_entry_id: entry.id, collected_by: entry.collected_by, settled_on: entry.settled_on, occurred_on: entry.occurred_on, created_at: entry.created_at, expense_id: null };
    company_ledger.push({ ...base, id: uid(9, cl++), kind: "revenue", party: null, employee_id: null, amount, memo: name });
    if (fee) company_ledger.push({ ...base, id: uid(9, cl++), kind: "expense", party: null, employee_id: null, amount: -fee, memo: `Stripe fee — ${name}` });
    const net = amount - fee;
    if (empId) company_ledger.push({ ...base, id: uid(9, cl++), kind: "payout", party: "employee", employee_id: empId, amount: -Math.round(net * (splitOf.get(empId) ?? 60)) / 100, memo: name });
    company_ledger.push({ ...base, id: uid(9, cl++), kind: "payout", party: "ceo", employee_id: null, amount: -Math.round(net * ceoPct) / 100, memo: name });
  };

  for (let d = -400; d <= 42; d++) {
    const date = addDays(today, d);
    const dow = weekdayOf(date);
    const growth = 0.7 + 0.3 * ((d + 400) / 442); // business grows over the year
    const n = Math.round((dow === 0 ? r() * 2 : dow === 6 ? 6 + r() * 4 : 10 + r() * 7) * (d > 14 ? 0.55 : growth));
    const taken = new Set<number>();
    for (let k = 0; k < n; k++) {
      const plan = r() < 0.38 ? pick(r, activePlans) : null;
      const cust = plan ? customers.find((c) => c.id === plan.customer_id)! : pick(r, active);
      const car = (carsOf.get(cust.id as string) ?? [])[0];
      const boat = car?.kind === "boat";
      const ceramic = !plan && !boat && r() < 0.035;
      const size = (car?.size_id as keyof typeof BASE) ?? "sedan";
      const addons = !plan && !boat && r() < 0.32 ? [pick(r, ADDONS)] : [];
      const price = plan
        ? Number(plan.per_visit_price)
        : boat
          ? Math.round(Number(car.length_ft) * (18 + r() * 14))
          : ceramic
            ? pick(r, [1199, 1399, 1599])
            : BASE[size] + addons.reduce((s, a) => s + a.price, 0);
      let start = 450 + Math.floor(r() * 20) * 30;
      while (taken.has(start) && taken.size < 20) start = 450 + Math.floor(r() * 20) * 30;
      taken.add(start);
      const duration = plan ? 90 : boat ? 240 : ceramic ? 480 : size === "large" ? 180 : 150;
      const empId = crewIds.length && r() < 0.78 ? pick(r, crewIds) : null;
      const past = d < 0 || (d === 0 && start + duration < nowMin);
      const roll = r();
      const status = past ? (roll < 0.94 ? "completed" : roll < 0.98 ? "cancelled" : "no_show") : "scheduled";
      const id = uid(4, appointments.length);
      const appt: Row = {
        id,
        created_at: iso(addDays(date, -Math.floor(r() * 20) - 1)),
        legacy_id: null,
        customer_id: cust.id,
        vehicle_id: car?.id ?? null,
        plan_id: plan?.id ?? null,
        source: plan ? "recurring" : r() < 0.4 ? "web" : "manual",
        status,
        date,
        start_min: start,
        duration_min: duration,
        size_id: size,
        size_label: boat ? `${car.length_ft} ft boat` : SIZE_LABEL[size],
        service_name: boat ? "Boat Detail" : ceramic ? "Ceramic Coating" : plan ? "Maintenance Detail" : "The Standard Detail",
        addons,
        price,
        address: (cust.addresses as { address: string }[])[0]?.address ?? null,
        contact_name: cust.name,
        contact_phone: cust.phone,
        contact_email: cust.email,
        notes: r() < 0.06 ? pick(r, ["Call on arrival", "Dog hair in the back seat", "Use the side gate"]) : null,
        started_at: status === "completed" ? iso(date, start) : null,
        completed_at: status === "completed" ? iso(date, start + duration - 15 + Math.floor(r() * 30)) : null,
        completion_note: null,
        gcal_event_id: null,
        self_done: false,
        employee_id: empId,
        cancelled_at: status === "cancelled" ? iso(addDays(date, -1)) : null,
        attribution: null,
        checklist: seedChecklist(boat ? [] : STEPS, addons.map((a) => ({ id: a.id as string, name: a.name as string }))).map((i) => ({
          ...i,
          done: status === "completed" ? r() < 0.9 : false,
        })),
      };
      appointments.push(appt);
      appointment_events.push({ id: appointment_events.length + 1, appointment_id: id, at: appt.created_at, actor_user_id: null, kind: "booked", detail: { source: appt.source } });
      if (status === "completed") {
        appointment_events.push({ id: appointment_events.length + 1, appointment_id: id, at: appt.started_at, actor_user_id: null, kind: "started", detail: {} });
        appointment_events.push({ id: appointment_events.length + 1, appointment_id: id, at: appt.completed_at, actor_user_id: null, kind: "completed", detail: { from: "scheduled", to: "completed" } });
        if (r() < 0.3) {
          for (let p = 0; p < 4; p++) {
            appointment_photos.push({ id: uid(12, appointment_photos.length), appointment_id: id, path: `larp/${(p % 4) + 1}.jpg`, kind: p < 2 ? "before" : "after", taken_by: empId, created_at: p < 2 ? appt.started_at : appt.completed_at });
          }
        }
      } else if (status === "cancelled") {
        appointment_events.push({ id: appointment_events.length + 1, appointment_id: id, at: appt.cancelled_at, actor_user_id: null, kind: "cancelled", detail: { from: "scheduled", to: "cancelled" } });
      }
      if (car) appointment_vehicles.push({ appointment_id: id, vehicle_id: car.id });
      if (empId) appointment_employees.push({ appointment_id: id, employee_id: empId });

      if (status === "completed") {
        const charge: Row = { id: uid(5, le++), created_at: iso(date, start + duration), customer_id: cust.id, appointment_id: id, plan_id: plan?.id ?? null, kind: "charge", amount: -price, method: null, occurred_on: date, memo: appt.service_name, collected_by: "owner", settled_on: null, processor_fee: 0 };
        ledger_entries.push(charge);
        if (r() < 0.965 || d < -45) {
          const method = cust.stripe_payments ? "card" : pick(r, METHODS);
          const fee = method === "card" ? Math.round((price * 0.029 + 0.3) * 100) / 100 : 0;
          const pay: Row = {
            id: uid(5, le++),
            created_at: iso(date, start + duration + 5),
            customer_id: cust.id,
            appointment_id: id,
            plan_id: plan?.id ?? null,
            kind: "payment",
            amount: price,
            method,
            occurred_on: date,
            memo: null,
            collected_by: empId && method !== "card" ? "washer" : "owner",
            settled_on: d < -12 ? addDays(date, 7) : null,
            processor_fee: fee,
            tip: empId && r() < 0.18 ? pick(r, [10, 20, 20, 40]) : 0,
            employee_id: null,
          };
          ledger_entries.push(pay);
          mirror(pay, empId, cust.name as string);
        }
      }
    }
  }

  // Prepaid credit on a slice of plan clients.
  for (const p of activePlans.slice(0, 40)) {
    const c = customers.find((x) => x.id === p.customer_id)!;
    const amt = Number(p.per_visit_price) * 6;
    const pay: Row = { id: uid(5, le++), created_at: iso(addDays(today, -20)), customer_id: c.id, appointment_id: null, plan_id: p.id, kind: "payment", amount: amt, method: "zelle", occurred_on: addDays(today, -20), memo: "Prepaid 6 visits upfront", collected_by: "owner", settled_on: addDays(today, -19), processor_fee: 0 };
    ledger_entries.push(pay);
    mirror(pay, null, c.name as string);
  }

  // Company money: seed capital + the normal cost of doing big business.
  const expenses: Row[] = [];
  for (let m = 0; m < 13; m++) {
    const monthStart = `${addDays(today, -m * 30).slice(0, 7)}-01`;
    for (const [category, amount, memo] of [
      ["supplies", 2400 + r() * 1800, "Chemical guys bulk order"],
      ["fuel", 1800 + r() * 900, "Fleet fuel"],
      ["equipment", 900 + r() * 3200, "Extractors + pads"],
      ["insurance", 1450, "Commercial policy"],
      ["marketing", 2500 + r() * 2500, "Google + Meta ads"],
    ] as [string, number, string][]) {
      const occurred = addDays(monthStart, Math.floor(r() * 26));
      if (occurred > today) continue;
      const id = uid(6, expenses.length);
      const amt = Math.round(amount);
      expenses.push({ id, occurred_on: occurred, category, amount: amt, memo, recurring_id: null, created_at: iso(occurred) });
      company_ledger.push({ id: uid(9, cl++), occurred_on: occurred, kind: "expense", party: null, employee_id: null, amount: -amt, memo, ledger_entry_id: null, expense_id: id, collected_by: null, settled_on: null, created_at: iso(occurred) });
    }
  }
  for (const [ago, amt] of [[380, 75000], [200, 50000], [60, 40000]] as const) {
    company_ledger.push({ id: uid(9, cl++), occurred_on: addDays(today, -ago), kind: "capital", party: null, employee_id: null, amount: amt, memo: "Owner capital", ledger_entry_id: null, expense_id: null, collected_by: null, settled_on: null, created_at: iso(addDays(today, -ago)) });
  }

  const recurring_expenses: Row[] = [
    ["Supabase", "other", 25, 3], ["Insurance", "insurance", 1450, 12], ["Google Workspace", "other", 84, 1], ["Van lease", "equipment", 1290, 5],
  ].map(([name, category, expected, day], i) => ({ id: uid(7, i), name, category, expected_amount: expected, cadence: "monthly", due_day: day, due_month: null, active: true, created_at: iso(addDays(today, -300)) }));

  const payment_requests: Row[] = active.slice(10, 18).map((c, i) => ({
    id: uid(8, i), created_at: iso(addDays(today, -i - 1)), customer_id: c.id, appointment_id: null, plan_id: null, kind: "balance",
    amount: 249 + i * 40, visits: null, discount: 0, memo: null, stripe_session_id: null, url: null, status: i < 3 ? "pending" : "paid",
    paid_at: i < 3 ? null : iso(addDays(today, -i)), processor_fee: null, ledger_entry_id: null,
  }));

  const reminders: Row[] = [
    ["Call the Whitakers about a ceramic package", 0], ["Restock pads + microfiber", 1], ["Quote the Pelican Bay HOA fleet", 3], ["Follow up — Royal Harbor boat", 6],
  ].map(([title, inDays], i) => ({ id: uid(10, i), created_at: iso(addDays(today, -5)), due_on: addDays(today, inDays as number), title, body: null, customer_id: i % 2 ? null : active[i * 11].id, vehicle_ids: [], sent_at: null, done_at: null }));

  const outreach_log: Row[] = active.slice(0, 60).map((c, i) => ({ id: uid(11, i), created_at: iso(addDays(today, -i)), customer_id: c.id, occurred_on: addDays(today, -i), outcome: pick(r, ["booked", "booked", "follow_up", "asked_review", "left_review"]), note: null }));

  const balance = new Map<string, number>();
  for (const e of ledger_entries) balance.set(e.customer_id as string, (balance.get(e.customer_id as string) ?? 0) + Number(e.amount));
  const customer_balances: Row[] = customers.map((c) => ({ customer_id: c.id, name: c.name, balance: Math.round((balance.get(c.id as string) ?? 0) * 100) / 100 }));

  const data: Dataset = {
    customers, vehicles, plans, plan_vehicles, appointments, appointment_vehicles, appointment_employees, appointment_events, appointment_photos,
    ledger_entries, company_ledger, customer_balances, expenses, recurring_expenses, payment_requests,
    reminders, outreach_log, blocks: [], customer_not_duplicates: [], email_signups: [],
    customer_messages: [], customer_insights: [], text_sync_runs: [],
  };
  cache = { key, data };
  return data;
}
