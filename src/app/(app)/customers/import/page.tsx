import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportPage() {
  await requireOwner();
  return <ImportClient />;
}
