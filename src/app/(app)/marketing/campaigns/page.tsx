import type { Metadata } from "next";
import { loadMarketing } from "../data";
import { CampaignsClient } from "./campaigns-client";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  return <CampaignsClient data={await loadMarketing()} />;
}
