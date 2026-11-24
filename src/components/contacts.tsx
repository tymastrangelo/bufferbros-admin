"use client";

// The other people on a client's account (0043): a spouse, an assistant, a property manager.
// Shown on the profile (owner edits) and on every job (the crew needs to know who to call).
// Their texts sync onto the same client, so one card covers the whole household.
// Loads its own rows from the browser client, like the job sheet's Money section.
import { useCallback, useEffect, useState } from "react";
import { deleteContact, saveContact } from "@/lib/actions/customers";
import { fmtPhone, smsHref, telHref } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { CustomerContact } from "@/lib/types";
import { IconMessage, IconPhone, IconPlus } from "./icons";
import { Busy, ErrorNote, Field, Sheet } from "./ui";

export const contactLabel = (c: Pick<CustomerContact, "name" | "relation">) => `${c.name}${c.relation ? ` (${c.relation})` : ""}`;

export function ContactsSection({ customerId, editable }: { customerId: string; editable: boolean }) {
  const [contacts, setContacts] = useState<CustomerContact[] | null>(null);
  const [editing, setEditing] = useState<CustomerContact | "new" | null>(null);
  const load = useCallback(async () => {
    const { data } = await createClient().from("customer_contacts").select("*").eq("customer_id", customerId).order("created_at");
    return (data as CustomerContact[]) ?? [];
  }, [customerId]);
  useEffect(() => {
    let stale = false;
    load().then((rows) => {
      if (!stale) setContacts(rows);
    });
    return () => {
      stale = true;
    };
  }, [load]);

  // On a job, nothing to show means no section at all.
  if (!contacts || (contacts.length === 0 && !editable)) return null;
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="label">Other contacts</h2>
        {editable && (
          <button className="add-link" onClick={() => setEditing("new")}>
            <IconPlus width={13} height={13} />
            Add contact
          </button>
        )}
      </div>
      <div className="card divide-y divide-line">
        {contacts.length === 0 && (
          <p className="px-4 py-3 text-sm text-faint">Add a spouse or assistant who also texts you. Their texts will sync onto this client.</p>
        )}
        {contacts.map((c) => (
          <div key={c.id} className="row justify-between gap-2">
            <button type="button" className="text-left grow min-w-0" disabled={!editable} onClick={() => setEditing(c)} aria-label={editable ? `Edit ${c.name}` : undefined}>
              <p className="text-sm font-medium truncate">{contactLabel(c)}</p>
              <p className="text-xs text-faint num truncate">
                {fmtPhone(c.phone) || "No phone number"}
                {c.notes ? ` · ${c.notes}` : ""}
              </p>
            </button>
            {c.phone && (
              <span className="flex gap-1.5 shrink-0">
                <a className="btn btn-sm" href={telHref(c.phone)} aria-label={`Call ${c.name}`}>
                  <IconPhone width={16} height={16} />
                </a>
                <a className="btn btn-sm" href={smsHref(c.phone)} aria-label={`Text ${c.name}`}>
                  <IconMessage width={16} height={16} />
                </a>
              </span>
            )}
          </div>
        ))}
      </div>
      {editing && (
        <ContactSheet
          customerId={customerId}
          contact={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            load().then(setContacts);
          }}
        />
      )}
    </section>
  );
}

function ContactSheet({ customerId, contact, onClose }: { customerId: string; contact: CustomerContact | null; onClose: () => void }) {
  const [name, setName] = useState(contact?.name ?? "");
  const [relation, setRelation] = useState(contact?.relation ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) return setError(res.error ?? "Couldn't save. Try again.");
    onClose();
  }
  return (
    <Sheet open onClose={onClose} title={contact ? "Edit contact" : "Add contact"}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Who they are">
            <input className="input" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="wife, assistant…" />
          </Field>
        </div>
        <Field label="Phone" hint="Texts with this number sync onto this client after the next sync.">
          <input className="input num" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Handles scheduling, drives the Defender…" />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary h-11" disabled={pending} onClick={() => run(() => saveContact(customerId, { name, relation, phone, notes }, contact?.id))}>
          {pending ? <Busy>Saving…</Busy> : "Save contact"}
        </button>
        {contact && (
          <button className="btn btn-danger" disabled={pending} onClick={() => run(() => deleteContact(contact.id))}>
            Remove contact
          </button>
        )}
      </div>
    </Sheet>
  );
}
