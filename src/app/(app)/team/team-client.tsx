"use client";

// The CEO view of the crew: one row per worker (this week, next job, what's unsettled)
// that opens their page, plus "Add a worker". Workers never see this page — their side
// is Today / Calendar / My Pay. HIG lists-and-tables.md: rows open a detail view.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Wheel } from "@/components/brand";
import { IconChevronRight, IconPlus } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Avatar, ErrorNote, Field, LiveList, LiveRow, PageHeader, Stat } from "@/components/ui";
import { addEmployee } from "@/lib/actions/employees";
import { workerColor } from "@/lib/crew";
import { money, smsHref } from "@/lib/format";
import { fmtDateShort, minToLabel } from "@/lib/time";
import type { Employee } from "@/lib/types";

export interface WorkerStats {
  jobsWeek: number;
  revenueWeek: number;
  nextJob: { date: string; start_min: number; name: string } | null;
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

      {active.length > 0 && (
        <div className="stat-grid grid-cols-3">
          <Stat label="Crew jobs · month" value={totalJobs} />
          <Stat label="Cuts · month" value={money(totalCut)} />
          <Stat
            label="Unsettled"
            value={totalNet === 0 ? "Even" : totalNet > 0 ? `+${money(totalNet)}` : money(totalNet)}
            tone={totalNet > 0 ? "ok" : totalNet < 0 ? "bad" : undefined}
            href="/money/payouts"
          />
        </div>
      )}

      {adding && <AddWorkerCard onDone={() => setAdding(false)} />}

      {employees.length > 0 && (
        <div className="card divide-y divide-line overflow-hidden">
          <LiveList>
            {employees.map((e) => (
              <LiveRow key={e.id}>
                <WorkerRow employee={e} stats={stats[e.id]} />
              </LiveRow>
            ))}
          </LiveList>
        </div>
      )}
      {employees.length === 0 && !adding && (
        <p className="text-sm text-faint">No workers yet — add one and they can sign in right away.</p>
      )}
      <p className="text-xs text-faint">
        Workers see the schedule and their own pay — never pricing on other jobs, money, or this page. Cuts apply to
        payments on jobs they did and only change going forward.
      </p>
    </div>
  );
}

function WorkerRow({ employee, stats }: { employee: Employee; stats?: WorkerStats }) {
  const unsettled = stats && stats.count > 0;
  return (
    <Link href={`/team/${employee.id}`} className={`row row-link gap-3 ${employee.active ? "" : "opacity-60"}`}>
      <span className="inline-flex rounded-full shrink-0" style={{ boxShadow: `0 0 0 2px ${workerColor(employee.color)}` }}>
        <Avatar name={employee.name} size={38} />
      </span>
      <span className="min-w-0 grow">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-md font-semibold truncate">{employee.name}</span>
          <span className="text-xs font-medium text-faint num">{employee.split_pct}%</span>
          {!employee.active && <span className="chip">inactive</span>}
        </span>
        <span className="block text-xs text-ink-2 truncate num">
          {stats ? `This week: ${stats.jobsWeek} job${stats.jobsWeek === 1 ? "" : "s"} · ${money(stats.revenueWeek)}` : "—"}
          {stats?.nextJob && ` · next ${fmtDateShort(stats.nextJob.date)} ${minToLabel(stats.nextJob.start_min)} ${stats.nextJob.name.split(" ")[0]}`}
        </span>
      </span>
      {unsettled && (
        <span className={`chip shrink-0 ${stats.net < 0 ? "chip-warn" : "chip-ok"}`}>
          {stats.net < 0 ? `owe ${money(-stats.net)}` : stats.net > 0 ? `owes ${money(stats.net)}` : `${stats.count} to mark`}
        </span>
      )}
      <IconChevronRight width={16} height={16} className="shrink-0 text-faint" aria-hidden />
    </Link>
  );
}

function AddWorkerCard({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
      <div className="grid grid-cols-2 gap-2">
        <Field label="Email — this is their sign-in">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Phone" hint="So you can text them their login.">
          <input className="input num" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="239 555 0100" />
        </Field>
      </div>
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
            const res = await addEmployee({ name, email, password, splitPct: Number(split), phone });
            setPending(false);
            if (!res.ok) return setError(res.error);
            const body = `Your Buffer Bros login: admin.bufferbros.org — email ${email.trim()}, temp password ${password}. Use "Forgot password" to change it.`;
            if (phone.trim()) window.open(`${smsHref(phone)}&body=${encodeURIComponent(body)}`, "_self");
            toast({ title: `${name.trim()} can sign in`, detail: phone.trim() ? "Login texted to them" : "Send them their email + temp password" });
            onDone();
            router.refresh();
          }}
        >
          {pending ? (
            <>
              <Wheel size={16} /> Creating…
            </>
          ) : phone.trim() ? (
            "Create + text login"
          ) : (
            "Create worker + login"
          )}
        </button>
      </div>
    </div>
  );
}
