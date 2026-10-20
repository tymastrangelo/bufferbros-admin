"use server";

import { revalidatePath } from "next/cache";
import { normalizeEmail, normalizePhone } from "@/lib/format";
import { change, customerName, logActivity } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import type { ChannelId, Customer, SizeId } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

export interface CustomerFields {
  name: string;
  phone?: string | null;
  email?: string | null;
  addresses?: { label: string; address: string }[];
  notes?: string | null;
  tags?: string[];
  /** Auto-email a Stripe payment link when a job completes without payment. */
  stripePayments?: boolean;
  /** Marketing channel they found us through. */
  acquiredVia?: ChannelId | null;
}

function clean(fields: CustomerFields) {
  return {
    name: fields.name.trim(),
    phone: normalizePhone(fields.phone),
    email: normalizeEmail(fields.email),
    addresses: (fields.addresses ?? []).filter((a) => a.address.trim()),
    notes: fields.notes?.trim() || null,
    tags: (fields.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    ...(fields.stripePayments !== undefined && { stripe_payments: fields.stripePayments }),
    ...(fields.acquiredVia !== undefined && { acquired_via: fields.acquiredVia }),
  };
}

export async function createCustomer(fields: CustomerFields): Promise<ActionResult> {
  if (!fields.name.trim()) return { ok: false, error: "Name is required." };
  const db = await createClient();
  const { data, error } = await db
    .from("customers")
    .insert({ ...clean(fields), source: "manual" })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  const c = clean(fields);
  await logActivity(`added customer ${c.name}`, [[c.phone, c.email].filter(Boolean).join(" · ") || "No phone or email", c.addresses[0]?.address], `/customers/${data.id}`, { tags: ["bust_in_silhouette"] });
  refresh();
  return { ok: true, id: data.id };
}

export async function updateCustomer(id: string, fields: CustomerFields): Promise<ActionResult> {
  if (!fields.name.trim()) return { ok: false, error: "Name is required." };
  const db = await createClient();
  const { data: before } = await db.from("customers").select("*").eq("id", id).maybeSingle();
  const next = clean(fields);
  const { error } = await db.from("customers").update(next).eq("id", id);
  if (error) return { ok: false, error: error.message };
  if (before) {
    const addr = (a: { address: string }[]) => a.map((x) => x.address).join("; ") || null;
    const diffs = [
      change("Name", before.name, next.name),
      change("Phone", before.phone, next.phone),
      change("Email", before.email, next.email),
      change("Address", addr(before.addresses), addr(next.addresses)),
      change("Tags", before.tags.join(", ") || null, next.tags.join(", ") || null),
      change("Notes", before.notes, next.notes),
      "stripe_payments" in next && change("Pays by Stripe", before.stripe_payments, next.stripe_payments, (v) => (v ? "yes" : "no")),
    ];
    if (diffs.some(Boolean)) await logActivity(`edited ${before.name}'s contact info`, diffs, `/customers/${id}`, { tags: ["pencil2"] });
  }
  refresh();
  return { ok: true, id };
}

export async function setCustomerArchived(id: string, archived: boolean): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("customers").update({ archived }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logActivity(`${archived ? "archived" : "unarchived"} ${await customerName(id)}`, [], `/customers/${id}`, { tags: ["file_cabinet"], priority: archived ? 4 : 3 });
  refresh();
  return { ok: true, id };
}

export interface VehicleFields {
  size_id: SizeId;
  /** Boats price per foot of length instead of by size. */
  kind?: "car" | "boat";
  length_ft?: number | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  plate?: string | null;
  notes?: string | null;
}

export async function saveVehicle(
  customerId: string,
  fields: VehicleFields,
  vehicleId?: string | null
): Promise<ActionResult> {
  const db = await createClient();
  const row = { ...fields, customer_id: customerId };
  const { error } = vehicleId
    ? await db.from("vehicles").update(row).eq("id", vehicleId)
    : await db.from("vehicles").insert(row);
  if (error) return { ok: false, error: error.message };
  const label = [fields.year, fields.color, fields.make, fields.model].filter(Boolean).join(" ") || (fields.kind === "boat" ? "a boat" : fields.size_id);
  await logActivity(
    `${vehicleId ? "updated" : "added"} ${fields.kind === "boat" ? "a boat" : "a vehicle"} for ${await customerName(customerId)}`,
    [label, fields.kind === "boat" ? (fields.length_ft ? `${fields.length_ft} ft` : null) : `Size: ${fields.size_id}`, fields.plate && `Plate ${fields.plate}`],
    `/customers/${customerId}`,
    { tags: ["red_car"] }
  );
  refresh();
  return { ok: true };
}

export async function deleteVehicle(vehicleId: string): Promise<ActionResult> {
  const db = await createClient();
  const { data: v } = await db.from("vehicles").select("*").eq("id", vehicleId).maybeSingle();
  const { error } = await db.from("vehicles").delete().eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };
  if (v) {
    await logActivity(
      `removed a ${v.kind === "boat" ? "boat" : "vehicle"} from ${await customerName(v.customer_id)}`,
      [[v.year, v.color, v.make, v.model].filter(Boolean).join(" ") || v.size_id],
      `/customers/${v.customer_id}`,
      { tags: ["wastebasket"], priority: 4 }
    );
  }
  refresh();
  return { ok: true };
}

export interface ImportRow {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
}

/** Bulk-insert selected contact rows (already deduped client-side in the preview). */
export async function importCustomers(rows: ImportRow[]): Promise<ActionResult & { count?: number }> {
  const valid = rows.filter((r) => r.name?.trim());
  if (!valid.length) return { ok: false, error: "Nothing to import." };
  const db = await createClient();
  const { error, count } = await db.from("customers").insert(
    valid.map((r) => ({
      name: r.name.trim(),
      phone: normalizePhone(r.phone),
      email: normalizeEmail(r.email),
      addresses: r.address?.trim() ? [{ label: "Home", address: r.address.trim() }] : [],
      notes: r.notes?.trim() || null,
      source: "contacts-import",
    })),
    { count: "exact" }
  );
  if (error) return { ok: false, error: error.message };
  await logActivity(`imported ${count ?? valid.length} contacts`, [valid.slice(0, 5).map((r) => r.name.trim()).join(", ") + (valid.length > 5 ? "…" : "")], "/customers", { tags: ["inbox_tray"] });
  refresh();
  return { ok: true, count: count ?? valid.length };
}

/** Existing customers keyed for dedupe: normalized phone digits and lowercased email. */
export async function getDedupeKeys(): Promise<{ phones: string[]; emails: string[] }> {
  // activity: read-only
  const db = await createClient();
  const { data } = await db.from("customers").select("phone,email");
  const rows = (data ?? []) as Pick<Customer, "phone" | "email">[];
  return {
    phones: rows.map((r) => r.phone ?? "").filter(Boolean),
    emails: rows.map((r) => r.email ?? "").filter(Boolean),
  };
}

/** Fold duplicates into `keepId` (one atomic RPC — migration 0021). Owner-only in SQL. */
export async function mergeCustomers(keepId: string, mergeIds: string[]): Promise<ActionResult> {
  const ids = mergeIds.filter((id) => id && id !== keepId);
  if (ids.length === 0) return { ok: false, error: "Pick at least one other customer to merge in." };
  const db = await createClient();
  const { error } = await db.rpc("merge_customers", { p_keep: keepId, p_merge: ids });
  if (error) return { ok: false, error: error.message };
  // activity: merge_customers is owner-only in SQL — a worker's call fails above
  refresh();
  return { ok: true, id: keepId };
}

/** "Not duplicates" — remember every pair in the group so the suggestion never returns. */
export async function dismissDuplicates(ids: string[]): Promise<ActionResult> {
  const rows: { a: string; b: string }[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      rows.push({ a, b });
    }
  const db = await createClient();
  const { error } = await db.from("customer_not_duplicates").upsert(rows, { ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message };
  // activity: owner-only table (RLS) — a worker's call fails above
  refresh();
  return { ok: true };
}
