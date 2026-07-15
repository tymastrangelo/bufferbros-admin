"use client";

// Record/edit any money event: payment, credit, discount, charge, refund.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addLedgerEntry, deleteLedgerEntry, updateLedgerEntry } from "@/lib/actions/money";
import { todayYmd } from "@/lib/time";
import { PAYMENT_METHODS, type EntryKind, type LedgerEntry, type PaymentMethod } from "@/lib/types";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";
import { ErrorNote, Field, Sheet } from "./ui";

const KIND_HELP: Record<EntryKind, string> = {
  payment: "Money received — raises their balance.",
  credit: "Prepaid credit (e.g. paid the year up front).",
  discount: "Forgive part of what's owed.",
  charge: "Manual charge — they owe more.",
  refund: "Money returned to the customer.",
};

export function LedgerEntrySheet({
  open,
  onClose,
  customerId,
  customerName,
  entry,
  defaultKind = "payment",
}: {
  open: boolean;
  onClose: () => void;
  /** fixed customer (profile page); omit to pick one (Money page) */
  customerId?: string;
  customerName?: string;
  entry?: LedgerEntry | null;
  defaultKind?: EntryKind;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedCustomer | null>(null);
  const [kind, setKind] = useState<EntryKind>(entry?.kind ?? defaultKind);
  const [amount, setAmount] = useState(entry ? String(Math.abs(Number(entry.amount))) : "");
  const [method, setMethod] = useState<PaymentMethod>(entry?.method ?? "zelle");
  const [date, setDate] = useState(entry?.occurred_on ?? todayYmd());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;
  const targetCustomer = customerId ?? entry?.customer_id ?? picked?.id;
  const needsMethod = kind === "payment" || kind === "refund";

  async function submit() {
    if (!targetCustomer) return setError("Pick a customer.");
    setError(null);
    setPending(true);
    const res = entry
      ? await updateLedgerEntry(entry.id, { kind, amount: Number(amount), method, occurredOn: date, memo })
      : await addLedgerEntry({
          customerId: targetCustomer,
          kind,
          amount: Number(amount),
          method,
          occurredOn: date,
          memo,
        });
    setPending(false);
    if (!res.ok) return setError(res.error);
    onClose();
    router.refresh();
  }

  return (
    <Sheet open onClose={onClose} title={entry ? "Edit entry" : "Record money"}>
      <div className="flex flex-col gap-4">
        {customerName ? (
          <p className="text-sm text-ink-2">
            For <span className="font-medium text-ink">{customerName}</span>
          </p>
        ) : entry ? null : (
          <Field label="Customer">
            <CustomerPicker value={picked} onChange={setPicked} autoFocus />
          </Field>
        )}

        <Field label="Type" hint={KIND_HELP[kind]}>
          <div className="grid grid-cols-3 gap-1.5">
            {(["payment", "credit", "discount", "charge", "refund"] as EntryKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`h-9 rounded-md border text-[13px] font-medium capitalize transition-colors duration-150 ${
                  kind === k ? "bg-ink border-ink text-white" : "bg-card border-line-2 hover:border-ink"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step={1}
                className="input num pl-7"
                value={amount}
                autoFocus={!!customerId}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </Field>
          <Field label="Date">
            <input type="date" className="input num" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

        {needsMethod && (
          <Field label="Method">
            <div className="grid grid-cols-3 gap-1.5">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`h-9 rounded-md border text-[13px] font-medium capitalize transition-colors duration-150 ${
                    method === m ? "bg-brand border-brand text-white" : "bg-card border-line-2 hover:border-brand"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="Memo">
          <input
            className="input"
            placeholder={kind === "credit" ? "Prepaid through December" : "Covers 4 visits, includes tip…"}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </Field>

        <ErrorNote>{error}</ErrorNote>
        <button className="btn btn-primary h-11" onClick={submit} disabled={pending || !amount}>
          {pending ? "Saving…" : entry ? "Save changes" : `Record ${kind}`}
        </button>
        {entry && (
          <button
            className="btn btn-danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              await deleteLedgerEntry(entry.id);
              onClose();
              router.refresh();
            }}
          >
            Delete entry
          </button>
        )}
      </div>
    </Sheet>
  );
}
