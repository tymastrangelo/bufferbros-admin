import type { Metadata } from "next";
import { getRole } from "@/lib/auth";
import { getCatalog } from "@/lib/queries";
import { QuoteClient } from "./quote-client";

export const metadata: Metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

// Both roles: this is the in-front-of-the-client price builder.
export default async function QuotePage() {
  const [catalog, role] = await Promise.all([getCatalog(), getRole()]);
  return <QuoteClient catalog={catalog} owner={role === "owner"} />;
}
