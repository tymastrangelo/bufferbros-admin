"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { cancelledEmail, confirmedEmail, sendEmail, updatedEmail, type JobEmailInfo } from "@/lib/email";
import { normalizeEmail, normalizePhone } from "@/lib/format";
import { syncAppointmentToGcal } from "@/lib/gcal";
import { notify as sendPush } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { diffDays, fmtDateShort, todayYmd, whenLabel } from "@/lib/time";
import type { Addon, Appointment, PaymentMethod } from "@/lib/types";
import { cancelPaymentRequest, sendPaymentRequest } from "./stripe";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const refresh = () => revalidatePath("/", "layout");

/** Whoever didn't perform the action gets the push: owner acts → washer hears, and vice versa. */
async function counterpart(): Promise<"owner" | "washer"> {
  return (await getRole()) === "owner" ? "washer" : "owner";
}

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
  vehicleId?: string | null;
  planId?: string | null;
  force?: boolean;
  notify?: boolean;
  /** Ceramic coating job: enforces the lead-time rule and flags the deposit in the push. */
  ceramic?: boolean;
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
  let vehicleId = input.vehicleId || null;
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
          source: "manual",
        })
        .select("id")
        .single();
      if (created) {
        customerId = created.id;
        if (input.sizeId) {
          const { data: v } = await db
            .from("vehicles")
            .insert({ customer_id: customerId, size_id: input.sizeId })
            .select("id")
            .single();
          vehicleId = v?.id ?? null;
        }
      }
      // insert failure: fall through and book as a plain one-off — never lose the booking
    }
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
    p_vehicle_id: vehicleId,
    p_plan_id: input.planId || null,
    p_mode: input.force ? "force" : "overlap",
  });
  if (error) return { ok: false, error: friendly(error.message) };

  const appt = data as Appointment;
  const contact = await resolveContact(appt);
  if (input.notify && contact.email) {
    const { subject, html } = confirmedEmail(emailInfo(appt, contact.name));
    const to = contact.email;
    after(() => sendEmail(to, subject, html)); // don't make the owner wait on Resend
  }
  const other = await counterpart();
  const push = `${contact.name} · ${whenLabel(appt.date, appt.start_min)} · ${appt.service_name} · $${appt.price}${depositNote}`;
  after(() => sendPush(other, "New job scheduled", push, "/calendar"));
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
    const other = await counterpart();
    const push = `${contact.name} · was ${whenLabel(before.date, before.start_min)}, now ${whenLabel(next.date, next.startMin)}`;
    after(() => sendPush(other, "Job rescheduled", push, "/calendar"));
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
  // Declining a pending web booking skips the push — the other person never saw it.
  if (appt.status === "scheduled") {
    const other = await counterpart();
    const push = `${contact.name} · ${whenLabel(appt.date, appt.start_min)}`;
    after(() => sendPush(other, "Job cancelled", push, "/calendar"));
  }
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
    after(() => sendPush("washer", "Job reopened", `${contact.name} · ${whenLabel(appt.date, appt.start_min)} is back on the schedule`, "/calendar"));
  }
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
  if ((await getRole()) === "washer") {
    const contact = await resolveContact(appt);
    after(() => sendPush("owner", "Job started", `${contact.name} · ${appt.service_name}`, "/"));
  }
  refresh();
  return { ok: true, id };
}

/** Owner-only: fix the recorded start/completion timestamps on a completed job. */
export async function adjustJobTimes(
  id: string,
  times: { startedAt: string | null; completedAt: string }
): Promise<ActionResult> {
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
  payment?: { amount: number; method: PaymentMethod; memo?: string } | null,
  note?: string | null,
  /** Email a Stripe checkout link for the final price instead of collecting now. */
  stripeLink = false
): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };

  const completedAt = new Date();
  const { error } = await db
    .from("appointments")
    .update({ status: "completed", completed_at: completedAt.toISOString(), price: finalPrice, completion_note: note || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const tookMin = appt.started_at ? (completedAt.getTime() - new Date(appt.started_at).getTime()) / 60000 : null;
  if ((await getRole()) === "washer") {
    const contact = await resolveContact(appt);
    const push =
      `${contact.name} · $${finalPrice}` +
      (tookMin != null && tookMin > 0 ? ` · took ${fmtDur(tookMin)}` : "") +
      (payment && payment.amount > 0 ? ` · collected $${payment.amount} ${payment.method}` : " · no payment") +
      (note ? `\n“${note}”` : "");
    after(() => sendPush("owner", "Job completed", push));
  }

  if (appt.customer_id) {
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
        after(() => sendPush("owner", "Stripe link not sent", link.error ?? "Unknown error", `/customers/${appt.customer_id}`));
        refresh();
        return { ok: true, id };
      }
    }
  }
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

/** Owner confirms a pending web booking — possibly at an edited time/price. */
export async function approveAppointment(
  id: string,
  next: { date: string; startMin: number; durationMin: number; price: number },
  notifyCustomer: boolean
): Promise<ActionResult> {
  const db = await createClient();
  const before = await getAppt(id);
  if (!before) return { ok: false, error: "Appointment not found." };
  if (before.status !== "pending") return { ok: false, error: "This booking was already handled." };

  const { error } = await db
    .from("appointments")
    .update({ date: next.date, start_min: next.startMin, duration_min: next.durationMin, price: next.price, status: "scheduled" })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  const appt = { ...before, date: next.date, start_min: next.startMin, duration_min: next.durationMin, price: next.price };
  const contact = await resolveContact(appt);
  if (notifyCustomer && contact.email) {
    const { subject, html } = confirmedEmail(emailInfo(appt, contact.name));
    const to = contact.email;
    after(() => sendEmail(to, subject, html));
  }
  const push = `${contact.name} · ${whenLabel(appt.date, appt.start_min)} · ${appt.service_name} · $${appt.price}`;
  after(() => sendPush("washer", "New job on the schedule", push, "/calendar"));
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
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
  >
): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("appointments").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };
  after(() => syncAppointmentToGcal(id));
  refresh();
  return { ok: true, id };
}

/** Link a web booking to an existing customer. */
export async function linkAppointmentToCustomer(id: string, customerId: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("appointments").update({ customer_id: customerId }).eq("id", id);
  if (error) return { ok: false, error: error.message };
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
  refresh();
  return { ok: true, id: customer.id };
}
