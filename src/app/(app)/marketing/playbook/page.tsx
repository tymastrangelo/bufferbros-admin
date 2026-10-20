import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";
import type { MarketingTask } from "@/lib/types";
import { PlaybookClient } from "./playbook-client";

export const metadata: Metadata = { title: "Playbook" };
export const dynamic = "force-dynamic";

export default async function PlaybookPage() {
  const db = await createClient({ realData: true });
  const { data } = await db.from("marketing_tasks").select("*").order("sort").order("created_at");
  return <PlaybookClient tasks={(data ?? []) as MarketingTask[]} today={todayYmd()} />;
}
