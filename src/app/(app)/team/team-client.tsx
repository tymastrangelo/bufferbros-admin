"use client";

// The CEO view of the crew: what each worker produced this month, what's assigned
// ahead, and where the split settlement stands — with the management knobs (cut %,
// login, calendar feed, deactivate) tucked behind "Manage". Workers never see this
// page — their side is just Today / Calendar / My Pay.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wheel } from "@/components/brand";
import { ErrorNote, Field } from "@/components/ui";
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
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-3xl flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Team</h1>
        {!adding && (
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            Add a worker
          </button>
        )}
      </div>

      {/* Crew at a glance */}
      {active.length > 0 && (
        <div className="grid grid-cols-3 gap-px bg-line border border-line rounded-lg overflow-hidden">
          <div className="bg-card px-3.5 py-3">
            <p className="label">Crew jobs — this month</p>
            <p className="mt-1 text-xl font-bold num leading-none">{totalJobs}</p>
          </div>
          <div className="bg-card px-3.5 py-3">
            <p className="label">Cuts earned — this month</p>
            <p className="mt-1 text-xl font-bold num leading-none">{money(totalCut)}</p>
          </div>
          <div className="bg-card px-3.5 py-3">
            <p className="label">Unsettled with crew</p>
            <p className={`mt-1 text-xl font-bold num leading-none ${totalNet > 0 ? "text-ok" : totalNet < 0 ? "text-bad" : ""}`}>
              {totalNet === 0 ? "Even" : totalNet > 0 ? `+${money(totalNet)}` : money(totalNet)}
            </p>
          </div>
        </div>
      )}

      {adding && <AddWorkerCard onDone={() => setAdding(false)} />}
      {employees.map((e) => (
        <WorkerCard key={e.id} employee={e} stats={stats[e.id]} />
      ))}
      {employees.length === 0 && !adding && (
        <p className="text-sm text-faint">No workers yet — add one and they can sign in right away.</p>
      )}
      <p className="text-[12px] text-faint">
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
    <div className="card p-4 flex flex-col gap-3 bg-surface">
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
      <div className="flex items-center gap-2">
        <div className="grow min-w-0">
          <p className="text-[15px] font-semibold truncate">
            {employee.name}
            <span className="text-[12px] font-medium text-faint num ml-2">{employee.split_pct}% cut</span>
            {!employee.active && <span className="chip bg-line-2 text-ink-2 ml-2">inactive</span>}
          </p>
          <p className="text-[12px] text-ink-2 truncate">
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-line border border-line rounded-lg overflow-hidden">
            <MiniStat label="Jobs this month" value={String(stats.jobsMonth)} sub={money(stats.revenueMonth) + " of work"} />
            <MiniStat label="Their cut" value={money(stats.cutMonth)} sub="this month" />
            <MiniStat label="Assigned ahead" value={String(stats.upcoming)} sub={stats.upcoming === 1 ? "job" : "jobs"} />
            <MiniStat label="Avg detail time" value={stats.avgMin != null ? fmtDur(stats.avgMin) : "—"} sub="clocked jobs" />
          </div>
          <Link
            href="/money/payouts"
            className={`text-[13px] font-medium rounded-md border px-3 py-2 ${
              stats.count === 0
                ? "text-ok bg-ok-wash border-[#bbe7c9]"
                : stats.net >= 0
                  ? "text-ok bg-ok-wash border-[#bbe7c9]"
                  : "text-bad bg-bad-wash border-[#fecaca]"
            }`}
          >
            {stats.count === 0
              ? "✓ All squared up"
              : stats.net > 0
                ? `${employee.name} owes you ${money(stats.net)} · ${stats.count} unsettled →`
                : stats.net < 0
                  ? `You owe ${employee.name} ${money(-stats.net)} · ${stats.count} unsettled →`
                  : `Even — ${stats.count} unsettled to mark off →`}
          </Link>
        </>
      )}

      {manage && <ManagePanel employee={employee} />}
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p className="label">{label}</p>
      <p className="mt-0.5 text-lg font-bold num leading-none">{value}</p>
      {sub && <p className="text-[11px] text-faint num mt-0.5">{sub}</p>}
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
