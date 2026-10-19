import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VIEW_AS_COOKIE } from "@/lib/larp/client";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "washer";

/** The signed-in account's actual role. Missing/unknown role = washer: a mystery account sees the minimum. */
export async function getRealRole(): Promise<Role> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.app_metadata?.role === "owner" ? "owner" : "washer";
}

/** Employee id the owner is previewing as ("view as Gabe"), or null. Owner-only. */
export async function getViewAs(): Promise<string | null> {
  const id = (await cookies()).get(VIEW_AS_COOKIE)?.value || null;
  return id && (await getRealRole()) === "owner" ? id : null;
}

/** Role the UI should render as — a previewing owner sees exactly what that worker sees. */
export async function getRole(): Promise<Role> {
  const real = await getRealRole();
  if (real === "owner" && (await cookies()).get(VIEW_AS_COOKIE)?.value) return "washer";
  return real;
}

export async function requireOwner(): Promise<void> {
  if ((await getRole()) !== "owner") redirect("/");
}
