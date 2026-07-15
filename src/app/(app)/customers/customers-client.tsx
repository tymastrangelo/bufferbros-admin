"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconPlus, IconUpload } from "@/components/icons";
import { Balance, EmptyState, ErrorNote, Field, Sheet } from "@/components/ui";
import { createCustomer } from "@/lib/actions/customers";
import { fmtPhone, phoneDigits } from "@/lib/format";
import { fmtDateShort } from "@/lib/time";
import type { Customer } from "@/lib/types";

export type CustomerRow = Customer & {
  balance: number;
  lastVisit: string | null;
  nextVisit: string | null;
};

export function CustomersClient({
  rows,
  unlinkedCount,
  openNew,
}: {
  rows: CustomerRow[];
  unlinkedCount: number;
  openNew: boolean;
}) {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [newOpen, setNewOpen] = useState(openNew);

  // re-arm when the ＋New menu navigates here with ?new=1
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setNewOpen(true);
  }
  const closeNew = () => {
    setNewOpen(false);
    window.history.replaceState(null, "", "/customers");
  };

  const allTags = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.tags.forEach((t) => s.add(t)));
    return [...s].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return rows.filter((r) => {
      if (r.archived !== showArchived) return false;
      if (tag && !r.tags.includes(tag)) return false;
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        (digits.length >= 3 && phoneDigits(r.phone).includes(digits)) ||
        (r.email ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, tag, showArchived]);

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-5xl">
      <header className="flex items-center gap-2">
        <h1 className="text-xl md:text-2xl font-bold mr-auto">Customers</h1>
        <Link href="/customers/import" className="btn btn-sm">
          <IconUpload width={14} height={14} /> Import
        </Link>
        <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
          <IconPlus width={13} height={13} /> New
        </button>
      </header>

      {unlinkedCount > 0 && (
        <Link
          href="/"
          className="mt-3 flex items-center justify-between gap-2 rounded-md border border-[#fde68a] bg-warn-wash px-3 py-2 text-sm text-warn"
        >
          {unlinkedCount} web booking{unlinkedCount > 1 ? "s" : ""} not linked to a customer yet
          <span className="font-semibold">Review →</span>
        </Link>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <input
          className="input"
          placeholder={`Search ${rows.filter((r) => !r.archived).length} customers by name, phone, or email…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(allTags.length > 0 || rows.some((r) => r.archived)) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => setTag(tag === t ? null : t)}
                className={`chip cursor-pointer ${tag === t ? "bg-ink text-white" : "bg-[#f1f4f9] text-ink-2 hover:bg-line"}`}
              >
                {t}
              </button>
            ))}
            {rows.some((r) => r.archived) && (
              <button
                onClick={() => setShowArchived(!showArchived)}
                className={`chip cursor-pointer ml-auto ${showArchived ? "bg-ink text-white" : "bg-[#f1f4f9] text-ink-2"}`}
              >
                archived
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 card overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? "No customers yet." : "No matches."}
            hint={
              rows.length === 0
                ? "Add your first customer, or import everyone at once from your phone contacts."
                : "Try fewer letters, or clear the tag filter."
            }
            action={
              rows.length === 0 ? (
                <div className="flex gap-2">
                  <button className="btn btn-primary" onClick={() => setNewOpen(true)}>
                    New customer
                  </button>
                  <Link href="/customers/import" className="btn">
                    Import contacts
                  </Link>
                </div>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-[#f8fafd] transition-colors duration-150">
                  <div className="min-w-0 grow">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-[15px] font-medium truncate">{c.name}</p>
                      {c.tags.map((t) => (
                        <span key={t} className="chip bg-[#f1f4f9] text-ink-2 shrink-0 hidden md:inline-flex">
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="text-[13px] text-faint num truncate">
                      {fmtPhone(c.phone) || c.email || "no contact info"}
                      {c.lastVisit && ` · last ${fmtDateShort(c.lastVisit)}`}
                      {c.nextVisit && ` · next ${fmtDateShort(c.nextVisit)}`}
                    </p>
                  </div>
                  {c.balance !== 0 && <Balance amount={c.balance} />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewCustomerSheet open={newOpen} onClose={closeNew} />
    </div>
  );
}

function NewCustomerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;
  return (
    <Sheet open onClose={onClose} title="New customer">
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone">
            <input className="input num" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field label="Address">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Tags" hint="Comma-separated — vip, weekly, prepaid…">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await createCustomer({
              name,
              phone,
              email,
              addresses: address ? [{ label: "Home", address }] : [],
              tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
              notes,
            });
            setPending(false);
            if (!res.ok) return setError(res.error);
            // navigate straight to the new profile — don't run onClose's URL rewrite first
            router.push(`/customers/${res.id}`);
          }}
        >
          {pending ? "Creating…" : "Create customer"}
        </button>
      </div>
    </Sheet>
  );
}
