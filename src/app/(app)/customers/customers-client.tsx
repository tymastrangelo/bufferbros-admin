"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconChevronRight, IconPlus, IconStar, IconUpload, IconUsers } from "@/components/icons";
import { Avatar, Balance, Busy, EmptyState, ErrorNote, Field, PageHeader, SearchInput, Sheet } from "@/components/ui";
import { DuplicatesSheet } from "@/components/duplicates-sheet";
import { ChannelSelect } from "@/components/marketing-bits";
import { TextSyncBar } from "@/components/client-texts";
import { createCustomer } from "@/lib/actions/customers";
import type { DupCandidate, DupGroup } from "@/lib/duplicates";
import { fmtPhone, phoneDigits } from "@/lib/format";
import { fmtDateShort } from "@/lib/time";
import type { ChannelId, Customer, TextSyncRun } from "@/lib/types";

export type CustomerRow = Customer & {
  balance: number;
  lastVisit: string | null;
  nextVisit: string | null;
};

export function CustomersClient({
  rows,
  unlinkedCount,
  openNew,
  duplicates,
  candidates,
  openDuplicates,
  textSync,
}: {
  rows: CustomerRow[];
  unlinkedCount: number;
  openNew: boolean;
  duplicates: DupGroup[];
  candidates: DupCandidate[];
  openDuplicates: boolean;
  textSync: TextSyncRun | null;
}) {
  const [dupesOpen, setDupesOpen] = useState(openDuplicates);
  const dupeRecords = duplicates.reduce((s, g) => s + g.ids.length, 0);
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
    <div className="page max-w-5xl">
      <PageHeader
        title="Customers"
        sub={`${rows.filter((r) => !r.archived).length} active`}
        actions={
          <>
            <Link href="/customers/import" className="btn btn-sm">
              <IconUpload width={14} height={14} /> Import
            </Link>
            <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
              <IconPlus width={14} height={14} /> New customer
            </button>
          </>
        }
      />

      <div className="mb-4">
        <TextSyncBar run={textSync} />
      </div>

      {unlinkedCount > 0 && (
        <Link
          href="/"
          className="mb-4 flex items-center justify-between gap-2 note note-warn transition-opacity hover:opacity-85"
        >
          {unlinkedCount} web booking{unlinkedCount > 1 ? "s" : ""} not linked to a customer yet
          <span className="font-semibold">Review →</span>
        </Link>
      )}

      {duplicates.length > 0 && (
        <button
          onClick={() => setDupesOpen(true)}
          className="page-in mb-4 w-full flex items-center gap-3 note note-brand text-left transition-[opacity,transform] hover:opacity-90 active:scale-[0.995]"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white">
            <IconUsers width={16} height={16} />
          </span>
          <span className="grow min-w-0">
            <span className="block font-semibold">Duplicates found</span>
            <span className="block text-dense opacity-80">
              {duplicates.length === 1
                ? `${candidates.find((c) => c.id === duplicates[0].keepId)?.name ?? "Someone"} is in here ${duplicates[0].ids.length} times`
                : `${duplicates.length} people across ${dupeRecords} records`}{" "}
              — merge them into one.
            </span>
          </span>
          <span className="inline-flex items-center gap-0.5 font-semibold shrink-0">
            Review <IconChevronRight width={14} height={14} />
          </span>
        </button>
      )}

      <div className="flex flex-col gap-2.5">
        <SearchInput
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
                className="chip" aria-pressed={tag === t}
              >
                {t}
              </button>
            ))}
            {rows.some((r) => r.archived) && (
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="chip ml-auto" aria-pressed={showArchived}
              >
                archived
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<IconUsers width={18} height={18} />}
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
          <ul className="card divide-y divide-line overflow-hidden">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link href={`/customers/${c.id}`} className="row row-link">
                  <Avatar name={c.name} size={34} />
                  <div className="min-w-0 grow">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-md font-medium truncate">{c.name}</p>
                      {c.review_left_on && <IconStar width={14} height={14} weight="fill" className="shrink-0 text-warn" aria-label={`Left a review ${c.review_left_on}`} />}
                      {c.outreach_status !== "active" && (
                        <span className="chip chip-warn shrink-0">
                          {c.outreach_status === "do_not_contact" ? "no contact" : c.outreach_status === "declined" ? "not interested" : "seasonal"}
                        </span>
                      )}
                      {c.tags.map((t) => (
                        <span key={t} className="chip shrink-0 hidden md:inline-flex">
                          {t}
                        </span>
                      ))}
                    </div>
                    <p className="text-dense text-faint num truncate">
                      {fmtPhone(c.phone) || c.email || "no contact info"}
                      {c.lastVisit && ` · last ${fmtDateShort(c.lastVisit)}`}
                      {c.nextVisit && ` · next ${fmtDateShort(c.nextVisit)}`}
                    </p>
                  </div>
                  {c.balance !== 0 && <Balance amount={c.balance} />}
                  <IconChevronRight width={16} height={16} className="shrink-0 text-faint hidden md:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <NewCustomerSheet open={newOpen} onClose={closeNew} />
      <DuplicatesSheet
        open={dupesOpen}
        onClose={() => {
          setDupesOpen(false);
          if (openDuplicates) window.history.replaceState(null, "", "/customers");
        }}
        groups={duplicates}
        candidates={candidates}
      />
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
  const [foundVia, setFoundVia] = useState<ChannelId | null>(null);
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
        <Field label="How they found you" hint="Feeds cost per customer on the Marketing page">
          <ChannelSelect value={foundVia} onChange={setFoundVia} unknownLabel="Not sure" />
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
              acquiredVia: foundVia,
            });
            setPending(false);
            if (!res.ok) return setError(res.error);
            // navigate straight to the new profile — don't run onClose's URL rewrite first
            router.push(`/customers/${res.id}`);
          }}
        >
          {pending ? <Busy>Creating…</Busy> : "Create customer"}
        </button>
      </div>
    </Sheet>
  );
}
