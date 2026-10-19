"use client";

// The CEO view of the crew: what each worker produced this month, what's assigned
// ahead, and where the split settlement stands — with the management knobs (cut %,
// login, calendar feed, deactivate) tucked behind "Manage". Workers never see this
// page — their side is just Today / Calendar / My Pay.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wheel } from "@/components/brand";
import { IconPlus } from "@/components/icons";
import { Avatar, ErrorNote, Field, PageHeader, Stat } from "@/components/ui";
import { addEmployee, syncCalendarNow, updateEmployee } from "@/lib/actions/employees";
import { money } from "@/lib/format";
import type { Employee } from "@/lib/types";

export interface WorkerStats {
  jobsMonth: number;
  revenueMonth: number;
  /** Their cut mirrored off this month's payments. */
  cutMonth: number;
  /** Scheduled jobs assigned to them from today forward. */
  upcoming: number;
  /** Average clocked detail time this month, minutes. */
  avgMin: number | null;
  /** Unsettled split net: + they owe you, − you owe them. */
  net: number;
  count: number;
}

const fmtSynced = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })
    : "never";

const fmtDur = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export function TeamClient({ employees, stats }: { employees: Employee[]; stats: Record<string, WorkerStats> }) {
  const [adding, setAdding] = useState(false);
  const active = employees.filter((e) => e.active);
  const totalNet = active.reduce((s, e) => s + (stats[e.id]?.net ?? 0), 0);
  const totalCut = active.reduce((s, e) => s + (stats[e.id]?.cutMonth ?? 0), 0);
  const totalJobs = active.reduce((s, e) => s + (stats[e.id]?.jobsMonth ?? 0), 0);

  return (
    <div className="page max-w-3xl flex flex-col gap-4">
      <div className="-mb-4">
        <PageHeader
          title="Team"
          sub={`${active.length} active worker${active.length === 1 ? "" : "s"}`}
          actions={
            !adding && (
              <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
                <IconPlus width={14} height={14} /> Add a worker
              </button>
            )
          }
        />
      </div>

      {/* Crew at a glance */}
      {active.length > 0 && (
        <div className="stat-grid grid-cols-3">
          <Stat label="Crew jobs — this month" value={totalJobs} />
          <Stat label="Cuts earned — this month" value={money(totalCut)} />
          <Stat
            label="Unsettled with crew"
            value={totalNet === 0 ? "Even" : totalNet > 0 ? `+${money(totalNet)}` : money(totalNet)}
            tone={totalNet > 0 ? "ok" : totalNet < 0 ? "bad" : undefined}
            href="/money/payouts"
          />
        </div>
      )}

      {adding && <AddWorkerCard onDone={() => setAdding(false)} />}
      {employees.map((e) => (
        <WorkerCard key={e.id} employee={e} stats={stats[e.id]} />
      ))}
      {employees.length === 0 && !adding && (
        <p className="text-sm text-faint">No workers yet — add one and they can sign in right away.</p>
      )}
      <p className="text-xs text-faint">
        Workers see the schedule and their own pay — never pricing, money, or this page. Cuts apply to payments on jobs
        they did and only change going forward.
      </p>
    </div>
  );
}

function AddWorkerCard({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [split, setSplit] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <div className="well p-4 flex flex-col gap-3">
      <p className="label">New worker</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Their cut %">
          <input type="number" min={0} max={100} className="input num" value={split} onChange={(e) => setSplit(e.target.value)} />
        </Field>
      </div>
      <Field label="Email — this is their sign-in">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Temp password" hint="Text it to them; they can change it with “Forgot password” on the login page.">
        <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await addEmployee({ name, email, password, splitPct: Number(split) });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onDone();
            router.refresh();
          }}
        >
          {pending ? (
            <>
              <Wheel size={16} /> Creating…
            </>
          ) : (
            "Create worker + login"
          )}
        </button>
      </div>
    </div>
  );
}

function WorkerCard({ employee, stats }: { employee: Employee; stats?: WorkerStats }) {
  const [manage, setManage] = useState(false);
  const feedLive = !!employee.ical_url;

  return (
    <div className={`card p-4 flex flex-col gap-3 ${employee.active ? "" : "opacity-60"}`}>
      <div className="flex items-center gap-3">
        <Avatar name={employee.name} size={38} />
        <div className="grow min-w-0">
          <p className="text-md font-semibold truncate">
            {employee.name}
            <span className="text-xs font-medium text-faint num ml-2">{employee.split_pct}% cut</span>
            {!employee.active && <span className="chip ml-2">inactive</span>}
          </p>
          <p className="text-xs text-ink-2 truncate">
            {employee.email}
            {" · "}
            {feedLive ? `calendar synced ${fmtSynced(employee.ical_synced_at)}` : "no calendar feed"}
          </p>
        </div>
        <button className="btn btn-sm shrink-0" onClick={() => setManage((v) => !v)} aria-expanded={manage}>
          {manage ? "Done" : "Manage"}
        </button>
      </div>

      {stats && (
        <>
          <div className="stat-grid grid-cols-2 sm:grid-cols-4">
            <MiniStat label="Jobs this month" value={String(stats.jobsMonth)} sub={money(stats.revenueMonth) + " of work"} />
            <MiniStat label="Their cut" value={money(stats.cutMonth)} sub="this month" />
            <MiniStat label="Assigned ahead" value={String(stats.upcoming)} sub={stats.upcoming === 1 ? "job" : "jobs"} />
            <MiniStat label="Avg detail time" value={stats.avgMin != null ? fmtDur(stats.avgMin) : "—"} sub="clocked jobs" />
          </div>
          <Link
            href="/money/payouts"
            className={`note text-dense font-medium transition-opacity hover:opacity-85 ${stats.net >= 0 || stats.count === 0 ? "note-ok" : "note-bad"}`}
          >
            {stats.count === 0
              ? "All squared up"
              : stats.net > 0
                ? `${employee.name} owes you ${money(stats.net)} · ${stats.count} unsettled`
                : stats.net < 0
                  ? `You owe ${employee.name} ${money(-stats.net)} · ${stats.count} unsettled`
                  : `Even — ${stats.count} unsettled to mark off`}
          </Link>
        </>
      )}

      {manage && <ManagePanel employee={employee} />}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="mt-1 text-lg font-semibold num leading-none tracking-tight">{value}</p>
      {sub && <p className="text-label text-faint num mt-0.5">{sub}</p>}
    </div>
  );
}

function ManagePanel({ employee }: { employee: Employee }) {
  const router = useRouter();
  const [name, setName] = useState(employee.name);
  const [split, setSplit] = useState(String(employee.split_pct));
  const [feed, setFeed] = useState(employee.ical_url ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "syncing" | string>("idle");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, busy: "saving" | "syncing" = "saving") {
    setState(busy);
    const res = await fn();
    if (!res.ok) return setState(res.error ?? "Failed.");
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 2000);
  }

  const dirty = name !== employee.name || Number(split) !== employee.split_pct || feed !== (employee.ical_url ?? "");

  return (
    <div className="border-t border-line pt-3 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Their cut %">
          <input type="number" min={0} max={100} className="input num" value={split} onChange={(e) => setSplit(e.target.value)} />
        </Field>
      </div>
      <Field
        label="Calendar feed (iCal link)"
        hint={`Their other-job calendar auto-blocks the schedule. Last synced: ${fmtSynced(employee.ical_synced_at)}.`}
      >
        <div className="flex gap-2">
          <input
            className="input grow"
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            value={feed}
            onChange={(e) => setFeed(e.target.value)}
          />
          {employee.ical_url && feed === employee.ical_url && (
            <button
              className="btn btn-sm shrink-0"
              disabled={state === "syncing"}
              onClick={() => run(() => syncCalendarNow(employee.id), "syncing")}
            >
              {state === "syncing" ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>
      </Field>
      <div className="flex items-center gap-2">
        <button
          className="btn btn-primary btn-sm"
          disabled={!dirty || state === "saving"}
          onClick={() =>
            run(() =>
              updateEmployee(employee.id, { name: name.trim(), split_pct: Number(split), ical_url: feed.trim() || null })
            )
          }
        >
          {state === "saving" ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-sm" onClick={() => run(() => updateEmployee(employee.id, { active: !employee.active }))}>
          {employee.active ? "Deactivate" : "Reactivate"}
        </button>
        {state === "saved" && <span className="text-sm text-ok">Saved.</span>}
        {!["idle", "saving", "saved", "syncing"].includes(state) && <span className="text-sm text-bad">{state}</span>}
      </div>
    </div>
  );
}
