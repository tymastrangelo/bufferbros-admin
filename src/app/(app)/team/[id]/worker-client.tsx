"use client";

// One worker, everything about them: Overview (output), Pay (settle up), Schedule
// (hours, feed, time off), Settings (cut, phone, website bookings, color, deactivate).
// HIG tab-bars.md / segmented-controls.md: sections of one thing, not navigation.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconChevronRight } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Avatar, Busy, ConfirmPanel, EmptyState, Field, PageHeader, Stat, SuccessButton, Tabs } from "@/components/ui";
import { settleWorker, syncCalendarNow, unsettleEntries, updateEmployee } from "@/lib/actions/employees";
import { workerColor, workerWash } from "@/lib/crew";
import { fmtPhone, money } from "@/lib/format";
import { fmtDateShort, minToLabel } from "@/lib/time";
import type { Block, Employee, WeeklyHours } from "@/lib/types";
import { PayoutsClient, type FrontedRow, type PayoutEntry } from "../../money/payouts/payouts-client";
import { HoursEditor } from "./hours-editor";

export interface WorkerJob {
  id: string;
  date: string;
  start_min: number;
  duration_min: number;
  status: string;
  price: number;
  service_name: string;
  started_at: string | null;
  completed_at: string | null;
  name: string;
}

interface Stats {
  jobs30: number;
  revenue30: number;
  cut30: number;
  avgMin: number | null;
  noShows: number;
  /** + they owe you, − you owe them (unsettled). */
  net: number;
  count: number;
}

type Tab = "overview" | "pay" | "schedule" | "settings";

const fmtDur = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtSynced = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "never";

export function WorkerClient({
  employee,
  stats,
  upcoming,
  recent,
  payRows,
  fronted,
  business,
  blocks,
}: {
  employee: Employee;
  stats: Stats;
  upcoming: WorkerJob[];
  recent: WorkerJob[];
  payRows: PayoutEntry[];
  fronted: FrontedRow[];
  business: WeeklyHours[];
  blocks: Block[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="page max-w-3xl flex flex-col gap-4">
      <PageHeader
        back={{ href: "/team", label: "Team" }}
        title={
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex rounded-full" style={{ boxShadow: `0 0 0 2px ${workerColor(employee.color)}` }}>
              <Avatar name={employee.name} size={36} />
            </span>
            {employee.name}
            {!employee.active && <span className="chip">inactive</span>}
          </span>
        }
        sub={`${employee.split_pct}% cut · ${employee.phone ? fmtPhone(employee.phone) : "no phone"} · ${employee.email ?? ""}`}
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "pay", label: stats.count > 0 ? `Pay · ${stats.count}` : "Pay" },
          { value: "schedule", label: "Schedule" },
          { value: "settings", label: "Settings" },
        ]}
      />

      {tab === "overview" && <Overview stats={stats} upcoming={upcoming} recent={recent} />}
      {tab === "pay" && <Pay employee={employee} stats={stats} rows={payRows} fronted={fronted} />}
      {tab === "schedule" && <Schedule employee={employee} business={business} blocks={blocks} />}
      {tab === "settings" && <Settings employee={employee} />}
    </div>
  );
}

function Overview({ stats, upcoming, recent }: { stats: Stats; upcoming: WorkerJob[]; recent: WorkerJob[] }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="stat-grid grid-cols-2 md:grid-cols-5">
        <Stat label="Jobs · 30d" value={stats.jobs30} />
        <Stat label="Revenue · 30d" value={money(stats.revenue30)} />
        <Stat label="Their cut · 30d" value={money(stats.cut30)} />
        <Stat label="Avg time" value={stats.avgMin != null ? fmtDur(stats.avgMin) : "—"} hint="clocked jobs" />
        <Stat label="No-shows · 30d" value={stats.noShows} tone={stats.noShows > 0 ? "warn" : undefined} />
      </div>
      <JobList title="Up next" jobs={upcoming} empty="Nothing assigned ahead." />
      <JobList title="Recent" jobs={recent} empty="No completed jobs in the last 30 days." />
    </div>
  );
}

function JobList({ title, jobs, empty }: { title: string; jobs: WorkerJob[]; empty: string }) {
  return (
    <section>
      <h2 className="label mb-2">{title}</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-faint">{empty}</p>
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {jobs.map((j) => (
            <Link key={j.id} href={`/calendar?view=day&d=${j.date}`} className="row row-link gap-3">
              <span className="min-w-0 grow">
                <span className="block text-sm font-medium truncate">
                  {j.name} <span className="text-faint font-normal">· {j.service_name}</span>
                </span>
                <span className="block text-xs text-faint num">
                  {fmtDateShort(j.date)} at {minToLabel(j.start_min)} · {j.duration_min}m
                  {j.status === "no_show" && " · no-show"}
                  {j.started_at && j.completed_at && ` · took ${fmtDur((new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 60000)}`}
                </span>
              </span>
              <span className="num font-medium shrink-0">{money(j.price)}</span>
              <IconChevronRight width={16} height={16} className="shrink-0 text-faint" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Pay({ employee, stats, rows, fronted }: { employee: Employee; stats: Stats; rows: PayoutEntry[]; fronted: FrontedRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const line = stats.net === 0 ? "Even" : stats.net > 0 ? `${employee.name} owes you ${money(stats.net)}` : `You owe ${employee.name} ${money(-stats.net)}`;

  async function settle() {
    setPending(true);
    const res = await settleWorker(employee.id);
    setPending(false);
    if (!res.ok) return toast({ title: "Couldn't settle up", detail: res.error, tone: "bad" });
    setConfirm(false);
    router.refresh();
    const ids = res.ids ?? [];
    const expenseIds = res.expenseIds ?? [];
    toast({
      title: `Settled up with ${employee.name}`,
      detail: `${ids.length} payment${ids.length === 1 ? "" : "s"}${expenseIds.length ? ` + ${expenseIds.length} expense${expenseIds.length === 1 ? "" : "s"}` : ""} · ${line}`,
      undoneTitle: "Unsettled again",
      undo: async () => {
        const back = await unsettleEntries(ids, expenseIds);
        if (back.ok) router.refresh();
        return back;
      },
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {stats.count > 0 &&
        (confirm ? (
          <ConfirmPanel
            title={`Mark ${stats.count} payment${stats.count === 1 ? "" : "s"} settled?`}
            consequence={`${line}. Do this once the money has actually moved.`}
            confirmLabel="Settle up"
            busyLabel="Settling…"
            pending={pending}
            onCancel={() => setConfirm(false)}
            onConfirm={settle}
          />
        ) : (
          <button className="btn btn-primary self-start" onClick={() => setConfirm(true)}>
            Settle up · {stats.count}
          </button>
        ))}
      <Link href={`/money/expenses?paidBy=${employee.id}`} className="link text-dense self-start">
        Log something {employee.name.split(" ")[0]} paid out of pocket
      </Link>
      {rows.length === 0 && fronted.length === 0 ? (
        <EmptyState title="No payments on their jobs yet." hint="Their cut shows up here as soon as a job they did gets paid." />
      ) : (
        <div className="-mt-5">
          <PayoutsClient rows={rows} fronted={fronted} washerPct={employee.split_pct} name={employee.name} />
        </div>
      )}
    </div>
  );
}

function Schedule({ employee, business, blocks }: { employee: Employee; business: WeeklyHours[]; blocks: Block[] }) {
  const router = useRouter();
  const [feed, setFeed] = useState(employee.ical_url ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [syncing, setSyncing] = useState(false);
  async function saveFeed() {
    setState("saving");
    const res = await updateEmployee(employee.id, { ical_url: feed.trim() || null });
    if (!res.ok) return setState(res.error ?? "Failed.");
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 1600);
  }
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="label mb-2">Working hours</h2>
        <HoursEditor employeeId={employee.id} hours={employee.hours} business={business} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="label">Other-job calendar</h2>
        <Field label="Calendar feed (iCal link)" hint={`Their shifts elsewhere auto-block the schedule. Last synced: ${fmtSynced(employee.ical_synced_at)}.`}>
          <input className="input" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={feed} onChange={(e) => setFeed(e.target.value)} />
        </Field>
        <div className="flex items-center gap-2">
          <SuccessButton state={state} onClick={saveFeed} disabled={feed === (employee.ical_url ?? "")}>
            Save feed
          </SuccessButton>
          {employee.ical_url && feed === employee.ical_url && (
            <button
              className="btn btn-sm"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                await syncCalendarNow(employee.id);
                setSyncing(false);
                router.refresh();
              }}
            >
              {syncing ? <Busy>Syncing…</Busy> : "Sync now"}
            </button>
          )}
        </div>
      </section>
      <section>
        <h2 className="label mb-2">Time off ahead</h2>
        {blocks.length === 0 ? (
          <p className="text-sm text-faint">Nothing blocked. Block time from the calendar, or let their feed do it.</p>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {blocks.map((b) => (
              <Link key={b.id} href={`/calendar?view=day&d=${b.date}`} className="row row-link justify-between">
                <span className="text-sm font-medium num">
                  {fmtDateShort(b.date)} · {b.start_min === 0 && b.end_min === 1440 ? "all day" : `${minToLabel(b.start_min)} – ${minToLabel(b.end_min)}`}
                </span>
                <span className="text-xs text-faint truncate">{b.reason ?? (b.source === "ical" ? "from their calendar" : "")}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Settings({ employee }: { employee: Employee }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(employee.name);
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [split, setSplit] = useState(String(employee.split_pct));
  const [color, setColor] = useState(employee.color);
  const [web, setWeb] = useState(employee.takes_web_bookings);
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const [confirmActive, setConfirmActive] = useState(false);
  const [pending, setPending] = useState(false);
  const dirty = name !== employee.name || phone !== (employee.phone ?? "") || Number(split) !== employee.split_pct || color !== employee.color || web !== employee.takes_web_bookings;

  async function save() {
    setState("saving");
    const res = await updateEmployee(employee.id, { name: name.trim(), phone: phone || null, split_pct: Number(split), color, takes_web_bookings: web });
    if (!res.ok) return setState(res.error ?? "Failed.");
    setState("saved");
    router.refresh();
    setTimeout(() => setState("idle"), 1600);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Their cut %" hint="Applies to payments from now on.">
          <input type="number" min={0} max={100} className="input num" value={split} onChange={(e) => setSplit(e.target.value)} />
        </Field>
        <Field label="Phone">
          <input className="input num" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email (their sign-in)">
          <input className="input" value={employee.email ?? ""} readOnly />
        </Field>
      </div>
      <Field label="Calendar color">
        <div className="flex gap-2" role="radiogroup" aria-label="Calendar color">
          {[1, 2, 3, 4, 5, 6].map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className="choice h-10 w-10 rounded-full p-0 text-dense font-semibold"
              style={{ background: workerWash(c), boxShadow: `0 0 0 ${color === c ? 3 : 2}px ${workerColor(c)}` }}
            >
              <Avatar name={employee.name} size={28} />
            </button>
          ))}
        </div>
      </Field>
      {/* switch-style toggle lives in a row (HIG toggles.md) */}
      <label className="card row justify-between cursor-pointer">
        <span>
          <span className="block text-sm font-medium">Takes online bookings</span>
          <span className="block text-xs text-ink-2">The website offers times when they&apos;re free. Their name never shows online.</span>
        </span>
        <input type="checkbox" role="switch" className="h-5 w-9" checked={web} onChange={(e) => setWeb(e.target.checked)} />
      </label>
      <div className="flex items-center gap-2">
        <SuccessButton state={state} onClick={save} disabled={!dirty}>
          Save changes
        </SuccessButton>
      </div>

      <div className="border-t border-line pt-4 flex flex-col gap-3">
        {confirmActive ? (
          <ConfirmPanel
            title={employee.active ? `Deactivate ${employee.name}?` : `Reactivate ${employee.name}?`}
            consequence={employee.active ? "They lose access to the app and can't be assigned new jobs. Pay history and past jobs stay." : "They get the app back and can take jobs again."}
            confirmLabel={employee.active ? "Deactivate" : "Reactivate"}
            busyLabel="Saving…"
            destructive={employee.active}
            pending={pending}
            onCancel={() => setConfirmActive(false)}
            onConfirm={async () => {
              setPending(true);
              const res = await updateEmployee(employee.id, { active: !employee.active });
              setPending(false);
              if (!res.ok) return toast({ title: "Couldn't change that", detail: res.error, tone: "bad" });
              setConfirmActive(false);
              router.refresh();
              toast({ title: employee.active ? `${employee.name} deactivated` : `${employee.name} is back on the crew` });
            }}
          />
        ) : (
          <button className={`btn self-start ${employee.active ? "btn-danger" : ""}`} onClick={() => setConfirmActive(true)}>
            {employee.active ? "Deactivate worker" : "Reactivate worker"}
          </button>
        )}
        <p className="text-xs text-faint">
          What {employee.name} can see: the schedule, every job&apos;s details, quotes, and their own pay. Never prices on other
          workers&apos; jobs, Money, Marketing, or this page.
        </p>
      </div>
    </div>
  );
}
