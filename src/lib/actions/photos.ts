"use server";

// Before/after photos on a job. Files live in the private `job-photos` bucket; browsers
// upload straight to Storage with their session, then record the row here. Reads come
// back as short-lived signed URLs — nothing is ever public.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getRole } from "@/lib/auth";
import { LARP_COOKIE } from "@/lib/larp/client";
import { customerName, logActivity } from "@/lib/notify";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { whenLabel } from "@/lib/time";
import type { AppointmentPhoto } from "@/lib/types";
import type { ActionResult } from "./appointments";

const BUCKET = "job-photos";
const refresh = () => revalidatePath("/", "layout");

export type JobPhoto = Pick<AppointmentPhoto, "id" | "kind" | "taken_by" | "created_at"> & { url: string };

/** Photos on a job with 1-hour signed URLs (demo mode: bundled placeholders). */
export async function listJobPhotos(appointmentId: string): Promise<{ ok: true; photos: JobPhoto[] } | { ok: false; error: string }> {
  // activity: read
  const db = await createClient();
  const { data, error } = await db.from("appointment_photos").select("*").eq("appointment_id", appointmentId).order("created_at");
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as AppointmentPhoto[];
  if (rows.length === 0) return { ok: true, photos: [] };
  const larp = (await cookies()).get(LARP_COOKIE)?.value === "1" && (await getRole()) === "owner";
  if (larp) {
    return { ok: true, photos: rows.map((r) => ({ id: r.id, kind: r.kind, taken_by: r.taken_by, created_at: r.created_at, url: `/images/larp-job-${(r.path.match(/(\d)\.jpg$/)?.[1] ?? "1")}.svg` })) };
  }
  const { data: signed, error: signErr } = await createServiceClient().storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 3600);
  if (signErr) return { ok: false, error: signErr.message };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return { ok: true, photos: rows.map((r) => ({ id: r.id, kind: r.kind, taken_by: r.taken_by, created_at: r.created_at, url: urlByPath.get(r.path) ?? "" })).filter((p) => p.url) };
}

/** After the browser uploaded `paths` to the bucket: record the rows (taken_by = the caller). */
export async function recordJobPhotos(appointmentId: string, paths: string[], kind: "before" | "after"): Promise<ActionResult> {
  if (!paths.length) return { ok: true };
  if (paths.some((p) => !p.startsWith(`${appointmentId}/`))) return { ok: false, error: "Photo path doesn't belong to this job." };
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data: mine } = user ? await db.from("employees").select("id").eq("user_id", user.id).maybeSingle() : { data: null };
  const { error } = await db.from("appointment_photos").insert(paths.map((path) => ({ appointment_id: appointmentId, path, kind, taken_by: mine?.id ?? null })));
  if (error) return { ok: false, error: error.message };
  const { data: appt } = await db.from("appointments").select("customer_id,contact_name,date,start_min").eq("id", appointmentId).maybeSingle();
  await logActivity(
    `added ${paths.length} ${kind} photo${paths.length === 1 ? "" : "s"}`,
    [appt ? `${appt.customer_id ? await customerName(appt.customer_id) : appt.contact_name ?? "Job"} · ${whenLabel(appt.date, appt.start_min)}` : null],
    `/calendar?view=day&d=${appt?.date ?? ""}`,
    { tags: ["camera"], priority: 3 }
  );
  refresh();
  return { ok: true };
}

/** Removes the file first, then the row — no orphan objects. */
export async function deleteJobPhoto(photoId: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: row } = await db.from("appointment_photos").select("id,path,kind,appointment_id,taken_by").eq("id", photoId).maybeSingle();
  if (!row) return { ok: false, error: "Photo not found." };
  // Owner or the person who took it — checked here because the object is removed with the
  // service role before the row's own RLS delete runs.
  if ((await getRole()) !== "owner") {
    const {
      data: { user },
    } = await db.auth.getUser();
    const { data: mine } = user ? await db.from("employees").select("id").eq("user_id", user.id).maybeSingle() : { data: null };
    if (!mine || row.taken_by !== mine.id) return { ok: false, error: "Only the owner or whoever took this photo can delete it." };
  }
  if (!row.path.startsWith(`${row.appointment_id}/`)) return { ok: false, error: "That photo's file path doesn't match its job." };
  const { error: rmErr } = await createServiceClient().storage.from(BUCKET).remove([row.path]);
  if (rmErr) return { ok: false, error: rmErr.message };
  const { error } = await db.from("appointment_photos").delete().eq("id", photoId);
  if (error) return { ok: false, error: error.message };
  await logActivity(`removed a ${row.kind} photo`, [], `/calendar`, { tags: ["camera"], priority: 3 });
  refresh();
  return { ok: true, id: photoId };
}

/** Owner-only: 7-day links to the after photos, ready to paste into a text. */
export async function photoShareLinks(appointmentId: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if ((await getRole()) !== "owner") return { ok: false, error: "Owner only." };
  const db = await createClient();
  const { data } = await db.from("appointment_photos").select("path").eq("appointment_id", appointmentId).eq("kind", "after").order("created_at");
  const paths = ((data ?? []) as { path: string }[]).map((r) => r.path);
  if (!paths.length) return { ok: false, error: "No after photos on this job yet." };
  const { data: signed, error } = await createServiceClient().storage.from(BUCKET).createSignedUrls(paths, 7 * 24 * 3600);
  if (error) return { ok: false, error: error.message };
  const urls = (signed ?? []).map((s) => s.signedUrl).filter(Boolean);
  await logActivity("shared job photos with the customer", [`${urls.length} photo${urls.length === 1 ? "" : "s"} · links last 7 days`], "/calendar", { tags: ["camera"], priority: 3 });
  return { ok: true, text: `Here's how it turned out:\n${urls.join("\n")}` };
}
