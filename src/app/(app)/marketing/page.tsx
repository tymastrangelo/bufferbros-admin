import type { Metadata } from "next";
import { loadMarketing } from "./data";
import { OverviewClient } from "./overview-client";

export const metadata: Metadata = { title: "Marketing" };
export const dynamic = "force-dynamic";

export default async function MarketingOverview() {
  return <OverviewClient data={await loadMarketing()} />;
}
