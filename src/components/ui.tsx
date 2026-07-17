"use client";

import { useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { money } from "@/lib/format";
import { IconX } from "./icons";

/** Bottom sheet on mobile, right panel on desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet"
        style={wide ? { width: "min(560px, 100%)" } : undefined}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4 grow">{children}</div>
      </div>
    </>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ children, className = "btn btn-primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="card px-6 py-12 text-center">
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-2 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-bad bg-bad-wash border border-[#fecaca] rounded-md px-3 py-2">
      {children}
    </p>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-warn-wash text-warn",
  scheduled: "bg-brand-wash text-brand-deep",
  completed: "bg-ok-wash text-ok",
  cancelled: "bg-[#f1f4f9] text-faint line-through",
  no_show: "bg-warn-wash text-warn",
  active: "bg-ok-wash text-ok",
  paused: "bg-warn-wash text-warn",
  ended: "bg-[#f1f4f9] text-faint",
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${STATUS_STYLES[status] ?? "bg-[#f1f4f9] text-ink-2"}`}>{status.replace("_", "-")}</span>;
}

/** Green for credit, red for owed, muted zero. */
export function Balance({ amount }: { amount: number }) {
  const cls = amount > 0 ? "text-ok" : amount < 0 ? "text-bad" : "text-faint";
  const label = amount > 0 ? "credit" : amount < 0 ? "owes" : "";
  return (
    <span className={`num font-medium ${cls}`}>
      {money(Math.abs(amount))}
      {label && <span className="ml-1 text-[11px] font-semibold uppercase tracking-wide">{label}</span>}
    </span>
  );
}
