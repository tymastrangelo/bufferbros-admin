"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { reseedChecklist, seedChecklist } from "@/lib/checklist";
import { getCatalog } from "@/lib/queries";
import { cancelledEmail, confirmedEmail, sendEmail, updatedEmail, type JobEmailInfo } from "@/lib/email";
import { normalizeEmail, normalizePhone } from "@/lib/format";
import { syncAppointmentToGcal } from "@/lib/gcal";
import { change, customerName, logActivity, notify as sendPush, usd } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { addDays, diffDays, fmtDateShort, nowMinutes, todayYmd, whenLabel } from "@/lib/time";
import type { Addon, Appointment, PaymentMethod } from "@/lib/types";
import { cancelPaymentRequest, sendPaymentRequest } from "./stripe";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const refresh = () => revalidatePath("/", "layout");

// Google review link (keep in sync with scripts/client-texts/summarize.mjs). A reminder body that
// contains "g.page/r/" is treated as a review ask everywhere (reminders-card, the close trigger).
const REVIEW_LINK = "https://g.page/r/CXiiEGVufNEdEAE/review";

const addonNames = (a: Addon[] | null | undefined) => (a ?? []).map((x) => x.name).join(", ") || "none";

function friendly(message: string): string {
  return message.includes("slot_taken")
    ? "That time overlaps another job or a blocked window. Pick another slot, or use “Book anyway.”"
    : message;
}

export interface NewAppointment {
  date: string;
  startMin: number;
  durationMin: number;
  price: number;
  sizeId?: string | null;
  sizeLabel?: string | null;
  serviceName?: string;
  addons?: Addon[];
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  customerId?: string | null;
  /** All vehicles this visit covers; the first doubles as the legacy vehicle_id. */
  vehicleIds?: string[];
  /** Workers assigned to the job; [] (default) = the owner's own booking. */
  employeeIds?: string[];
  planId?: string | null;
  force?: boolean;
  notify?: boolean;
  /** Ceramic coating job: enforces the lead-time rule and flags the deposit in the push. */
  ceramic?: boolean;
  /** Gate code / parking / water — saved on the customer so every job shows it. */
  siteNotes?: string | null;
  /** One-off new customer: the car they booked, created with them. */
  newVehicle?: { size_id: string; kind: "car" | "boat"; make?: string | null; model?: string | null; year?: number | null; color?: string | null; plate?: string | null; length_ft?: number | null } | null;
}

const fmtDur = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
};

export async function createAppointment(input: NewAppointment): Promise<ActionResult> {
  const db = await createClient();

  let depositNote = "";
  if (input.ceramic) {
    const { data: rows } = await db.from("settings").select("*").in("key", ["ceramic_lead_days", "ceramic_deposit_pct"]);
    const settings = Object.fromEntries(((rows ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const leadDays = Number(settings.ceramic_lead_days) || 7;
    if (!input.force && diffDays(todayYmd(), input.date) < leadDays) {
      return {
        ok: false,
        error: `Ceramic coating needs at least ${leadDays} days notice (prep, weather window, deposit). Pick a later date, or use “Book anyway” to override.`,
      };
    }
    const depositPct = Number(settings.ceramic_deposit_pct) || 50;
    depositNote = ` · collect ${Math.round((input.price * depositPct) / 100)} deposit`;
  }

  // Quick-add: a typed one-off name becomes a real customer (or links to an existing
  // one by phone/email), so the ledger, Stripe links, and payment status all work.
  // Web bookings still arrive unlinked on purpose — the owner matches those by hand.
  let customerId = input.customerId || null;
  let vehicleIds = input.vehicleIds ?? [];
  if (!customerId && input.name?.trim()) {
    const phone = normalizePhone(input.phone);
    const email = normalizeEmail(input.email);
    const matches = [phone && `phone.eq.${phone}`, email && `email.eq.${email}`].filter(Boolean) as string[];
    const { data: existing } = matches.length
      ? await db.from("customers").select("id").or(matches.join(",")).limit(1).maybeSingle()
      : { data: null };
    if (existing) {
      customerId = existing.id;
    } else {
      const { data: created } = await db
        .from("customers")
        .insert({
          name: input.name.trim(),
          phone,
          email,
          addresses: input.address?.trim() ? [{ label: "Home", address: input.address.trim() }] : [],
          site_notes: input.siteNotes?.trim() || null,
          source: "manual",
        })
        .select("id")
        .single();
      if (created) {
        customerId = created.id;
        const nv = input.newVehicle ?? (input.sizeId ? { size_id: input.sizeId, kind: "car" as const } : null);
        if (nv) {
          const { data: v } = await db
            .from("vehicles")
            .insert({
              customer_id: customerId,
              size_id: nv.size_id,
              kind: nv.kind,
              make: nv.make?.trim() || null,
              model: nv.model?.trim() || null,
              year: nv.year ?? null,
              color: nv.color?.trim() || null,
              plate: nv.plate?.trim().toUpperCase() || null,
              length_ft: nv.length_ft ?? null,
            })
            .select("id")
            .single();
          if (v) vehicleIds = [v.id];
        }
      }
      // insert failure: fall through and book as a plain one-off — never lose the booking
    }
  }
  // Site notes live on the customer (gate code, parking) — save edits made while booking.
  if (customerId && input.siteNotes !== undefined) {
    const { data: cur } = await db.from("customers").select("site_notes").eq("id", customerId).maybeSingle();
    const next = input.siteNotes?.trim() || null;
    if (cur && (cur.site_notes ?? null) !== next) await db.from("customers").update({ site_notes: next }).eq("id", customerId);
  }
  const { data, error } = await db.rpc("book_appointment", {
    p_date: input.date,
    p_start_min: input.startMin,
    p_duration_min: input.durationMin,
    p_name: input.name || null,
    p_email: normalizeEmail(input.email),
    p_phone: normalizePhone(input.phone),
    p_address: input.address || null,
    p_size_id: input.sizeId || null,
    p_size_label: input.sizeLabel || null,
    p_service_name: input.serviceName || "The Standard Detail",
    p_addons: input.addons ?? [],
    p_price: input.price,
    p_notes: input.notes || null,
    p_source: "manual",
    p_customer_id: customerId,
    p_vehicle_id: vehicleIds[0] ?? null,
    p_plan_id: input.planId || null,
    p_mode: input.force ? "force" : "overlap",
    // [] = owner's booking: only business blocks + unassigned jobs conflict.
    p_employee_ids: input.employeeIds ?? [],
  });
  if (error) return { ok: false, error: friendly(error.message) };

  const appt = data as Appointment;
  // What's included, ready to tick on site (service steps + one per add-on).
  {
    const catalog = await getCatalog();
    const steps = input.ceramic ? catalog.checklists.ceramic : /^boat/i.test(input.serviceName ?? "") ? [] : catalog.checklists.standard;
    const checklist = seedChecklist(steps, input.addons ?? []);
    if (checklist.length) await db.from("appointments").update({ checklist }).eq("id", appt.id);
  }
  if (vehicleIds.length) {
    // Booking exists either way — a failed link just loses the per-car list, not the job.
    const { error: vehErr } = await db
      .from("appointment_vehicles")
      .insert(vehicleIds.map((vehicle_id) => ({ appointment_id: appt.id, vehicle_id })));
    if (vehErr) console.error("appointment_vehicles insert:", vehErr.message);
  }
  const contact = await resolveContact(appt);
  if (input.notify && contact.email) {
    const { subject, html } = confirmedEmail(emailInfo(appt, contact.name));
    const to = contact.email;
    after(() => sendEmail(to, subject, html)); // don't make the owner wait on Resend
  }
  if ((await getRole()) === "owner") {
    const push = `${contact.name} · ${whenLabel(appt.date, appt.start_min)} · ${appt.service_name} · $${appt.price}${depositNote}`;
    after(() => sendPush("washer", "New job scheduled", push, "/calendar", { tags: ["calendar"] }));
  } else {
    await logActivity(
      `booked ${contact.name}`,
      [
        `${whenLabel(appt.date, appt.start_min)} · ${fmtDur(appt.duration_min)}`,
        `${appt.service_name}${appt.size_label ? ` (${appt.size_label})` : ""} · ${usd(appt.price)}`,
        appt.addons.length > 0 && `Add-ons: ${addonNames(appt.addons)}`,
        appt.address && `At ${appt.address}`,
        depositNote && depositNote.replace(" · ", "").replace(/^collect (\d+)/, "Collect $$$1"),
        input.force && "Booked over a conflict (Book anyway)",
        input.notify && contact.email ? `Confirmation emailed to ${contact.email}` : "Customer not emailed",
      ],
      "/calendar",
      { tags: ["calendar"] }
    );
  }
  after(() => syncAppointmentToGcal(appt.id));
  refresh();
  return { ok: true, id: appt.id };
}

async function getAppt(id: string): Promise<Appointment | null> {
  const db = await createClient();
  const { data } = await db.from("appointments").select("*").eq("id", id).single();
  return data as Appointment | null;
}

async function resolveContact(appt: Appointment): Promise<{ name: string; email: string | null }> {
  if (appt.contact_email || !appt.customer_id) {
    return { name: appt.contact_name || "there", email: appt.contact_email };
  }
  const db = await createClient();
  const { data } = await db.from("customers").select("name,email").eq("id", appt.customer_id).single();
  return { name: appt.contact_name || data?.name || "there", email: data?.email ?? null };
}

function emailInfo(appt: Appointment, name: string): JobEmailInfo {
  return {
    name,
    when: whenLabel(appt.date, appt.start_min),
    address: appt.address,
    serviceName: appt.service_name,
    addons: appt.addons,
    price: appt.price,
  };
}

export async function rescheduleAppointment(
  id: string,
  next: { date: string; startMin: number; durationMin: number },
  notify: boolean
): Promise<ActionResult> {
  const db = await createClient();
  const before = await getAppt(id);
  if (!before) return { ok: false, error: "Appointment not found." };

  const changed =
    before.date !== next.date || before.start_min !== next.startMin || before.duration_min !== next.durationMin;
  const { error } = await db
    .from("appointments")
    .update({ date: next.date, start_min: next.startMin, duration_min: next.durationMin, status: "scheduled" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const timeChanged = before.date !== next.date || before.start_min !== next.startMin;
  if (changed && timeChanged) {
    const contact = await resolveContact(before);
    if (notify && contact.email) {
      const { subject, html } = updatedEmail({
        ...emailInfo({ ...before, ...{ date: next.date, start_min: next.startMin } }, contact.name),
        oldWhen: whenLabel(before.date, before.start_min),
      });
      const to = contact.email;
      after(() => sendEmail(to, subject, html));
    }
    if ((await getRole()) === "owner") {
      const push = `${contact.name} · was ${whenLabel(before.date, before.start_min)}, now ${whenLabel(next.date, next.startMin)}`;
      after(() => sendPush("washer", "Job rescheduled", push, "/calendar", { tags: ["arrows_counterclockwise"] }));
    }
  }
  if (changed) {
    const contact = await resolveContact(before);
    await logActivity(
      `rescheduled ${contact.name}`,
      [
        `Was ${whenLabel(before.date, before.start_min)} (${fmtDur(before.duration_min)})`,
        `Now ${whenLabel(next.date, next.startMin)} (${fmtDur(next.durationMin)})`,
        before.service_name,
        timeChanged && (notify && contact.email ? `Customer emailed the new time` : "Customer NOT told — reach out"),
      ],
      "/calendar",
      { tags: ["arrows_counterclockwise"] }
    );
  }
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

export async function cancelAppointment(id: string, notify: boolean): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };
  const { error } = await db.from("appointments").update({ status: "cancelled" }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const contact = await resolveContact(appt);
  if (notify && contact.email) {
    const { subject, html } = cancelledEmail({ name: contact.name, when: whenLabel(appt.date, appt.start_min) });
    const to = contact.email;
    after(() => sendEmail(to, subject, html));
  }
  // Declining a pending web booking skips the crew push — they never saw it.
  if (appt.status === "scheduled" && (await getRole()) === "owner") {
    const push = `${contact.name} · ${whenLabel(appt.date, appt.start_min)}`;
    after(() => sendPush("washer", "Job cancelled", push, "/calendar", { tags: ["x"] }));
  }
  await logActivity(
    appt.status === "pending" ? `declined ${contact.name}'s web booking` : `cancelled ${contact.name}'s job`,
    [
      `${whenLabel(appt.date, appt.start_min)} · ${appt.service_name} · ${usd(appt.price)}`,
      notify && contact.email ? `Cancellation emailed to ${contact.email}` : "Customer NOT told — reach out",
    ],
    "/calendar",
    { tags: ["x"], priority: 4 }
  );
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

export async function setAppointmentStatus(id: string, status: "scheduled" | "no_show"): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };
  // Reopening a completed job is owner-only (the DB trigger backstops this too).
  if (appt.status === "completed" && (await getRole()) !== "owner") {
    return { ok: false, error: "Only Tyler can reopen a completed job." };
  }
  const { error } = await db
    .from("appointments")
    .update({ status, completed_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (appt.status === "completed") {
    // Un-completing takes the job's charge back off the books, so a reopened or
    // cancelled detail no longer counts toward what the customer owes. Re-completing
    // books a fresh charge. Payments stay — that's money actually received.
    const { error: chargeErr } = await db.from("ledger_entries").delete().eq("appointment_id", id).eq("kind", "charge");
    if (chargeErr) return { ok: false, error: `Job reopened, but removing its charge failed: ${chargeErr.message}` };
    // Kill any live Stripe link for this job — the charge it was collecting is gone.
    const { data: openLinks } = await db.from("payment_requests").select("id").eq("appointment_id", id).eq("status", "pending");
    for (const r of openLinks ?? []) await cancelPaymentRequest(r.id);
    const contact = await resolveContact(appt);
    after(() => sendPush("washer", "Job reopened", `${contact.name} · ${whenLabel(appt.date, appt.start_min)} is back on the schedule`, "/calendar", { tags: ["arrows_counterclockwise"] }));
  }
  const who = (await resolveContact(appt)).name;
  await logActivity(
    status === "no_show" ? `marked ${who} a no-show` : `put ${who}'s job back on the schedule`,
    [`${whenLabel(appt.date, appt.start_min)} · ${appt.service_name} · ${usd(appt.price)}`, `Was: ${appt.status.replace("_", "-")}`],
    "/calendar",
    { tags: [status === "no_show" ? "warning" : "arrows_counterclockwise"], priority: status === "no_show" ? 4 : 3 }
  );
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

/** Washer or owner taps "Start job" — starts the clock for the detail-duration stat. */
export async function startAppointment(id: string): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };
  if (appt.status !== "scheduled") return { ok: false, error: "Only scheduled jobs can be started." };
  if (appt.started_at) return { ok: false, error: "Already started." };
  const { error } = await db.from("appointments").update({ started_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const contact = await resolveContact(appt);
  const late = appt.date === todayYmd() ? nowMinutes() - appt.start_min : 0;
  await logActivity(
    `started ${contact.name}'s detail`,
    [
      `${appt.service_name} · ${usd(appt.price)} · booked ${fmtDur(appt.duration_min)}`,
      `Scheduled ${whenLabel(appt.date, appt.start_min)}`,
      appt.address && `At ${appt.address}`,
      late > 15 && late < 600 && `Started about ${fmtDur(late)} late`,
    ],
    "/",
    { tags: ["arrow_forward"] }
  );
  refresh();
  return { ok: true, id };
}

/** Owner-only: fix the recorded start/completion timestamps on a completed job. */
export async function adjustJobTimes(
  id: string,
  times: { startedAt: string | null; completedAt: string }
): Promise<ActionResult> {
  // activity: owner-only (returns early for workers)
  if ((await getRole()) !== "owner") return { ok: false, error: "Only Tyler can adjust job times." };
  if (times.startedAt && new Date(times.startedAt) >= new Date(times.completedAt)) {
    return { ok: false, error: "Start time must be before completion time." };
  }
  const db = await createClient();
  const { error } = await db
    .from("appointments")
    .update({ started_at: times.startedAt, completed_at: times.completedAt })
    .eq("id", id)
    .eq("status", "completed");
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export async function completeAppointment(
  id: string,
  finalPrice: number,
  payment?: { amount: number; method: PaymentMethod; memo?: string; tip?: number } | null,
  note?: string | null,
  /** Email a Stripe checkout link for the final price instead of collecting now. */
  stripeLink = false,
  /** Keep-all-the-money: no worker split on this job (owner did it himself). */
  keepAll = false,
  /** Who did the detail; null = the owner. Ignored for washers (always themselves). */
  employeeId?: string | null
): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };

  const role = await getRole();
  // A washer completing a job is the one who did it; only the owner assigns or keeps all.
  let empId: string | null = employeeId ?? null;
  if (role !== "owner") {
    const {
      data: { user },
    } = await db.auth.getUser();
    const { data: mine } = await db.from("employees").select("id").eq("user_id", user!.id).maybeSingle();
    empId = mine?.id ?? appt.employee_id ?? null;
  }
  const self = keepAll && role === "owner" && !empId;
  // Whoever gets paid for it was on it: add them to the assignees (never drop the others).
  await ensureAssignee(db, id, empId);
  const completedAt = new Date();
  // self_done/employee_id land before the payment insert so the mirror trigger splits it right.
  const { error } = await db
    .from("appointments")
    .update({
      status: "completed",
      completed_at: completedAt.toISOString(),
      price: finalPrice,
      completion_note: note || null,
      self_done: self,
      employee_id: empId,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const tookMin = appt.started_at ? (completedAt.getTime() - new Date(appt.started_at).getTime()) / 60000 : null;
  {
    const contact = await resolveContact(appt);
    await logActivity(
      `completed ${contact.name}'s detail`,
      [
        `${appt.service_name} · ${usd(finalPrice)}${Number(appt.price) !== finalPrice ? ` (booked at ${usd(appt.price)})` : ""}`,
        tookMin != null && tookMin > 0 ? `Took ${fmtDur(tookMin)} (booked ${fmtDur(appt.duration_min)})` : "No start time — clock wasn't started",
        payment && payment.amount > 0
          ? `Collected ${usd(payment.amount)} ${payment.method}${payment.amount < finalPrice ? ` — ${usd(finalPrice - payment.amount)} still owed` : ""}`
          : stripeLink
            ? `No payment yet — Stripe link emailed for ${usd(finalPrice)}`
            : appt.customer_id
              ? `No payment collected — ${usd(finalPrice)} now owed`
              : "No payment collected (not linked to a customer)",
        note && `Note: “${note}”`,
      ],
      appt.customer_id ? `/customers/${appt.customer_id}` : "/",
      { tags: ["white_check_mark"] }
    );
  }

  // Ride the glow: after a completed detail, queue a next-day Google-review nudge in Reminders —
  // unless they've already left one, were asked in the last month, or one's already waiting. Best
  // effort: a missed review nudge must never fail a completed job.
  if (appt.customer_id) {
    try {
      const { data: cust } = await db
        .from("customers")
        .select("name, review_left_on, review_asked_on")
        .eq("id", appt.customer_id)
        .maybeSingle();
      const askedRecently = !!cust?.review_asked_on && diffDays(cust.review_asked_on, todayYmd()) < 30;
      if (cust && !cust.review_left_on && !askedRecently) {
        const { count } = await db
          .from("reminders")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", appt.customer_id)
          .is("done_at", null)
          .like("body", "%g.page/r/%");
        if (!count) {
          const first = cust.name.split(/\s+/)[0] || cust.name;
          await db.from("reminders").insert({
            customer_id: appt.customer_id,
            due_on: addDays(todayYmd(), 1),
            title: `Ask ${cust.name} for a Google review`,
            body: `Text: Hey ${first}, hope it's still looking great after the detail! If you have a sec, a quick Google review really helps us out: ${REVIEW_LINK}`,
          });
        }
      }
    } catch {
      /* non-fatal: the detail is already marked complete */
    }
  }

  if (appt.customer_id) {
    // Re-completing a reopened job: its payments survived the reopen, so don't book another.
    if (payment && payment.amount > 0) {
      const { data: paid } = await db.from("ledger_entries").select("amount").eq("appointment_id", id).eq("kind", "payment");
      const already = (paid ?? []).reduce((s, r) => s + Number(r.amount), 0);
      if (already > 0) {
        return {
          ok: false,
          error: `${usd(already)} was already collected on this job. Pick "Put on balance" to complete it without a second payment, or adjust the existing one on the customer's ledger.`,
        };
      }
    }
    const { error: chargeErr } = await db.from("ledger_entries").insert({
      customer_id: appt.customer_id,
      appointment_id: id,
      plan_id: appt.plan_id,
      kind: "charge",
      amount: -Math.abs(finalPrice),
      occurred_on: appt.date,
      memo: appt.service_name,
    });
    if (chargeErr) return { ok: false, error: chargeErr.message };

    if (payment && payment.amount > 0) {
      const { error: payErr } = await db.from("ledger_entries").insert({
        customer_id: appt.customer_id,
        appointment_id: id,
        plan_id: appt.plan_id,
        kind: "payment",
        amount: Math.abs(payment.amount),
        method: payment.method,
        occurred_on: appt.date,
        memo: payment.memo || null,
        tip: Math.max(0, Number(payment.tip ?? 0)),
        collected_by: role, // was silently defaulting to 'owner' even when Gabe collected
        // Self-done + owner-collected: no Gabe transfer exists, so it's born settled.
        ...(self ? { settled_on: appt.date } : {}),
      });
      if (payErr) return { ok: false, error: payErr.message };
    } else if (stripeLink) {
      const link = await sendPaymentRequest({
        customerId: appt.customer_id,
        amount: finalPrice,
        kind: "job",
        appointmentId: id,
        planId: appt.plan_id,
        what: `${appt.service_name} — ${fmtDateShort(appt.date)}`,
      });
      if (!link.ok) {
        // Job is completed and charged either way — the link just needs a retry
        // from the customer's profile. Tell the owner instead of failing the action.
        after(() =>
          sendPush("owner", "Stripe link NOT sent", `${link.error ?? "Unknown error"}\nThe job is completed and charged — resend the link from their profile.`, `/customers/${appt.customer_id}`, {
            tags: ["warning"],
            priority: 4,
          })
        );
        refresh();
        return { ok: true, id };
      }
    }
  }
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

/**
 * Owner-only: change who did a detail (or keep-all-the-money) on any job, past or
 * present. The DB re-mirror trigger rebuilds the payout split on its payments.
 */
export async function setJobAttribution(
  id: string,
  employeeId: string | null,
  keepAll: boolean
): Promise<ActionResult> {
  // activity: owner-only (returns early for workers)
  if ((await getRole()) !== "owner") return { ok: false, error: "Only Tyler can change who did a job." };
  const db = await createClient();
  const { error } = await db
    .from("appointments")
    .update({ employee_id: employeeId, self_done: keepAll && !employeeId })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await ensureAssignee(db, id, employeeId);
  refresh();
  return { ok: true, id };
}

/** The payee is always among the assignees; the other assignees stay. */
async function ensureAssignee(db: Awaited<ReturnType<typeof createClient>>, id: string, employeeId: string | null) {
  if (!employeeId) return;
  const { error } = await db.from("appointment_employees").upsert({ appointment_id: id, employee_id: employeeId }, { onConflict: "appointment_id,employee_id" });
  if (error) console.error("appointment_employees upsert:", error.message);
}

/**
 * Owner-only: who's on a scheduled job (scheduling side). Replaces the assignment rows
 * and points the payee default at the first assignee, the same way booking does. [] = the owner.
 */
export async function setAssignees(id: string, employeeIds: string[]): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can assign jobs." };
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };
  if (appt.status === "completed") return { ok: false, error: "Use “Who did it” on a completed job." };
  const ids = Array.from(new Set(employeeIds));
  const { data: emps } = ids.length ? await db.from("employees").select("id,name").in("id", ids) : { data: [] };
  if ((emps?.length ?? 0) !== ids.length) return { ok: false, error: "One of those workers no longer exists." };

  await db.from("appointment_employees").delete().eq("appointment_id", id);
  if (ids.length) {
    const { error } = await db.from("appointment_employees").insert(ids.map((employee_id) => ({ appointment_id: id, employee_id })));
    if (error) return { ok: false, error: error.message };
  }
  const { error } = await db.from("appointments").update({ employee_id: ids[0] ?? null, self_done: false }).eq("id", id);
  if (error) return { ok: false, error: error.message };

  const contact = await resolveContact(appt);
  const names = (emps ?? []).map((e) => e.name);
  await logActivity(
    `assigned ${contact.name}'s job`,
    [`Now: ${names.length ? names.join(" + ") : "Me"}`, whenLabel(appt.date, appt.start_min)],
    `/calendar?view=day&d=${appt.date}`,
    { tags: ["calendar"] }
  );
  refresh();
  return { ok: true, id };
}

/** Tick / untick one checklist item on a job. Anyone signed in (workers do this on site). */
export async function setChecklistItem(id: string, itemId: string, done: boolean): Promise<ActionResult> {
  // activity: ticking is noise — completion pushes the summary instead
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };
  const checklist = (appt.checklist ?? []).map((i) => (i.id === itemId ? { ...i, done } : i));
  const { error } = await db.from("appointments").update({ checklist }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

/** Gate code / parking / water — lives on the customer so every job shows it. */
export async function setSiteNotes(customerId: string, notes: string): Promise<ActionResult> {
  const db = await createClient();
  const next = notes.trim().slice(0, 500) || null;
  const { data: cust } = await db.from("customers").select("name,site_notes").eq("id", customerId).maybeSingle();
  if (!cust) return { ok: false, error: "Customer not found." };
  if ((cust.site_notes ?? null) === next) return { ok: true, id: customerId };
  const { error } = await db.from("customers").update({ site_notes: next }).eq("id", customerId);
  if (error) return { ok: false, error: error.message };
  await logActivity(`updated ${cust.name}'s site notes`, [next ? next.slice(0, 80) : "Cleared"], `/customers/${customerId}`, { tags: ["pencil2"], priority: 3 });
  refresh();
  return { ok: true, id: customerId };
}

export async function updateAppointment(
  id: string,
  fields: Partial<
    Pick<
      Appointment,
      | "addons"
      | "price"
      | "notes"
      | "address"
      | "size_id"
      | "size_label"
      | "duration_min"
      | "service_name"
      | "vehicle_id"
      | "contact_name"
      | "contact_phone"
      | "contact_email"
    >
  >,
  /** When set, replaces the visit's vehicle list (and keeps vehicle_id = first). */
  vehicleIds?: string[]
): Promise<ActionResult> {
  const db = await createClient();
  const before = await getAppt(id);
  if (!before) return { ok: false, error: "Appointment not found." };
  const { error } = await db
    .from("appointments")
    .update({
      ...(vehicleIds ? { ...fields, vehicle_id: vehicleIds[0] ?? null } : fields),
      // add-ons changed → the checklist follows; ticks on surviving items stay
      ...("addons" in fields && fields.addons
        ? {
            checklist: reseedChecklist(
              before.checklist ?? [],
              seedChecklist(
                (before.checklist ?? []).filter((i) => i.id.startsWith("svc:")).map((i) => i.name),
                fields.addons
              )
            ),
          }
        : {}),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  // A completed job's charge follows its price — no need to reopen (which drops the charge)
  // and re-complete (which books a second payment) just to fix a number.
  if (before.status === "completed" && "price" in fields && fields.price != null && Number(fields.price) !== Number(before.price)) {
    const { error: chargeErr } = await db
      .from("ledger_entries")
      .update({ amount: -Math.abs(Number(fields.price)) })
      .eq("appointment_id", id)
      .eq("kind", "charge");
    if (chargeErr) return { ok: false, error: `Price saved, but the charge on the ledger didn't follow: ${chargeErr.message}` };
  }
  if (before) {
    const contact = await resolveContact(before);
    const diffs = [
      "price" in fields && change("Price", Number(before.price), Number(fields.price), (v) => usd(v as number)),
      "service_name" in fields && change("Service", before.service_name, fields.service_name),
      "size_label" in fields && change("Size", before.size_label, fields.size_label),
      "duration_min" in fields && change("Length", before.duration_min, fields.duration_min, (v) => fmtDur(Number(v))),
      "addons" in fields && change("Add-ons", addonNames(before.addons), addonNames(fields.addons)),
      "address" in fields && change("Address", before.address, fields.address),
      "notes" in fields && change("Notes", before.notes, fields.notes),
      "contact_name" in fields && change("Name", before.contact_name, fields.contact_name),
      "contact_phone" in fields && change("Phone", before.contact_phone, fields.contact_phone),
      "contact_email" in fields && change("Email", before.contact_email, fields.contact_email),
      vehicleIds && `Vehicles on the visit: ${vehicleIds.length}`,
    ];
    if (diffs.some(Boolean)) {
      await logActivity(
        `edited ${contact.name}'s job`,
        [`${whenLabel(before.date, before.start_min)} · ${before.service_name}`, ...diffs],
        "/calendar",
        { tags: ["pencil2"] }
      );
    }
  }
  if (vehicleIds) {
    const { error: delErr } = await db.from("appointment_vehicles").delete().eq("appointment_id", id);
    if (delErr) return { ok: false, error: delErr.message };
    if (vehicleIds.length) {
      const { error: insErr } = await db
        .from("appointment_vehicles")
        .insert(vehicleIds.map((vehicle_id) => ({ appointment_id: id, vehicle_id })));
      if (insErr) return { ok: false, error: insErr.message };
    }
  }
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

/** Link a web booking to an existing customer. */
export async function linkAppointmentToCustomer(id: string, customerId: string): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  const { error } = await db.from("appointments").update({ customer_id: customerId }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logActivity(
    `linked a booking to ${await customerName(customerId)}`,
    [appt && `${appt.contact_name ?? "Booking"} · ${whenLabel(appt.date, appt.start_min)} · ${appt.service_name}`],
    `/customers/${customerId}`,
    { tags: ["link"] }
  );
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

/** Create a customer from a web booking's denormalized contact info, then link it. */
export async function createCustomerFromAppointment(id: string): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };
  if (!appt.contact_name) return { ok: false, error: "This booking has no contact name." };

  const { data: customer, error } = await db
    .from("customers")
    .insert({
      name: appt.contact_name,
      phone: normalizePhone(appt.contact_phone),
      email: normalizeEmail(appt.contact_email),
      addresses: appt.address ? [{ label: "Home", address: appt.address }] : [],
      source: "website",
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (appt.size_id) {
    await db.from("vehicles").insert({ customer_id: customer.id, size_id: appt.size_id });
  }
  const { error: linkErr } = await db.from("appointments").update({ customer_id: customer.id }).eq("id", id);
  if (linkErr) return { ok: false, error: linkErr.message };
  await logActivity(
    `added ${appt.contact_name} as a customer`,
    [
      "From their web booking",
      [appt.contact_phone, appt.contact_email].filter(Boolean).join(" · ") || "No phone or email on the booking",
      appt.address,
    ],
    `/customers/${customer.id}`,
    { tags: ["bust_in_silhouette"] }
  );
  refresh();
  return { ok: true, id: customer.id };
}
