"use server";

// Owner-only display modes, stored as cookies the Supabase clients read:
//  - LARP: every business table shows the demo dataset (src/lib/larp). Read-only.
//  - View as: render the app exactly as one worker sees it. Real data, read-only.
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getRealRole } from "@/lib/auth";
import { LARP_COOKIE, VIEW_AS_COOKIE } from "@/lib/larp/client";
import type { ActionResult } from "./appointments";

const YEAR = 60 * 60 * 24 * 365;

export async function setLarp(on: boolean): Promise<ActionResult> {
  // activity: owner-only display preference (no data changes)
  if ((await getRealRole()) !== "owner") return { ok: false, error: "Owner only." };
  const jar = await cookies();
  if (on) jar.set(LARP_COOKIE, "1", { path: "/", maxAge: YEAR, sameSite: "lax" });
  else jar.delete(LARP_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setViewAs(employeeId: string | null): Promise<ActionResult> {
  // activity: owner-only display preference (no data changes)
  if ((await getRealRole()) !== "owner") return { ok: false, error: "Owner only." };
  const jar = await cookies();
  // Session cookie: a forgotten preview ends with the browser, not a year later.
  if (employeeId) jar.set(VIEW_AS_COOKIE, employeeId, { path: "/", sameSite: "lax" });
  else jar.delete(VIEW_AS_COOKIE);
  revalidatePath("/", "layout");
  return { ok: true };
}
