"use client";

// "Duplicates found" review (Apple Contacts-style): each group shows why the records
// matched, lets you pick which one survives, previews the merged contact, and merges
// in one atomic RPC — or remembers "not duplicates" so it never asks again.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { dismissDuplicates, mergeCustomers } from "@/lib/actions/customers";
import { previewMerge, type DupCandidate, type DupGroup, type DupReason } from "@/lib/duplicates";
import { fmtPhone } from "@/lib/format";
import { fmtDateShort } from "@/lib/time";
import { spring } from "@/lib/motion";
import { IconCheck } from "./icons";
import { Avatar, Busy, ErrorNote, Sheet } from "./ui";

const REASON: Record<DupReason, string> = { phone: "same phone", email: "same email", name: "same name" };
const groupKey = (g: DupGroup) => g.ids.join("|");

export function DuplicatesSheet({
  open,
  onClose,
  groups,
  candidates,
}: {
  open: boolean;
  onClose: () => void;
  groups: DupGroup[];
  candidates: DupCandidate[];
}) {
  const router = useRouter();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  // Groups resolved this session vanish immediately; the refresh confirms it.
  const [done, setDone] = useState<Set<string>>(new Set());
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = groups.filter((g) => !done.has(groupKey(g)));

  async function resolve(g: DupGroup, how: "merge" | "dismiss") {
    const key = groupKey(g);
    setBusy(key + how);
    setError(null);
    const keepId = keep[key] ?? g.keepId;
    const res = how === "merge" ? await mergeCustomers(keepId, g.ids.filter((id) => id !== keepId)) : await dismissDuplicates(g.ids);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setDone((s) => new Set(s).add(key));
    router.refresh();
  }

  async function mergeAll() {
    setBusy("all");
    setError(null);
    for (const g of shown) {
      const keepId = keep[groupKey(g)] ?? g.keepId;
      const res = await mergeCustomers(keepId, g.ids.filter((id) => id !== keepId));
      if (!res.ok) {
        setBusy(null);
        return setError(res.error);
      }
      setDone((s) => new Set(s).add(groupKey(g)));
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Duplicates" wide>
      <div className="flex flex-col gap-4">
        {shown.length > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-ink-2">
              {shown.length} {shown.length === 1 ? "person appears" : "people appear"} more than once. Merging keeps every
              visit, payment, car, and plan.
            </p>
            {shown.length > 1 && (
              <button className="btn btn-sm shrink-0" disabled={!!busy} onClick={mergeAll}>
                {busy === "all" ? <Busy>Merging…</Busy> : "Merge all"}
              </button>
            )}
          </div>
        ) : (
          <motion.div
            className="flex flex-col items-center text-center py-10"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={spring}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ok-wash text-ok">
              <IconCheck width={20} height={20} />
            </span>
            <p className="mt-3 font-medium">No duplicates left</p>
            <p className="mt-1 text-sm text-ink-2">Every customer is one record.</p>
          </motion.div>
        )}
        <ErrorNote>{error}</ErrorNote>

        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((g) => {
            const key = groupKey(g);
            const keepId = keep[key] ?? g.keepId;
            const cands = g.ids.map((id) => byId.get(id)).filter((c): c is DupCandidate => !!c);
            const preview = previewMerge(cands, keepId);
            return (
              <motion.section
                key={key}
                layout
                className="card overflow-hidden"
                exit={{ opacity: 0, scale: 0.97, filter: "blur(3px)" }}
                transition={spring}
              >
                <header className="flex flex-wrap items-center gap-1.5 px-4 pt-3.5 pb-2.5">
                  <h3 className="h-card mr-1">{preview.name}</h3>
                  <span className="chip">{cands.length} records</span>
                  {g.reasons.map((r) => (
                    <span key={r} className={`chip ${r === "name" ? "" : "chip-brand"}`}>
                      {REASON[r]}
                    </span>
                  ))}
                </header>
                {g.conflict && (
                  <p className="mx-4 mb-2.5 note note-warn text-dense">
                    Their phone numbers or emails differ — make sure this is one person before merging.
                  </p>
                )}

                <div role="radiogroup" aria-label="Which record to keep" className="px-2.5 flex flex-col gap-1">
                  {cands.map((c) => {
                    const on = c.id === keepId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setKeep((k) => ({ ...k, [key]: c.id }))}
                        className={`relative flex items-center gap-3 rounded-md px-2.5 py-2.5 text-left transition-colors ${
                          on ? "bg-brand-wash" : "hover:bg-subtle"
                        }`}
                      >
                        <Avatar name={c.name} size={32} />
                        <span className="min-w-0 grow">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{c.name}</span>
                            {c.archived && <span className="chip">archived</span>}
                          </span>
                          <span className="block text-xs text-faint truncate num">
                            {[fmtPhone(c.phone) || null, c.email, c.addresses[0]?.address].filter(Boolean).join(" · ") ||
                              "no contact info"}
                          </span>
                          <span className="block text-xs text-faint num">
                            added {fmtDateShort(c.created_at.slice(0, 10))} ·{" "}
                            {c.activity ? `${c.activity} visit${c.activity === 1 ? "" : "s"} & payments` : "no history"}
                          </span>
                        </span>
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                            on ? "bg-brand border-brand text-white" : "border-line-2"
                          }`}
                          aria-hidden
                        >
                          {on && <IconCheck width={12} height={12} weight="bold" />}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mx-4 mt-3 well px-3 py-2.5">
                  <p className="label mb-1">After merging</p>
                  <p className="text-dense text-ink-2">
                    <span className="font-medium text-ink">{preview.name}</span>
                    {preview.phone && <> · {fmtPhone(preview.phone)}</>}
                    {preview.email && <> · {preview.email}</>}
                    {preview.addresses.length > 0 &&
                      ` · ${preview.addresses.length} address${preview.addresses.length === 1 ? "" : "es"}`}
                    {preview.tags.length > 0 && ` · ${preview.tags.join(", ")}`}
                    {` · ${preview.activity} visit${preview.activity === 1 ? "" : "s"} & payments`}
                  </p>
                </div>

                <footer className="flex items-center justify-end gap-2 px-4 py-3.5">
                  <button className="btn btn-ghost btn-sm text-ink-2" disabled={!!busy} onClick={() => resolve(g, "dismiss")}>
                    {busy === key + "dismiss" ? <Busy>Saving…</Busy> : "Not duplicates"}
                  </button>
                  <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => resolve(g, "merge")}>
                    {busy === key + "merge" ? <Busy>Merging…</Busy> : `Merge ${cands.length} into one`}
                  </button>
                </footer>
              </motion.section>
            );
          })}
        </AnimatePresence>
      </div>
    </Sheet>
  );
}
