"use client";

// Crew notes (0042): short signed notes anyone on the crew leaves on a client or on one job.
// On a job sheet it shows that job's notes plus the client's standing ones; on the profile,
// everything. Loads its own rows from the browser client, like Money and Timeline.
// HIG: segmented-controls.md › Best practices (two closely related choices), alerts.md ›
// "confirm an uncommon destructive action that can't be undone" (inline Delete / Cancel).
import { useEffect, useState } from "react";
import { addNote, deleteNote } from "@/lib/actions/notes";
import { createClient } from "@/lib/supabase/client";
import { useOwner } from "@/lib/use-owner";
import type { CustomerNote } from "@/lib/types";
import { IconPlus, IconTrash } from "./icons";
import { fmtAt } from "./job-detail-sections";
import { Busy, Segmented, SuccessButton } from "./ui";

type Scope = "job" | "client";

export function NotesSection({
  customerId,
  appointmentId = null,
  jobLabel,
}: {
  customerId: string | null;
  /** Set on a job sheet: new notes can attach to this job, and other jobs' notes stay out. */
  appointmentId?: string | null;
  /** Profile only: names the job a note was left on ("Nov 15 job"). */
  jobLabel?: (appointmentId: string) => string;
}) {
  const owner = useOwner();
  const [notes, setNotes] = useState<CustomerNote[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<Scope>("job");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ponytail: refetches on open and after your own add/delete, not live — add customer_notes
  // to the realtime publication + a subscription here if two people note the same job at once.
  useEffect(() => {
    let stale = false;
    const db = createClient();
    db.auth.getSession().then(({ data }) => !stale && setMe(data.session?.user?.id ?? null));
    const q = db.from("customer_notes").select("*");
    (customerId ? q.eq("customer_id", customerId) : q.eq("appointment_id", appointmentId ?? ""))
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!stale) setNotes((data as CustomerNote[]) ?? []);
      });
    return () => {
      stale = true;
    };
  }, [customerId, appointmentId, tick]);

  if (!customerId && !appointmentId) return null;
  const shown = appointmentId ? notes.filter((n) => !n.appointment_id || n.appointment_id === appointmentId) : notes;
  const canPickScope = !!customerId && !!appointmentId;
  const toJob = !!appointmentId && (!canPickScope || scope === "job");

  async function save() {
    setState("saving");
    const res = await addNote({ customerId, appointmentId: toJob ? appointmentId : null, body: draft });
    if (!res.ok) return setState(res.error ?? "Couldn't save the note. Try again.");
    setState("saved");
    setTick((t) => t + 1);
    setTimeout(() => {
      setState("idle");
      setDraft("");
      setEditing(false);
    }, 900);
  }

  async function remove(id: string) {
    setDeleting(true);
    const res = await deleteNote(id);
    setDeleting(false);
    setConfirm(null);
    if (!res.ok) return setDeleteError(res.error);
    setDeleteError(null);
    setTick((t) => t + 1);
  }

  const where = (n: CustomerNote) =>
    appointmentId ? (n.appointment_id ? "" : " · about the client") : n.appointment_id ? ` · ${jobLabel?.(n.appointment_id) ?? "on a job"}` : "";

  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Notes">
          {shown.map((n) => (
            <li key={n.id} className="note">
              <p className="text-sm text-ink whitespace-pre-wrap break-words">{n.body}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-faint">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-ink-2">{n.author_name}</span> · <span className="num">{fmtAt(n.created_at)}</span>
                  {where(n)}
                </span>
                {(owner || n.author_user_id === me) &&
                  (confirm === n.id ? (
                    <span className="ml-auto flex items-center gap-1.5 shrink-0">
                      <button type="button" className="btn btn-sm" onClick={() => setConfirm(null)} disabled={deleting}>
                        Cancel
                      </button>
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => remove(n.id)} disabled={deleting}>
                        {deleting ? <Busy>Deleting…</Busy> : "Delete note"}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn btn-ghost btn-icon ml-auto shrink-0 text-faint" aria-label="Delete note" onClick={() => setConfirm(n.id)}>
                      <IconTrash width={15} height={15} aria-hidden />
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleteError && <p className="note note-bad">{deleteError}</p>}
      {!editing ? (
        <button type="button" className="add-link self-start" onClick={() => setEditing(true)}>
          <IconPlus width={13} height={13} aria-hidden />
          Add a note
        </button>
      ) : (
        <div className="well p-3 flex flex-col gap-2">
          <textarea
            className="textarea"
            rows={3}
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={toJob ? "Ran long — heavy pet hair. Told them about the scratch on the rear bumper." : "Prefers no tire shine. Dog is friendly. Likes a text when we're 10 minutes out."}
            aria-label="Note"
            autoFocus
          />
          {canPickScope && (
            <Segmented
              label="What the note is about"
              value={scope}
              onChange={setScope}
              options={[
                { value: "job", label: "This job" },
                { value: "client", label: "The client" },
              ]}
            />
          )}
          <p className="text-xs text-faint">
            {toJob
              ? customerId
                ? "Stays with this job, and is listed on the client's profile."
                : "Stays with this job."
              : "Saved on the client — shows on every one of their jobs."}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <SuccessButton state={state} onClick={save} doneLabel="Added" disabled={!draft.trim()}>
              Add note
            </SuccessButton>
          </div>
        </div>
      )}
    </div>
  );
}
