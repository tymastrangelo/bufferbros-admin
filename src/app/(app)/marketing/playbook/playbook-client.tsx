"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconCheckCircle, IconChevronDown, IconCircle, IconPlus } from "@/components/icons";
import { Busy, ErrorNote, Field, SectionLabel, Sheet } from "@/components/ui";
import { deleteTask, saveTask, setTaskDone } from "@/lib/actions/marketing";
import { channelLabel } from "@/lib/marketing";
import { addDays, fmtDateShort } from "@/lib/time";
import type { ChannelId, MarketingTask, TaskPhase } from "@/lib/types";
import { ChannelSelect } from "@/components/marketing-bits";

const PHASES: { id: TaskPhase; label: string; short: string }[] = [
  { id: "now", label: "Do now", short: "Now" },
  { id: "month", label: "This month", short: "Month" },
  { id: "season", label: "Through the season", short: "Season" },
  { id: "ongoing", label: "Every week", short: "Weekly" },
];

/** Full URLs in a step's notes become tappable links. */
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="link break-all">
        {part.replace(/^https?:\/\//, "").replace(/#.*$/, "")}
      </a>
    ) : (
      part
    )
  );
}

/** Weekly habits count as done for 7 days, then come back unchecked. */
function isDone(t: Pick<MarketingTask, "phase" | "done_on">, today: string) {
  if (!t.done_on) return false;
  return t.phase === "ongoing" ? t.done_on >= addDays(today, -6) : true;
}

export function PlaybookClient({ tasks, today }: { tasks: MarketingTask[]; today: string }) {
  const router = useRouter();
  // optimistic check-offs until the refresh lands
  const [override, setOverride] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<MarketingTask | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const view = tasks.map((t) => (t.id in override ? { ...t, done_on: override[t.id] } : t));
  const oneTime = view.filter((t) => t.phase !== "ongoing");
  const doneCount = oneTime.filter((t) => isDone(t, today)).length;

  async function toggle(t: MarketingTask) {
    const next = !isDone(t, today);
    setError(null);
    setOverride((o) => ({ ...o, [t.id]: next ? today : null }));
    const res = await setTaskDone(t.id, next);
    if (!res.ok) {
      setOverride((o) => {
        const n = { ...o };
        delete n[t.id];
        return n;
      });
      return setError(res.error);
    }
    router.refresh();
  }

  return (
    <div className="mt-5 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-ink-2">
            <span className="num font-semibold text-ink">{doneCount}</span> of <span className="num">{oneTime.length}</span> steps done
          </p>
          <button className="add-link" onClick={() => setEdit("new")}>
            <IconPlus width={13} height={13} /> Add a step
          </button>
        </div>
        <div
          className="h-1.5 rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-label="Playbook progress"
          aria-valuemin={0}
          aria-valuemax={oneTime.length}
          aria-valuenow={doneCount}
        >
          <div
            className="h-full w-full origin-left rounded-full bg-brand transition-transform duration-300"
            style={{ transform: `scaleX(${oneTime.length ? doneCount / oneTime.length : 0})` }}
          />
        </div>
        <ErrorNote>{error}</ErrorNote>
      </div>

      {PHASES.map((p) => {
        const list = view.filter((t) => t.phase === p.id);
        if (!list.length) return null;
        const done = list.filter((t) => isDone(t, today)).length;
        return (
          <section key={p.id}>
            <SectionLabel trailing={p.id === "ongoing" ? `${done} done this week` : `${done} of ${list.length}`}>{p.label}</SectionLabel>
            <div className="card divide-y divide-line">
              {list.map((t) => {
                const checked = isDone(t, today);
                const expanded = open === t.id;
                const overdue = !checked && t.due_on && t.due_on < today;
                return (
                  <div key={t.id} className="flex items-start gap-1 px-2 py-1.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={t.title}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-transform active:scale-95"
                      onClick={() => toggle(t)}
                    >
                      {checked ? (
                        <IconCheckCircle width={22} height={22} weight="fill" className="text-ok" />
                      ) : (
                        <IconCircle width={22} height={22} className="text-faint" />
                      )}
                    </button>
                    <div className="min-w-0 grow py-2 pr-2">
                      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.id)}>
                        <span className="min-w-0">
                          <span className={`block text-md font-medium ${checked ? "text-faint line-through" : ""}`}>{t.title}</span>
                          <span className="block text-dense text-ink-2">
                            {[
                              checked && t.done_on ? `done ${fmtDateShort(t.done_on)}` : t.due_on ? `due ${fmtDateShort(t.due_on)}` : null,
                              t.channel ? channelLabel(t.channel) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {overdue && <span className="text-warn font-medium"> · overdue</span>}
                          </span>
                        </span>
                        <IconChevronDown
                          width={16}
                          height={16}
                          aria-hidden
                          className={`mt-1 shrink-0 text-faint transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                      {expanded && (
                        <div className="page-in mt-2">
                          {t.detail && <p className="text-sm text-ink-2 whitespace-pre-line">{linkify(t.detail)}</p>}
                          <button className="link mt-2 text-sm" onClick={() => setEdit(t)}>
                            Edit step
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {edit && <TaskSheet task={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TaskSheet({ task, onClose }: { task: MarketingTask | null; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(task?.title ?? "");
  const [detail, setDetail] = useState(task?.detail ?? "");
  const [phase, setPhase] = useState<TaskPhase>(task?.phase ?? "now");
  const [channel, setChannel] = useState<ChannelId | null>(task?.channel ?? null);
  const [dueOn, setDueOn] = useState(task?.due_on ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <Sheet open onClose={onClose} title={task ? "Edit step" : "New step"}>
      <div className="flex flex-col gap-4">
        <Field label="Step">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!task} placeholder="Drop flyers at the Esplanade" />
        </Field>
        <div>
          <p className="label mb-1.5">When</p>
          <div className="grid grid-cols-4 gap-1.5">
            {PHASES.map((p) => (
              <button key={p.id} type="button" className="choice px-1 text-sm" aria-pressed={phase === p.id} onClick={() => setPhase(p.id)}>
                {p.short}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Channel">
            <ChannelSelect value={channel} onChange={setChannel} unknownLabel="General" />
          </Field>
          <Field label="Due">
            <input type="date" className="input num" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
          </Field>
        </div>
        <Field label="How to do it">
          <textarea className="textarea" rows={5} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={!!pending || !title.trim()}
          onClick={async () => {
            setError(null);
            setPending("save");
            const res = await saveTask({ title, detail, phase, channel, dueOn: dueOn || null }, task?.id);
            setPending(null);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending === "save" ? <Busy>Saving…</Busy> : task ? "Save changes" : "Add step"}
        </button>
        {task && (
          <button
            className="btn btn-danger"
            disabled={!!pending}
            onClick={async () => {
              if (!confirmDelete) return setConfirmDelete(true);
              setPending("delete");
              const res = await deleteTask(task.id);
              setPending(null);
              if (!res.ok) return setError(res.error);
              onClose();
              router.refresh();
            }}
          >
            {confirmDelete ? "Tap again to delete this step" : "Delete step"}
          </button>
        )}
      </div>
    </Sheet>
  );
}
