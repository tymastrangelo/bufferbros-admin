import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "washer";

// Missing/unknown role = washer: a mystery account sees the minimum.
export async function getRole(): Promise<Role> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  return user?.app_metadata?.role === "owner" ? "owner" : "washer";
}

export async function requireOwner(): Promise<void> {
  if ((await getRole()) !== "owner") redirect("/");
}
