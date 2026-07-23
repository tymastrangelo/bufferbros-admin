"use server";

// Stripe payment requests: create a checkout link, email it, track it until the
// webhook (src/app/api/stripe/webhook) books the money on the ledger.
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getRole } from "@/lib/auth";
import { paymentRequestEmail, sendEmail } from "@/lib/email";
import { notify } from "@/lib/notify";
import { createPaymentLink, deactivatePaymentLink, stripeConfigured } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import type { PaymentRequestKind } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

export interface PaymentRequestFields {
  customerId: string;
  amount: number; // dollars, what they'll be charged
  kind: PaymentRequestKind;
  what: string; // human line for the email + Stripe checkout ("The Standard Detail — Jul 20")
  appointmentId?: string | null;
  planId?: string | null;
  visits?: number | null; // prepay only
  discount?: number; // prepay only: extra ledger credit booked when they pay
  memo?: string | null;
}

export async function sendPaymentRequest(fields: PaymentRequestFields): Promise<ActionResult & { url?: string }> {
  if (!stripeConfigured()) return { ok: false, error: "Stripe isn't set up yet (STRIPE_SECRET_KEY missing)." };
  if (!fields.amount || fields.amount <= 0) return { ok: false, error: "Enter an amount greater than zero." };

  const db = await createClient();
  const { data: customer } = await db.from("customers").select("name,email").eq("id", fields.customerId).single();
  if (!customer) return { ok: false, error: "Customer not found." };
  if (!customer.email) return { ok: false, error: `${customer.name} has no email on file — add one first.` };

  const { data: request, error: insErr } = await db
    .from("payment_requests")
    .insert({
      customer_id: fields.customerId,
      appointment_id: fields.appointmentId || null,
      plan_id: fields.planId || null,
      kind: fields.kind,
      amount: fields.amount,
      visits: fields.visits ?? null,
      discount: fields.discount ?? 0,
      memo: fields.memo?.trim() || null,
    })
    .select("id")
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  let link: { id: string; url: string };
  try {
    link = await createPaymentLink({
      requestId: request.id,
      productName: fields.what,
      amount: fields.amount,
      memo: fields.memo,
    });
  } catch (e) {
    await db.from("payment_requests").delete().eq("id", request.id); // don't leave a dead row
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const { error: updErr } = await db
    .from("payment_requests")
    .update({ stripe_session_id: link.id, url: link.url })
    .eq("id", request.id);
  if (updErr) return { ok: false, error: updErr.message };

  const { subject, html } = paymentRequestEmail({
    name: customer.name,
    amount: fields.amount,
    what: fields.what,
    url: `${link.url}?prefilled_email=${encodeURIComponent(customer.email)}`,
  });
  const to = customer.email;
  after(() => sendEmail(to, subject, html));
  if ((await getRole()) === "washer") {
    after(() => notify("owner", "Payment link sent", `${customer.name} · $${fields.amount} · ${fields.what}`, `/customers/${fields.customerId}`));
  }
  refresh();
  return { ok: true, id: request.id, url: link.url };
}

export async function cancelPaymentRequest(id: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: request } = await db.from("payment_requests").select("stripe_session_id,status").eq("id", id).single();
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "pending") return { ok: false, error: "Only pending requests can be canceled." };
  if (request.stripe_session_id) {
    try {
      await deactivatePaymentLink(request.stripe_session_id);
    } catch {
      // already dead/completed on Stripe's side — the webhook will reconcile if paid
    }
  }
  const { error } = await db.from("payment_requests").update({ status: "canceled" }).eq("id", id).eq("status", "pending");
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}
