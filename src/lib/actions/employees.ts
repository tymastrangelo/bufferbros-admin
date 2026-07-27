"use server";

import { revalidatePath } from "next/cache";
import { getRole } from "@/lib/auth";
import { syncEmployeeCalendar } from "@/lib/ical";
import { normalizeEmail } from "@/lib/format";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

/** Owner-only: create the worker's login + employee row in one shot. */
export async function addEmployee(input: {
  name: string;
  email: string;
  password: string;
  splitPct: number;
}): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Owner only." };
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  if (!name) return { ok: false, error: "Give them a name." };
  if (!email) return { ok: false, error: "They need an email to sign in with." };
  if (input.password.length < 8) return { ok: false, error: "Temp password needs at least 8 characters." };
  if (!(input.splitPct >= 0 && input.splitPct <= 100)) return { ok: false, error: "Split must be 0–100%." };

  const admin = createServiceClient();
  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    app_metadata: { role: "washer" },
  });
  if (authErr) return { ok: false, error: authErr.message };

  const { error } = await admin
    .from("employees")
    .insert({ user_id: created.user.id, name, email, split_pct: input.splitPct });
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

export async function updateEmployee(
  id: string,
  fields: Partial<{ name: string; split_pct: number; active: boolean; ical_url: string | null }>
): Promise<ActionResult> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Owner only." };
  if (fields.split_pct != null && !(fields.split_pct >= 0 && fields.split_pct <= 100)) {
    return { ok: false, error: "Split must be 0–100%." };
  }
  if (fields.name != null && !fields.name.trim()) return { ok: false, error: "Name can't be blank." };
  const db = await createClient();
  const { error } = await db.from("employees").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if ("ical_url" in fields) await syncEmployeeCalendar(id); // new feed: blocks appear right away
  refresh();
  return { ok: true };
}

/** An employee saves their own calendar feed link (RLS blocks their direct writes). */
export async function saveMyCalendarFeed(url: string): Promise<ActionResult> {
  const me = await myEmployeeRow();
  if (!me) return { ok: false, error: "No employee profile on this account." };
  const trimmed = url.trim();
  if (trimmed && !/^https?:\/\//.test(trimmed)) return { ok: false, error: "Paste the full https:// iCal link." };
  const admin = createServiceClient();
  const { error } = await admin.from("employees").update({ ical_url: trimmed || null }).eq("id", me);
  if (error) return { ok: false, error: error.message };
  const res = await syncEmployeeCalendar(me);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

/** Re-pull a feed on demand — owner for anyone, employees for themselves. */
export async function syncCalendarNow(employeeId?: string): Promise<ActionResult> {
  let target = employeeId ?? null;
  if ((await getRole()) !== "owner") {
    const me = await myEmployeeRow();
    if (!me || (target && target !== me)) return { ok: false, error: "You can only sync your own calendar." };
    target = me;
  }
  if (!target) return { ok: false, error: "No employee to sync." };
  const res = await syncEmployeeCalendar(target);
  if (!res.ok) return res;
  refresh();
  return { ok: true };
}

async function myEmployeeRow(): Promise<string | null> {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("employees").select("id").eq("user_id", user.id).maybeSingle();
  return data?.id ?? null;
}
