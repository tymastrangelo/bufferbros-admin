"use client";

// Log one outreach touch ("called Katy — back in October"). Picking an outcome
// also moves the customer's status/snooze so the Today queue updates itself.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { logOutreach } from "@/lib/actions/relations";
import { todayYmd } from "@/lib/time";
import { OUTREACH_OUTCOMES, type OutreachOutcome } from "@/lib/types";
import { ErrorNote, Field, Sheet } from "./ui";

const NEEDS_RESUME: OutreachOutcome[] = ["follow_up", "seasonal", "declined"];
const RESUME_HINT: Record<string, string> = {
  follow_up: "They'll pop back on Today that morning.",
  seasonal: "Usually when they're back — leave blank to set later.",
  declined: "Optional — a date to quietly check back in.",
};

export function OutreachSheet({
  customerId,
  customerName,
  defaultOutcome = "no_answer",
  onClose,
}: {
  customerId: string;
  customerName: string;
  defaultOutcome?: OutreachOutcome;
  onClose: () => void;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<OutreachOutcome>(defaultOutcome);
  const [occurredOn, setOccurredOn] = useState(todayYmd());
  const [resumeOn, setResumeOn] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Sheet open onClose={onClose} title={`Log outreach — ${customerName}`}>
      <div className="flex flex-col gap-4">
        <Field label="How did it go?">
          <div className="grid grid-cols-2 gap-1.5">
            {OUTREACH_OUTCOMES.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setOutcome(o.id)}
                className={`btn btn-sm justify-start ${outcome === o.id ? "border-brand bg-brand-wash text-brand-deep" : ""}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="When">
            <input type="date" className="input num" value={occurredOn} max={todayYmd()} onChange={(e) => setOccurredOn(e.target.value)} />
          </Field>
          {NEEDS_RESUME.includes(outcome) && (
            <Field label="Reach out again on" hint={RESUME_HINT[outcome]}>
              <input type="date" className="input num" value={resumeOn} min={todayYmd()} onChange={(e) => setResumeOn(e.target.value)} />
            </Field>
          )}
        </div>
        <Field label="Note (optional)">
          <textarea
            className="textarea"
            rows={2}
            placeholder="Says the truck needs it bad, wants a Saturday…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <button
          className="btn btn-primary h-11"
          disabled={pending}
          onClick={async () => {
            setError(null);
            setPending(true);
            const res = await logOutreach({ customerId, outcome, occurredOn, note, resumeOn: resumeOn || null });
            setPending(false);
            if (!res.ok) return setError(res.error);
            onClose();
            router.refresh();
          }}
        >
          {pending ? "Saving…" : "Save touch"}
        </button>
      </div>
    </Sheet>
  );
}
