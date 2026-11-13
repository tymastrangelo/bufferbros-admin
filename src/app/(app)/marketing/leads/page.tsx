import { redirect } from "next/navigation";

// Leads moved to their own section; old links and bookmarks keep working.
export default async function OldLeadsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  redirect((await searchParams).new === "1" ? "/leads?new=1" : "/leads");
}
