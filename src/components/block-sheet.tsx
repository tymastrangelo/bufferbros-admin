"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addBlock } from "@/lib/actions/settings";
import { ErrorNote, Field, Sheet } from "./ui";

export function BlockSheet({ open, onClose, defaultDate }: { open: boolean; onClose: () => void; defaultDate: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startT, setStartT] = useState("08:00");
  const [endT, setEndT] = useState("12:00");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) return null;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  return (
    <Sheet open onClose={onClose} title="Block time">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input type="date" className="input num" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To (optional)">
            <input type="date" className="input num" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <input type="time" step={1800} className="input num" value={startT} onChange={(e) => setStartT(e.target.value)} />
            </Field>
            <Field label="End">
              <input type="time" step={1800} className="input num" value={endT} onChange={(e) => setEndT(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Reason">
          <input className="input" placeholder="Vacation, dentist, boat day…" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await addBlock({
              dateFrom: from,
              dateTo: to || null,
              allDay,
              startMin: toMin(startT),
              endMin: toMin(endT),
              reason,
            });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Blocking…" : "Block it"}
        </button>
      </div>
    </Sheet>
  );
}
