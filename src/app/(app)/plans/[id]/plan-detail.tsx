"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobSheet, type JobWithCustomer } from "@/components/job-sheet";
import { PlanFormSheet } from "@/components/plan-form";
import { Balance, ErrorNote, StatusChip } from "@/components/ui";
import { schedulePlanVisits, setPlanStatus } from "@/lib/actions/plans";
import type { Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { fmtDateShort, minToLabel, WEEKDAYS } from "@/lib/time";
import type { Customer, LedgerEntry, Plan } from "@/lib/types";
import type { OccurrenceConflict } from "@/lib/occurrences";

export function PlanDetail({
  plan,
  appointments,
  ledger,
  catalog,
  today,
  prepayDiscountPct,
}: {
  plan: Plan & { customers: Customer };
  appointments: JobWithCustomer[];
  ledger: LedgerEntry[];
  catalog: Catalog;
  today: string;
  prepayDiscountPct: number;
}) {
  const router = useRouter();
  const [job, setJob] = useState<JobWithCustomer | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<OccurrenceConflict[]>([]);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  const completed = appointments.filter((a) => a.status === "completed");
  const upcoming = appointments.filter((a) => a.status === "scheduled" && a.date >= today).reverse();
  const revenue = ledger
    .filter((e) => e.plan_id === plan.id && e.kind === "charge")
    .reduce((s, e) => s + Math.abs(e.amount), 0);
  const balance = ledger.reduce((s, e) => s + e.amount, 0);
  const visitsLeft = balance > 0 && plan.per_visit_price > 0 ? Math.floor(balance / plan.per_visit_price) : 0;

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setPending(true);
    const res = await fn();
    setPending(false);
    if (!res.ok) setError(res.error ?? "Something went wrong.");
    else router.refresh();
  }

  async function generate() {
    setError(null);
    setGenMsg(null);
    setPending(true);
    const res = await schedulePlanVisits(plan.id);
    setPending(false);
    if (!res.ok) return setError(res.error);
    setConflicts(res.result.conflicts);
    setGenMsg(`Scheduled ${res.result.created} visit${res.result.created === 1 ? "" : "s"}.`);
    router.refresh();
  }

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-4xl">
      <nav className="text-[13px] text-faint mb-2">
        <Link href="/plans" className="hover:text-ink">
          Plans
        </Link>{" "}
        / {plan.customers.name}
      </nav>

      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Link href={`/customers/${plan.customer_id}`} className="hover:underline underline-offset-2">
              {plan.customers.name}
            </Link>
            <StatusChip status={plan.status} />
          </h1>
          <p className="text-sm text-ink-2 mt-1 capitalize">
            {plan.cadence === "custom" ? `Every ${plan.interval_days} days` : plan.cadence} ·{" "}
            <span className="num">{money(plan.per_visit_price)}</span>/visit · {plan.duration_min} min
            {plan.preferred_dow != null && ` · ${WEEKDAYS[plan.preferred_dow]}s`}
            {plan.preferred_min != null && ` at ${minToLabel(plan.preferred_min)}`}
          </p>
          {plan.billing_note && <p className="text-sm text-warn mt-0.5">{plan.billing_note}</p>}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className="btn btn-sm" onClick={() => setEditOpen(true)}>
            Edit
          </button>
          {plan.status === "active" && (
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={generate}>
              Schedule visits
            </button>
          )}
        </div>
      </header>

      {/* Economics */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-px bg-line border border-line rounded-[10px] overflow-hidden">
        <Econ label="Visits completed" value={String(completed.length)} />
        <Econ label="Revenue to date" value={money(revenue)} />
        <Econ label="Customer balance" value={<Balance amount={balance} />} />
        <Econ
          label="Credit covers"
          value={balance > 0 ? `${visitsLeft} more visit${visitsLeft === 1 ? "" : "s"}` : "—"}
        />
      </div>
      {prepayDiscountPct > 0 && plan.status === "active" && (
        <p className="mt-2 text-[13px] text-ink-2">
          Prepay pricing: {prepayDiscountPct}% off per visit when paid up front —{" "}
          <span className="num font-medium">{money(plan.per_visit_price * (1 - prepayDiscountPct / 100))}</span>/visit
          (edit in Settings).
        </p>
      )}

      <ErrorNote>{error}</ErrorNote>
      {genMsg && <p className="mt-3 text-sm text-ok">{genMsg}</p>}
      {conflicts.length > 0 && (
        <div className="mt-3 rounded-md border border-[#fde68a] bg-warn-wash px-4 py-3">
          <p className="text-sm font-medium text-warn">Needs manual placement:</p>
          <ul className="mt-1 text-sm text-warn">
            {conflicts.map((c) => (
              <li key={c.date} className="num">
                {fmtDateShort(c.date)} — {c.reason}
              </li>
            ))}
          </ul>
          <Link href={`/calendar?view=week&d=${conflicts[0].date}`} className="text-sm font-semibold text-warn underline underline-offset-2">
            Open calendar to place them →
          </Link>
        </div>
      )}

      {/* Status actions */}
      <div className="mt-4 flex gap-1.5">
        {plan.status === "active" && (
          <>
            <button className="btn btn-sm" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "paused"))}>
              Pause plan
            </button>
            <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "ended"))}>
              End plan
            </button>
          </>
        )}
        {plan.status === "paused" && (
          <>
            <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "active"))}>
              Resume plan
            </button>
            <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "ended"))}>
              End plan
            </button>
          </>
        )}
        {plan.status === "ended" && (
          <button className="btn btn-sm" disabled={pending} onClick={() => act(() => setPlanStatus(plan.id, "active"))}>
            Reactivate
          </button>
        )}
      </div>
      {plan.status !== "ended" && (
        <p className="mt-1.5 text-[12px] text-faint">Pausing or ending cancels this plan&apos;s future generated visits.</p>
      )}

      {/* Visits */}
      <section className="mt-6">
        <h2 className="label mb-1.5">Upcoming — {upcoming.length}</h2>
        <div className="card divide-y divide-line">
          {upcoming.length === 0 && (
            <p className="px-4 py-3 text-sm text-faint">
              {plan.status === "active" ? "Nothing scheduled — hit “Schedule visits.”" : "Plan is not active."}
            </p>
          )}
          {upcoming.map((j) => (
            <VisitRow key={j.id} j={j} onOpen={() => setJob(j)} />
          ))}
        </div>
      </section>
      <section className="mt-5">
        <h2 className="label mb-1.5">History — {completed.length} completed</h2>
        <div className="card divide-y divide-line">
          {appointments.filter((a) => !(a.status === "scheduled" && a.date >= today)).length === 0 && (
            <p className="px-4 py-3 text-sm text-faint">No visits yet.</p>
          )}
          {appointments
            .filter((a) => !(a.status === "scheduled" && a.date >= today))
            .map((j) => (
              <VisitRow key={j.id} j={j} onOpen={() => setJob(j)} />
            ))}
        </div>
      </section>

      {job && <JobSheet job={job} onClose={() => setJob(null)} catalog={catalog} />}
      {editOpen && <PlanFormSheet open onClose={() => setEditOpen(false)} catalog={catalog} plan={plan} />}
    </div>
  );
}

function Econ({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-card px-3.5 py-3">
      <p className="label">{label}</p>
      <p className="mt-1 text-lg font-semibold num leading-none">{value}</p>
    </div>
  );
}

function VisitRow({ j, onOpen }: { j: JobWithCustomer; onOpen: () => void }) {
  return (
    <button className="w-full text-left px-4 py-2.5 hover:bg-[#f8fafd] flex items-center gap-3" onClick={onOpen}>
      <p className="text-sm font-medium num grow">
        {fmtDateShort(j.date)} at {minToLabel(j.start_min)}
      </p>
      <span className="text-sm num shrink-0">{money(Number(j.price))}</span>
      <StatusChip status={j.status} />
    </button>
  );
}
