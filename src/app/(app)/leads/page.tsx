import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { loadLeads } from "../marketing/data";
import { LeadsClient } from "./leads-client";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireOwner();
  const [{ new: isNew }, data] = await Promise.all([searchParams, loadLeads()]);
  return (
    <div className="page max-w-5xl">
      <LeadsClient today={data.today} leads={data.leads} campaigns={data.campaigns} openNew={isNew === "1"} />
    </div>
  );
}
