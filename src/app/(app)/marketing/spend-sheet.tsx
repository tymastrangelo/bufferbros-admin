"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Busy, ErrorNote, Field, Sheet } from "@/components/ui";
import { logAdSpend } from "@/lib/actions/marketing";
import { todayYmd } from "@/lib/time";
import type { MarketingCampaign } from "@/lib/types";

/** Ad spend is a marketing expense tagged with its campaign — it lands in Money too. */
export function SpendSheet({
  campaigns,
  campaignId,
  onClose,
}: {
  campaigns: MarketingCampaign[];
  campaignId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [campaign, setCampaign] = useState(campaignId ?? campaigns.find((c) => c.status === "active" && Number(c.monthly_budget) > 0)?.id ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayYmd());
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const name = campaigns.find((c) => c.id === campaign)?.name;

  return (
    <Sheet open onClose={onClose} title="Log ad spend">
      <div className="flex flex-col gap-4">
        <Field label="Campaign" hint="Spend without a campaign shows as “Not tagged” and can't be judged.">
          <select className="select" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">No campaign</option>
            {campaigns
              .filter((c) => c.status !== "ended" || c.id === campaign)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" inputMode="decimal" min={0} className="input num pl-7" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
          </Field>
          <Field label="Date">
            <input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Memo" hint="Optional, e.g. “Google Ads, week of Nov 3”">
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={name ?? "What it paid for"} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending || !amount}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await logAdSpend({ occurredOn: date, amount: Number(amount), memo: memo.trim() || name || "Ad spend", campaignId: campaign || null });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? <Busy>Saving…</Busy> : "Log spend"}
        </button>
      </div>
    </Sheet>
  );
}
