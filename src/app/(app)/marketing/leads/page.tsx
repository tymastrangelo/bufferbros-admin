import type { Metadata } from "next";
import { loadMarketing } from "../data";
import { LeadsClient } from "./leads-client";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const [{ new: isNew }, data] = await Promise.all([searchParams, loadMarketing()]);
  return <LeadsClient leads={data.leads} campaigns={data.campaigns} openNew={isNew === "1"} />;
}
