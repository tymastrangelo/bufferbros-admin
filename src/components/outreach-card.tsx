"use client";

// Owner-only "Reach out" section on Today: clients gone quiet past the outreach
// window, seasonal/snoozed clients whose date arrived, and fresh details worth a
// Google-review ask. Logging a touch (or a one-tap review action) clears the row.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logOutreach } from "@/lib/actions/relations";
import { telHref } from "@/lib/format";
import { fmtDateShort } from "@/lib/time";
import type { OutreachDue, ReviewAsk } from "@/lib/outreach";
import { IconPhone, IconStar } from "./icons";
import { OutreachSheet } from "./outreach-sheet";
import { SectionLabel } from "./ui";

const STATUS_LABEL: Record<string, string> = {
  seasonal: "back in season",
  declined: "check back in",
  active: "follow up",
};

export function OutreachCard({ due, asks }: { due: OutreachDue[]; asks: ReviewAsk[] }) {
  const router = useRouter();
  const [logging, setLogging] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (due.length === 0 && asks.length === 0) return null;

  const shown = showAll ? due : due.slice(0, 8);

  async function quickReview(a: ReviewAsk, outcome: "asked_review" | "left_review") {
    setBusy(a.id);
    await logOutreach({ customerId: a.id, outcome });
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      {due.length > 0 && (
        <section className="mt-8">
          <SectionLabel trailing={`${due.length} client${due.length > 1 ? "s" : ""}`}>Reach out</SectionLabel>
          <div className="stagger card divide-y divide-line overflow-hidden">
            {shown.map((d) => (
              <div key={d.id} className="row">
                <div className="min-w-0 grow">
                  <p className="text-sm font-medium truncate">
                    <Link href={`/customers/${d.id}`} className="hover:underline underline-offset-2">
                      {d.name}
                    </Link>{" "}
                    <span className="text-faint font-normal">· {d.reason === "resume" ? STATUS_LABEL[d.status] ?? "follow up" : "gone quiet"}</span>
                  </p>
                  <p className="text-xs text-faint num truncate">
                    {d.reason === "overdue"
                      ? `${d.days}d since ${d.lastTouch && (!d.lastDetail || d.lastTouch > d.lastDetail) ? "last touch" : "last detail"}`
                      : `due ${d.days === 0 ? "today" : `${d.days}d ago`}`}
                    {d.lastDetail && ` · last detail ${fmtDateShort(d.lastDetail)}`}
                  </p>
                </div>
                {d.phone && (
                  <a href={telHref(d.phone)} aria-label={`Call ${d.name}`} className="btn btn-sm btn-icon shrink-0">
                    <IconPhone width={14} height={14} />
                  </a>
                )}
                <button className="btn btn-sm shrink-0" onClick={() => setLogging({ id: d.id, name: d.name })}>
                  Log
                </button>
              </div>
            ))}
            {due.length > shown.length && (
              <button className="row-more" onClick={() => setShowAll(true)}>
                Show all {due.length}
              </button>
            )}
          </div>
        </section>
      )}

      {asks.length > 0 && (
        <section className="mt-8">
          <SectionLabel trailing={asks.length}>Ask for a review</SectionLabel>
          <div className="stagger card divide-y divide-line overflow-hidden">
            {asks.map((a) => (
              <div key={a.id} className="row">
                <div className="min-w-0 grow">
                  <p className="text-sm font-medium truncate">
                    <Link href={`/customers/${a.id}`} className="hover:underline underline-offset-2">
                      {a.name}
                    </Link>
                  </p>
                  <p className="text-xs text-faint num">detailed {fmtDateShort(a.lastDetail)} — ride the glow</p>
                </div>
                <button className="btn btn-sm shrink-0" disabled={busy === a.id} onClick={() => quickReview(a, "asked_review")}>
                  Asked
                </button>
                <button className="btn btn-sm shrink-0" disabled={busy === a.id} onClick={() => quickReview(a, "left_review")}>
                  <IconStar width={14} height={14} weight="fill" className="text-warn" /> Left review
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {logging && <OutreachSheet customerId={logging.id} customerName={logging.name} onClose={() => setLogging(null)} />}
    </>
  );
}
