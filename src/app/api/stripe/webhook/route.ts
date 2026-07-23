import { NextResponse } from "next/server";
import { notify } from "@/lib/notify";
import { getSessionFee, verifyStripeSignature } from "@/lib/stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { PaymentRequest } from "@/lib/types";

// Stripe webhook — signature-verified, excluded from the auth proxy (src/proxy.ts).
// checkout.session.completed books the money on the customer ledger with the real
// Stripe fee, so the Tyler/Gabe split runs on the net that actually arrived.
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "webhook secret not set" }, { status: 500 });

  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });
  }

  const event = JSON.parse(payload) as { type: string; data: { object: { id: string; payment_status?: string; metadata?: { request_id?: string } } } };
  const session = event.data.object;
  const requestId = session.metadata?.request_id;
  if (!requestId) return NextResponse.json({ ok: true, skipped: "no request_id" });

  const db = createServiceClient();

  if (event.type === "checkout.session.expired") {
    await db.from("payment_requests").update({ status: "expired" }).eq("id", requestId).eq("status", "pending");
    return NextResponse.json({ ok: true });
  }

  if (event.type !== "checkout.session.completed" || session.payment_status !== "paid") {
    return NextResponse.json({ ok: true, skipped: event.type });
  }

  // Claim the request first — a webhook retry then no-ops instead of double-booking.
  const { data: claimed } = await db
    .from("payment_requests")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("*")
    .single();
  if (!claimed) return NextResponse.json({ ok: true, skipped: "already handled" });
  const req = claimed as PaymentRequest;

  let fee = 0;
  try {
    fee = await getSessionFee(session.id);
  } catch {
    // fee stays 0; Tyler can correct the ledger row if it matters
  }

  const base = {
    customer_id: req.customer_id,
    appointment_id: req.appointment_id,
    plan_id: req.plan_id,
    occurred_on: todayYmd(),
  };
  const { data: payRow, error: payErr } = await db
    .from("ledger_entries")
    .insert({
      ...base,
      kind: "payment",
      amount: Number(req.amount),
      method: "card",
      collected_by: "owner", // Stripe money lands in the company account
      processor_fee: fee,
      memo: req.memo || (req.kind === "prepay" ? `Prepaid ${req.visits} visits via Stripe` : "Paid via Stripe"),
    })
    .select("id")
    .single();
  if (payErr) {
    // put the request back so a retry can succeed
    await db.from("payment_requests").update({ status: "pending", paid_at: null }).eq("id", requestId);
    return NextResponse.json({ ok: false, error: payErr.message }, { status: 500 });
  }

  if (Number(req.discount) > 0) {
    await db.from("ledger_entries").insert({
      ...base,
      kind: "discount",
      amount: Number(req.discount),
      memo: `Prepay discount (${req.visits} visits)`,
    });
  }

  await db
    .from("payment_requests")
    .update({ processor_fee: fee, ledger_entry_id: payRow.id })
    .eq("id", requestId);

  const { data: customer } = await db.from("customers").select("name").eq("id", req.customer_id).single();
  await notify(
    "owner",
    "Stripe payment received",
    `${customer?.name ?? "Customer"} paid $${Number(req.amount)}${fee ? ` · Stripe kept $${fee.toFixed(2)}` : ""}`,
    `/customers/${req.customer_id}`
  );

  return NextResponse.json({ ok: true });
}
