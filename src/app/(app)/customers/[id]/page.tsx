import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRole } from "@/lib/auth";
import { getCatalog, getSettingsMap } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { Customer, CustomerInsight, CustomerMessage, LedgerEntry, TextSyncRun, OutreachLog, PaymentRequest, Plan, Vehicle } from "@/lib/types";
import type { JobWithCustomer } from "@/components/job-sheet";
import { CustomerProfile } from "./profile-client";

export const metadata: Metadata = { title: "Customer" };
export const dynamic = "force-dynamic";

// Washers can open customer profiles too — search is their entry point (the list,
// import, and the rest of the admin surface stay owner-only).
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await createClient();

  const [customerQ, vehiclesQ, plansQ, apptsQ, ledgerQ, catalog, requestsQ] = await Promise.all([
    db.from("customers").select("*").eq("id", id).single(),
    db.from("vehicles").select("*").eq("customer_id", id),
    db.from("plans").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    db
      .from("appointments")
      .select("*, customers(id,name,phone,email,stripe_payments,site_notes), appointment_employees(employee_id), appointment_vehicles(vehicles(*))")
      .eq("customer_id", id)
      .order("date", { ascending: false })
      .order("start_min"),
    db
      .from("ledger_entries")
      .select("*")
      .eq("customer_id", id)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false }),
    getCatalog(),
    db
      .from("payment_requests")
      .select("*")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (!customerQ.data) notFound();
  const customer = customerQ.data as Customer;

  // Texts are owner-only; a previewing owner ("view as Gabe") sees the worker's page.
  const owner = (await getRole()) === "owner";
  const [logQ, referralsQ, settings, referrerQ, textsQ, insightQ, syncQ] = await Promise.all([
    db.from("outreach_log").select("*").eq("customer_id", id).order("occurred_on", { ascending: false }).order("created_at", { ascending: false }).limit(8),
    db.from("customers").select("id,name").eq("referred_by", id).order("created_at"),
    getSettingsMap(),
    customer.referred_by ? db.from("customers").select("name").eq("id", customer.referred_by).single() : Promise.resolve(null),
    owner
      ? db.from("customer_messages").select("id,sent_at,from_me,body,has_attachment").eq("customer_id", id).order("sent_at", { ascending: false }).limit(300)
      : Promise.resolve(null),
    owner ? db.from("customer_insights").select("*").eq("customer_id", id).maybeSingle() : Promise.resolve(null),
    owner ? db.from("text_sync_runs").select("*").order("requested_at", { ascending: false }).limit(1).maybeSingle() : Promise.resolve(null),
  ]);

  return (
    <CustomerProfile
      customer={customer}
      vehicles={(vehiclesQ.data ?? []) as Vehicle[]}
      plans={(plansQ.data ?? []) as Plan[]}
      appointments={(apptsQ.data ?? []) as JobWithCustomer[]}
      ledger={((ledgerQ.data ?? []) as LedgerEntry[]).map((e) => ({ ...e, amount: Number(e.amount) }))}
      catalog={catalog}
      today={todayYmd()}
      paymentRequests={((requestsQ.data ?? []) as PaymentRequest[]).map((r) => ({ ...r, amount: Number(r.amount) }))}
      outreachLog={(logQ.data ?? []) as OutreachLog[]}
      referrals={(referralsQ.data ?? []) as { id: string; name: string }[]}
      referrerName={referrerQ?.data?.name ?? null}
      referralCredit={Number(settings.referral_credit ?? 10)}
      texts={textsQ ? ((textsQ.data ?? []) as CustomerMessage[]).reverse() : null}
      insight={(insightQ?.data as CustomerInsight | null) ?? null}
      textSync={(syncQ?.data as TextSyncRun | null) ?? null}
    />
  );
}
