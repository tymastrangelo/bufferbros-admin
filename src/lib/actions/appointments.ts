"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { cancelledEmail, confirmedEmail, sendEmail, updatedEmail, type JobEmailInfo } from "@/lib/email";
import { normalizeEmail, normalizePhone } from "@/lib/format";
import { notify as sendPush } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { whenLabel } from "@/lib/time";
import type { Addon, Appointment, PaymentMethod } from "@/lib/types";

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
}

export async function createAppointment(input: NewAppointment): Promise<ActionResult> {
  const db = await createClient();
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
    p_customer_id: input.customerId || null,
    p_vehicle_id: input.vehicleId || null,
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
  const push = `${contact.name} · ${whenLabel(appt.date, appt.start_min)} · ${appt.service_name} · $${appt.price}`;
  after(() => sendPush(other, "New job scheduled", push, "/calendar"));
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
  refresh();
  return { ok: true, id };
}

export async function setAppointmentStatus(id: string, status: "scheduled" | "no_show"): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db
    .from("appointments")
    .update({ status, completed_at: null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export async function completeAppointment(
  id: string,
  finalPrice: number,
  payment?: { amount: number; method: PaymentMethod; memo?: string } | null,
  note?: string | null
): Promise<ActionResult> {
  const db = await createClient();
  const appt = await getAppt(id);
  if (!appt) return { ok: false, error: "Appointment not found." };

  const { error } = await db
    .from("appointments")
    .update({ status: "completed", completed_at: new Date().toISOString(), price: finalPrice, completion_note: note || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };

  if ((await getRole()) === "washer") {
    const contact = await resolveContact(appt);
    const push =
      `${contact.name} · $${finalPrice}` +
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
    }
  }
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
  refresh();
  return { ok: true, id };
}

/** Link a web booking to an existing customer. */
export async function linkAppointmentToCustomer(id: string, customerId: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("appointments").update({ customer_id: customerId }).eq("id", id);
  if (error) return { ok: false, error: error.message };
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
