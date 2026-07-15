"use server";

import { revalidatePath } from "next/cache";
import { normalizeEmail, normalizePhone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Customer, SizeId } from "@/lib/types";
import type { ActionResult } from "./appointments";

const refresh = () => revalidatePath("/", "layout");

export interface CustomerFields {
  name: string;
  phone?: string | null;
  email?: string | null;
  addresses?: { label: string; address: string }[];
  notes?: string | null;
  tags?: string[];
}

function clean(fields: CustomerFields) {
  return {
    name: fields.name.trim(),
    phone: normalizePhone(fields.phone),
    email: normalizeEmail(fields.email),
    addresses: (fields.addresses ?? []).filter((a) => a.address.trim()),
    notes: fields.notes?.trim() || null,
    tags: (fields.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
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
  refresh();
  return { ok: true, id: data.id };
}

export async function updateCustomer(id: string, fields: CustomerFields): Promise<ActionResult> {
  if (!fields.name.trim()) return { ok: false, error: "Name is required." };
  const db = await createClient();
  const { error } = await db.from("customers").update(clean(fields)).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export async function setCustomerArchived(id: string, archived: boolean): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("customers").update({ archived }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, id };
}

export interface VehicleFields {
  size_id: SizeId;
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
  refresh();
  return { ok: true };
}

export async function deleteVehicle(vehicleId: string): Promise<ActionResult> {
  const db = await createClient();
  const { error } = await db.from("vehicles").delete().eq("id", vehicleId);
  if (error) return { ok: false, error: error.message };
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
  refresh();
  return { ok: true, count: count ?? valid.length };
}

/** Existing customers keyed for dedupe: normalized phone digits and lowercased email. */
export async function getDedupeKeys(): Promise<{ phones: string[]; emails: string[] }> {
  const db = await createClient();
  const { data } = await db.from("customers").select("phone,email");
  const rows = (data ?? []) as Pick<Customer, "phone" | "email">[];
  return {
    phones: rows.map((r) => r.phone ?? "").filter(Boolean),
    emails: rows.map((r) => r.email ?? "").filter(Boolean),
  };
}
