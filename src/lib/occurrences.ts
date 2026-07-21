// Materializes recurring-plan appointments 8 weeks ahead. Shared by the
// "Schedule visits" action and the weekly Vercel cron. Conflicting dates are
// reported for manual placement, never silently moved (spec §5.5).
import type { SupabaseClient } from "@supabase/supabase-js";
import { confirmedEmail, sendEmail } from "@/lib/email";
import { syncAppointmentToGcal } from "@/lib/gcal";
import { addDays, todayYmd, weekdayOf, whenLabel } from "@/lib/time";
import type { Appointment, Plan } from "@/lib/types";

export interface OccurrenceConflict {
  planId: string;
  customerName: string;
  date: string;
  reason: string;
}

export interface GenerateResult {
  created: number;
  conflicts: OccurrenceConflict[];
}

type PlanWithCustomer = Plan & {
  customers: { name: string; email: string | null; phone: string | null } | null;
};

const DEFAULT_HORIZON_DAYS = 56; // 8 weeks — used by the weekly cron

function stepDays(plan: Plan): number {
  switch (plan.cadence) {
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 28; // ponytail: monthly = every 4 weeks so the weekday holds; calendar-month stepping if a customer ever needs it
    default:
      return plan.interval_days ?? 28;
  }
}

export async function generateOccurrences(
  db: SupabaseClient,
  planId?: string,
  untilYmd?: string
): Promise<GenerateResult> {
  const today = todayYmd();
  const horizon = untilYmd ?? addDays(today, DEFAULT_HORIZON_DAYS);

  let query = db.from("plans").select("*, customers(name,email,phone)").eq("status", "active");
  if (planId) query = query.eq("id", planId);
  const { data: plans, error } = await query;
  if (error) throw new Error(error.message);

  const result: GenerateResult = { created: 0, conflicts: [] };

  for (const plan of (plans ?? []) as PlanWithCustomer[]) {
    const customerName = plan.customers?.name ?? "Unknown customer";
    const step = stepDays(plan);

    const { data: appts } = await db
      .from("appointments")
      .select("date,status")
      .eq("plan_id", plan.id);
    // Any existing appointment (even cancelled) means that date was handled by a human.
    const handled = new Set((appts ?? []).map((a) => a.date));
    const activeDates = (appts ?? [])
      .filter((a) => a.status !== "cancelled")
      .map((a) => a.date)
      .sort();

    let cursor: string;
    if (activeDates.length) {
      cursor = addDays(activeDates[activeDates.length - 1], step);
    } else {
      cursor = plan.starts_on > today ? plan.starts_on : today;
      if (plan.preferred_dow != null) {
        while (weekdayOf(cursor) !== plan.preferred_dow) cursor = addDays(cursor, 1);
      }
    }

    while (cursor <= horizon && (!plan.ends_on || cursor <= plan.ends_on)) {
      if (cursor >= today && !handled.has(cursor)) {
        if (plan.preferred_min == null) {
          result.conflicts.push({
            planId: plan.id,
            customerName,
            date: cursor,
            reason: "No preferred time set on the plan",
          });
        } else {
          const { data: booked, error: bookErr } = await db.rpc("book_appointment", {
            p_date: cursor,
            p_start_min: plan.preferred_min,
            p_duration_min: plan.duration_min,
            p_name: plan.customers?.name ?? null,
            p_email: plan.customers?.email ?? null,
            p_phone: plan.customers?.phone ?? null,
            p_address: plan.address,
            p_price: plan.per_visit_price,
            p_notes: null,
            p_source: "recurring",
            p_customer_id: plan.customer_id,
            p_vehicle_id: plan.vehicle_id,
            p_plan_id: plan.id,
            p_mode: "overlap",
          });
          if (bookErr) {
            result.conflicts.push({
              planId: plan.id,
              customerName,
              date: cursor,
              reason: bookErr.message.includes("slot_taken")
                ? "Preferred time overlaps another job or block"
                : bookErr.message,
            });
          } else {
            result.created++;
            await syncAppointmentToGcal((booked as Appointment).id);
            if (plan.email_confirmations && plan.customers?.email) {
              const { subject, html } = confirmedEmail({
                name: plan.customers.name,
                when: whenLabel(cursor, plan.preferred_min),
                address: plan.address,
                serviceName: "The Standard Detail",
                price: plan.per_visit_price,
              });
              await sendEmail(plan.customers.email, subject, html);
            }
          }
        }
      }
      cursor = addDays(cursor, step);
    }
  }
  return result;
}
