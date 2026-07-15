"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { IconUpload } from "@/components/icons";
import { ErrorNote } from "@/components/ui";
import { getDedupeKeys, importCustomers } from "@/lib/actions/customers";
import { parseContactsFile, type ParsedContact } from "@/lib/contacts-parse";
import { fmtPhone, phoneDigits } from "@/lib/format";

type Row = ParsedContact & { checked: boolean; duplicate: boolean };

export function ImportClient() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setError(null);
    setDone(null);
    setFileName(file.name);
    const text = await file.text();
    const parsed = parseContactsFile(file.name, text);
    if (!parsed.length) {
      setRows(null);
      setError("Couldn't find any contacts in that file. Export a vCard (.vcf) from Contacts, or a CSV with name/phone/email columns.");
      return;
    }
    const keys = await getDedupeKeys();
    const phones = new Set(keys.phones.map((p) => phoneDigits(p)).filter(Boolean));
    const emails = new Set(keys.emails.map((e) => e.toLowerCase()));
    const seen = new Set<string>(); // dedupe within the file itself
    setRows(
      parsed.map((c) => {
        const pd = phoneDigits(c.phone);
        const em = c.email?.toLowerCase() ?? "";
        const inDb = (pd !== "" && phones.has(pd)) || (em !== "" && emails.has(em));
        const key = pd || em || c.name.toLowerCase();
        const inFile = seen.has(key);
        seen.add(key);
        const duplicate = inDb || inFile;
        return { ...c, checked: !duplicate, duplicate };
      })
    );
  }

  async function submit() {
    if (!rows) return;
    const selected = rows.filter((r) => r.checked);
    setError(null);
    setPending(true);
    let imported = 0;
    for (let i = 0; i < selected.length; i += 200) {
      const chunk = selected.slice(i, i + 200).map((r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        address: r.address,
        notes: [r.notes, r.extraPhones.length ? `Other phones: ${r.extraPhones.join(", ")}` : "", r.extraEmails.length ? `Other emails: ${r.extraEmails.join(", ")}` : ""]
          .filter(Boolean)
          .join("\n") || null,
      }));
      const res = await importCustomers(chunk);
      if (!res.ok) {
        setPending(false);
        setError(`${res.error} (${imported} imported before the error)`);
        return;
      }
      imported += res.count ?? chunk.length;
    }
    setPending(false);
    setDone(imported);
    setRows(null);
  }

  const selectedCount = rows?.filter((r) => r.checked).length ?? 0;

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-4xl">
      <nav className="text-[13px] text-faint mb-2">
        <Link href="/customers" className="hover:text-ink">
          Customers
        </Link>{" "}
        / Import
      </nav>
      <h1 className="text-xl md:text-2xl font-bold">Import contacts</h1>
      <p className="text-sm text-ink-2 mt-1 max-w-xl">
        Bring your phone&apos;s contacts in as customers. On iPhone: Contacts → select all → Share → save the
        .vcf here. Or export a vCard from iCloud.com, or a CSV from Google Contacts.
      </p>

      {done != null && (
        <div className="mt-4 rounded-md border border-[#bbf7d0] bg-ok-wash px-4 py-3 text-sm text-ok">
          Imported {done} customer{done === 1 ? "" : "s"}.{" "}
          <Link href="/customers" className="font-semibold underline underline-offset-2">
            See them →
          </Link>
        </div>
      )}

      <div className="mt-4">
        <input
          ref={fileRef}
          type="file"
          accept=".vcf,.csv,text/vcard,text/csv"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <button
          className="w-full card border-dashed border-line-2! px-6 py-10 flex flex-col items-center gap-2 text-ink-2 hover:border-brand hover:text-brand-deep transition-colors duration-150"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          <IconUpload width={22} height={22} />
          <span className="text-sm font-medium">{fileName || "Choose a .vcf or .csv file (or drop it here)"}</span>
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {rows && (
        <>
          <div className="mt-5 flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-ink-2">
              {rows.length} contact{rows.length === 1 ? "" : "s"} found ·{" "}
              <span className="font-medium text-ink">{selectedCount} selected</span>
              {rows.some((r) => r.duplicate) && (
                <span className="text-faint"> · {rows.filter((r) => r.duplicate).length} look like duplicates (unchecked)</span>
              )}
            </p>
            <div className="flex gap-1.5">
              <button className="btn btn-sm" onClick={() => setRows(rows.map((r) => ({ ...r, checked: true })))}>
                Select all
              </button>
              <button className="btn btn-sm" onClick={() => setRows(rows.map((r) => ({ ...r, checked: false })))}>
                None
              </button>
            </div>
          </div>

          <div className="mt-2 card overflow-x-auto max-h-[55dvh] overflow-y-auto">
            <table className="tbl tbl-stack min-w-[560px]">
              <thead className="sticky top-0 bg-card">
                <tr>
                  <th className="w-8"></th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.duplicate ? "opacity-60" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.checked}
                        aria-label={`Import ${r.name}`}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                      />
                    </td>
                    <td data-label="Name" className="font-medium whitespace-nowrap">
                      {r.name}
                      {r.duplicate && <span className="chip bg-warn-wash text-warn ml-1.5">exists</span>}
                    </td>
                    <td data-label="Phone" className="num whitespace-nowrap">{fmtPhone(r.phone)}</td>
                    <td data-label="Email" className="truncate max-w-[180px]">{r.email}</td>
                    <td data-label="Address" className="truncate max-w-[220px]">{r.address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="btn btn-primary h-11 mt-4 w-full md:w-auto" disabled={pending || selectedCount === 0} onClick={submit}>
            {pending ? "Importing…" : `Import ${selectedCount} customer${selectedCount === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </div>
  );
}
