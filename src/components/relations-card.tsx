"use client";

// "Relations" section on the customer profile: outreach status + snooze date,
// Google-review state, referral chain (who sent them / who they sent), and the
// touch history from outreach_log.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { giveReferralCredit, logOutreach, setOutreachStatus, setReferredBy } from "@/lib/actions/relations";
import { money } from "@/lib/format";
import { fmtDateShort, todayYmd } from "@/lib/time";
import {
  OUTREACH_OUTCOMES,
  OUTREACH_STATUSES,
  type Customer,
  type OutreachLog,
  type OutreachStatus,
} from "@/lib/types";
import { CustomerPicker } from "./customer-picker";
import { OutreachSheet } from "./outreach-sheet";
import { ErrorNote } from "./ui";

const outcomeLabel = (id: string) => OUTREACH_OUTCOMES.find((o) => o.id === id)?.label ?? id;

export function RelationsCard({
  customer,
  referrerName,
  referrals,
  log,
  referralCredit,
}: {
  customer: Customer;
  referrerName: string | null;
  referrals: { id: string; name: string }[];
  log: OutreachLog[];
  referralCredit: number;
}) {
  const router = useRouter();
  const [logOpen, setLogOpen] = useState(false);
  const [resumeDraft, setResumeDraft] = useState(customer.resume_on ?? "");
  const [pickingReferrer, setPickingReferrer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Failed.");
    router.refresh();
  }

  const showResume = customer.outreach_status !== "do_not_contact";

  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="label">Relations</h2>
        <button className="text-[13px] text-brand-deep font-medium" onClick={() => setLogOpen(true)}>
          + Log outreach
        </button>
      </div>
      <div className="card divide-y divide-line text-sm">
        {/* Status + snooze */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="label w-20 shrink-0">Status</span>
          <select
            className="select h-8! w-auto text-sm"
            value={customer.outreach_status}
            disabled={busy}
            onChange={(e) => act(() => setOutreachStatus(customer.id, e.target.value as OutreachStatus, resumeDraft || null))}
          >
            {OUTREACH_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {showResume && (
            <label className="flex items-center gap-1.5 text-xs text-faint">
              reach out again
              <input
                type="date"
                className="input num h-8! w-auto text-sm"
                value={resumeDraft}
                min={todayYmd()}
                disabled={busy}
                onChange={(e) => {
                  setResumeDraft(e.target.value);
                  act(() => setOutreachStatus(customer.id, customer.outreach_status, e.target.value || null));
                }}
              />
            </label>
          )}
          {customer.last_contacted_on && (
            <span className="text-xs text-faint num ml-auto">last touch {fmtDateShort(customer.last_contacted_on)}</span>
          )}
        </div>

        {/* Google review */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="label w-20 shrink-0">Review</span>
          {customer.review_left_on ? (
            <span className="chip bg-ok-wash text-ok">⭐ left {fmtDateShort(customer.review_left_on)}</span>
          ) : (
            <>
              <span className="text-faint text-xs">
                {customer.review_asked_on ? `asked ${fmtDateShort(customer.review_asked_on)} — no review yet` : "never asked"}
              </span>
              <span className="ml-auto flex gap-1.5">
                <QuickLog customerId={customer.id} outcome="asked_review" label="Mark asked" onDone={() => router.refresh()} />
                <QuickLog customerId={customer.id} outcome="left_review" label="Left ⭐" onDone={() => router.refresh()} />
              </span>
            </>
          )}
        </div>

        {/* Referral chain */}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="label w-20 shrink-0">Referral</span>
          {customer.referred_by && referrerName ? (
            <>
              <span className="text-sm">
                referred by{" "}
                <Link href={`/customers/${customer.referred_by}`} className="text-brand-deep hover:underline underline-offset-2">
                  {referrerName}
                </Link>
              </span>
              {customer.referral_credited_at ? (
                <span className="chip bg-ok-wash text-ok">both credited {money(referralCredit)}</span>
              ) : (
                <span className="ml-auto flex gap-1.5">
                  <button className="btn btn-sm" disabled={busy} onClick={() => act(() => giveReferralCredit(customer.id))}>
                    Credit both {money(referralCredit)}
                  </button>
                  <button className="btn btn-ghost btn-sm text-faint" disabled={busy} onClick={() => act(() => setReferredBy(customer.id, null))}>
                    ✕
                  </button>
                </span>
              )}
            </>
          ) : pickingReferrer ? (
            <div className="grow max-w-xs">
              <CustomerPicker
                value={null}
                autoFocus
                onChange={(c) => {
                  if (!c) return;
                  setPickingReferrer(false);
                  act(() => setReferredBy(customer.id, c.id));
                }}
              />
            </div>
          ) : (
            <button className="text-[13px] text-brand-deep font-medium" onClick={() => setPickingReferrer(true)}>
              + Who referred them?
            </button>
          )}
        </div>
        {referrals.length > 0 && (
          <div className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="label w-20 shrink-0">Sent us</span>
            <span className="text-sm">
              {referrals.map((r, i) => (
                <span key={r.id}>
                  {i > 0 && ", "}
                  <Link href={`/customers/${r.id}`} className="text-brand-deep hover:underline underline-offset-2">
                    {r.name}
                  </Link>
                </span>
              ))}
            </span>
          </div>
        )}

        {/* Touch history */}
        {log.length > 0 && (
          <div className="px-4 py-2.5">
            <p className="label mb-1.5">History</p>
            <div className="flex flex-col gap-1">
              {log.map((l) => (
                <p key={l.id} className="text-xs text-ink-2">
                  <span className="num text-faint">{fmtDateShort(l.occurred_on)}</span> · {outcomeLabel(l.outcome)}
                  {l.note && <span className="text-faint"> — {l.note}</span>}
                </p>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="px-4 py-2">
            <ErrorNote>{error}</ErrorNote>
          </div>
        )}
      </div>
      {logOpen && <OutreachSheet customerId={customer.id} customerName={customer.name} onClose={() => setLogOpen(false)} />}
    </section>
  );
}

function QuickLog({
  customerId,
  outcome,
  label,
  onDone,
}: {
  customerId: string;
  outcome: "asked_review" | "left_review";
  label: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await logOutreach({ customerId, outcome });
        setBusy(false);
        onDone();
      }}
    >
      {label}
    </button>
  );
}
