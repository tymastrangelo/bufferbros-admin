"use server";
// activity: owner-only — returns early for anyone but the owner (texts sync from Tyler's own Mac).

import { revalidatePath } from "next/cache";
import { getRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

/**
 * "Sync texts now": queue a run for the listener on Tyler's Mac (scripts/client-texts/run.mjs
 * --listen), which picks it up via Realtime within seconds. Reuses a recent pending/running run
 * instead of stacking duplicates.
 */
export async function requestTextSync(): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Only the owner can sync texts." };
  const db = await createClient();
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: open } = await db
    .from("text_sync_runs")
    .select("id")
    .in("status", ["pending", "running"])
    .gte("requested_at", since)
    .limit(1);
  if (open?.length) return { ok: true, id: open[0].id };
  const { data, error } = await db.from("text_sync_runs").insert({ source: "button" }).select("id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, id: data.id };
}
