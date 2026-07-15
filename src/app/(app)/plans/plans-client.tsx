"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconPlus } from "@/components/icons";
import { PlanFormSheet } from "@/components/plan-form";
import { ScheduleSheet } from "@/components/schedule-sheet";
import type { PickedCustomer } from "@/components/customer-picker";
import { EmptyState, StatusChip } from "@/components/ui";
import type { Catalog } from "@/lib/catalog";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import type { Plan } from "@/lib/types";

export type PlanRow = Plan & { customers: { id: string; name: string } | null; nextVisit: string | null };

const cadenceLabel = (p: Plan) =>
  p.cadence === "custom" ? `every ${p.interval_days ?? "?"} days` : p.cadence;

export function PlansClient({
  rows,
  catalog,
  openNew,
  defaultCustomer,
}: {
  rows: PlanRow[];
  catalog: Catalog;
  openNew: boolean;
  defaultCustomer: PickedCustomer | null;
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(openNew);
  const [prevOpenNew, setPrevOpenNew] = useState(openNew);
  if (prevOpenNew !== openNew) {
    setPrevOpenNew(openNew);
    if (openNew) setNewOpen(true);
  }
  const closeNew = () => {
    setNewOpen(false);
    window.history.replaceState(null, "", "/plans");
  };
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const active = rows.filter((r) => r.status === "active");
  const rest = rows.filter((r) => r.status !== "active");

  return (
    <div className="px-4 md:px-8 py-5 md:py-7 max-w-5xl">
      <header className="flex items-center gap-2 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold mr-auto">Plans</h1>
        <button className="btn btn-sm" onClick={() => setScheduleOpen(true)} disabled={active.length === 0}>
          Schedule visits…
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
          <IconPlus width={13} height={13} /> New plan
        </button>
      </header>
      {genMsg && <p className="mt-2 text-sm text-ink-2">{genMsg} — conflicts show on each plan&apos;s page.</p>}

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState
            title="No recurring plans yet."
            hint="Plans are the backbone — weekly, biweekly, monthly, or custom cadence. Visits get scheduled 8 weeks ahead automatically."
            action={
              <button className="btn btn-primary" onClick={() => setNewOpen(true)}>
                Create the first plan
              </button>
            }
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="tbl tbl-link tbl-stack min-w-[560px]">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Cadence</th>
                  <th className="text-right">Per visit</th>
                  <th>Next visit</th>
                  <th>Billing</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...active, ...rest].map((p) => (
                  <tr key={p.id} onClick={() => router.push(`/plans/${p.id}`)}>
                    <td data-label="Customer" className="font-medium whitespace-nowrap">{p.customers?.name ?? "—"}</td>
                    <td data-label="Cadence" className="capitalize whitespace-nowrap">{cadenceLabel(p)}</td>
                    <td data-label="Per visit" className="num text-right">{money(p.per_visit_price)}</td>
                    <td data-label="Next visit" className="num whitespace-nowrap">
                      {p.status === "active" ? (
                        p.nextVisit ? (
                          fmtDateShort(p.nextVisit)
                        ) : (
                          <span className="text-warn font-medium">none scheduled</span>
                        )
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Billing" className="text-ink-2 max-w-[200px] truncate">{p.billing_note}</td>
                    <td data-label="Status">
                      <StatusChip status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {newOpen && <PlanFormSheet open onClose={closeNew} catalog={catalog} defaultCustomer={defaultCustomer} />}
      <ScheduleSheet
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        today={todayYmd()}
        scopeLabel={`all ${active.length} active plan${active.length === 1 ? "" : "s"}`}
        onDone={(result) => {
          setGenMsg(
            `Scheduled ${result.created} visit${result.created === 1 ? "" : "s"}` +
              (result.conflicts.length ? ` · ${result.conflicts.length} need manual placement` : "")
          );
          router.refresh();
        }}
      />
    </div>
  );
}
