// Row types mirroring supabase/migrations/0001_init.sql.
// After the Supabase project exists you can regenerate with:
//   supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
// ponytail: hand-written rows instead of generated Database<> generics — same safety
// for a 12-table schema, zero build-time dependency on a live project.

export type SizeId = "sedan" | "midsize" | "large";
export type AppointmentStatus = "pending" | "scheduled" | "completed" | "cancelled" | "no_show";
export type AppointmentSource = "web" | "manual" | "recurring";
export type PlanStatus = "active" | "paused" | "ended";
export type PlanCadence = "weekly" | "biweekly" | "monthly" | "custom";
export type PaymentMethod = "cash" | "zelle" | "venmo" | "card" | "check" | "other";
export type EntryKind = "charge" | "payment" | "credit" | "refund" | "discount";

export interface Addon {
  id: string;
  name: string;
  price: number;
}

export interface Customer {
  id: string;
  created_at: string;
  name: string;
  phone: string | null;
  email: string | null;
  addresses: { label: string; address: string }[];
  notes: string | null;
  tags: string[];
  source: string | null;
  archived: boolean;
}

export interface Vehicle {
  id: string;
  customer_id: string;
  size_id: SizeId;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  plate: string | null;
  notes: string | null;
}

export interface Service {
  id: string;
  kind: "detail" | "addon";
  name: string;
  note: string | null;
  active: boolean;
  sort: number;
}

export interface ServicePricing {
  service_id: string;
  size_id: string; // SizeId or '*'
  price: number;
  minutes: number;
}

export interface PlanPricing {
  cadence: PlanCadence;
  size_id: SizeId;
  price: number;
}

export interface WeeklyHours {
  weekday: number;
  enabled: boolean;
  open_min: number;
  close_min: number;
}

export interface Block {
  id: string;
  date: string;
  start_min: number;
  end_min: number;
  reason: string | null;
}

export interface Plan {
  id: string;
  created_at: string;
  customer_id: string;
  vehicle_id: string | null;
  cadence: PlanCadence;
  interval_days: number | null;
  per_visit_price: number;
  preferred_dow: number | null;
  preferred_min: number | null;
  duration_min: number;
  address: string | null;
  status: PlanStatus;
  starts_on: string;
  ends_on: string | null;
  billing_note: string | null;
  notes: string | null;
  email_confirmations: boolean;
}

export interface Appointment {
  id: string;
  created_at: string;
  legacy_id: number | null;
  customer_id: string | null;
  vehicle_id: string | null;
  plan_id: string | null;
  source: AppointmentSource;
  status: AppointmentStatus;
  date: string;
  start_min: number;
  duration_min: number;
  size_id: string | null;
  size_label: string | null;
  service_name: string;
  addons: Addon[];
  price: number;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  notes: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_note: string | null;
  gcal_event_id: string | null;
}

export interface LedgerEntry {
  id: string;
  created_at: string;
  customer_id: string;
  appointment_id: string | null;
  plan_id: string | null;
  kind: EntryKind;
  amount: number;
  method: PaymentMethod | null;
  occurred_on: string;
  memo: string | null;
  collected_by: "owner" | "washer";
  settled_on: string | null;
}

export interface Expense {
  id: string;
  occurred_on: string;
  category: string;
  amount: number;
  memo: string | null;
  recurring_id: string | null;
  created_at: string;
}

export type CompanyLedgerKind = "revenue" | "payout" | "capital" | "expense";
export type PayoutParty = "gabe" | "ceo";

export interface CompanyLedgerEntry {
  id: string;
  occurred_on: string;
  kind: CompanyLedgerKind;
  party: PayoutParty | null;
  amount: number; // revenue/capital > 0, payout/expense < 0
  memo: string | null;
  ledger_entry_id: string | null;
  expense_id: string | null;
  collected_by: "owner" | "washer" | null;
  settled_on: string | null;
  created_at: string;
}

export interface RecurringExpense {
  id: string;
  name: string;
  category: string;
  expected_amount: number;
  cadence: "monthly" | "yearly";
  due_day: number;
  due_month: number | null;
  active: boolean;
  created_at: string;
}

export const SIZES: { id: SizeId; label: string }[] = [
  { id: "sedan", label: "Car / Sedan / Coupe" },
  { id: "midsize", label: "Midsize SUV / Truck" },
  { id: "large", label: "Large SUV / Truck" },
];

export const sizeLabel = (id: string | null | undefined) =>
  SIZES.find((s) => s.id === id)?.label ?? id ?? "";

export const EXPENSE_CATEGORIES = ["supplies", "fuel", "equipment", "insurance", "marketing", "other"];
export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "zelle", "venmo", "card", "check", "other"];
