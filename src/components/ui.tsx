"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { money } from "@/lib/format";
import { ghostExit, spring, springSnappy } from "@/lib/motion";
import { Wheel } from "./brand";
import { IconCheck, IconChevronLeft, IconSearch, IconX } from "./icons";

const noopSubscribe = () => () => {};
/** false during SSR + hydration, true after — gate for portals and browser-only reads. */
export function useMounted() {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

// ── Sheet ───────────────────────────────────────────────────────────────────
// Open sheets stack (a sheet can open another); only the top one hears Esc.
const sheetStack: number[] = [];
let sheetSeq = 0;
let scrollLocks = 0;

/** Bottom sheet on mobile (drag the grabber down to dismiss), floating side panel on desktop. */
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
  const mounted = useMounted();
  if (!open || !mounted) return null;
  return createPortal(
    <SheetPanel onClose={onClose} title={title} wide={wide}>
      {children}
    </SheetPanel>,
    document.body
  );
}

function SheetPanel({ onClose, title, children, wide }: { onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLElement[]>([]);
  const closeRef = useRef(onClose);
  const drag = useDragControls();
  const [desktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);

  useEffect(() => {
    closeRef.current = onClose;
  });

  // Layout effect on purpose: its cleanup runs while the DOM is still attached,
  // which is what lets ghostExit() snapshot the panel for the exit animation.
  useLayoutEffect(() => {
    // StrictMode's dev-only unmount/remount would leave a ghost behind — sweep it.
    ghosts.current.forEach((g) => g.remove());
    ghosts.current = [];

    const id = ++sheetSeq;
    sheetStack.push(id);
    const prevFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const scrim = scrimRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sheetStack[sheetStack.length - 1] === id) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    if (scrollLocks++ === 0) document.body.style.overflow = "hidden";

    return () => {
      sheetStack.splice(sheetStack.indexOf(id), 1);
      document.removeEventListener("keydown", onKey);
      if (--scrollLocks === 0) document.body.style.overflow = "";
      ghosts.current = [
        ghostExit(scrim, [{ opacity: 0 }], 200),
        ghostExit(
          panel,
          desktop ? [{ transform: "translateX(24px)", opacity: 0 }] : [{ transform: "translateY(100%)" }],
          desktop ? 170 : 240
        ),
      ].filter((g): g is HTMLElement => !!g);
      if (prevFocus?.isConnected && prevFocus !== document.body) prevFocus.focus({ preventScroll: true });
    };
  }, [desktop]);

  return (
    <>
      <motion.div
        ref={scrimRef}
        className="scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        onClick={() => closeRef.current()}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`sheet outline-none ${wide ? "md:w-[580px]" : ""}`}
        initial={desktop ? { x: 28, opacity: 0 } : { y: "100%" }}
        animate={desktop ? { x: 0, opacity: 1 } : { y: 0 }}
        transition={desktop ? spring : { ...spring, duration: 0.4 }}
        drag={desktop ? false : "y"}
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.9 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 90 || info.velocity.y > 500) closeRef.current();
        }}
      >
        {/* Header doubles as the drag handle on phones */}
        <div className="shrink-0 touch-none md:touch-auto" onPointerDown={(e) => !desktop && drag.start(e)}>
          <div className="md:hidden mx-auto mt-2 h-1 w-9 rounded-full bg-line-2" aria-hidden />
          <div className="flex items-center justify-between gap-3 px-4 md:px-5 pt-2.5 pb-3 md:pt-4 border-b border-line">
            <h2 className="h-card truncate">{title}</h2>
            <button
              className="btn btn-ghost btn-sm btn-icon -mr-1.5 text-ink-2"
              onClick={() => closeRef.current()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label="Close"
            >
              <IconX width={16} height={16} />
            </button>
          </div>
        </div>
        <div data-scroll className="overflow-y-auto overflow-x-hidden overscroll-contain px-4 md:px-5 py-4 grow">
          {children}
        </div>
      </motion.div>
    </>
  );
}

// ── Page scaffolding ────────────────────────────────────────────────────────

/** Every screen's title block. Actions wrap under the title on narrow screens. */
export function PageHeader({
  title,
  sub,
  actions,
  back,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-5">
      {back && (
        <Link
          href={back.href}
          className="group inline-flex items-center gap-0.5 -ml-1 mb-2 text-dense font-medium text-faint hover:text-ink transition-colors"
        >
          <IconChevronLeft width={15} height={15} className="transition-transform duration-150 group-hover:-translate-x-0.5" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="h-page">{title}</h1>
          {sub && <div className="mt-1 text-sm text-ink-2">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Section heading: small caps label with optional trailing content (count, link). */
export function SectionLabel({ children, trailing, className = "" }: { children: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 mb-2 ${className}`}>
      <h2 className="label">{children}</h2>
      {trailing && <div className="text-xs text-faint">{trailing}</div>}
    </div>
  );
}

/** Initial-in-a-circle for people rows. */
export function Avatar({ name, size = 32, className = "" }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-wash text-brand-deep font-semibold ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials || "?"}
    </span>
  );
}

/** Text input with a leading search glyph. */
export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <IconSearch width={16} height={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input type="search" {...props} className={`input pl-9 ${props.className ?? ""}`} />
    </div>
  );
}

/** One KPI tile — lives inside a `.stat-grid`. */
export function Stat({
  label,
  value,
  hint,
  tone,
  href,
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "bad" | "ok" | "warn";
  href?: string;
  className?: string;
}) {
  const toneCls = tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "";
  const body = (
    <>
      <p className="label truncate">{label}</p>
      <p className={`mt-1.5 text-xl font-semibold num leading-none tracking-tight ${toneCls}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-faint truncate">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

// ── Tabs & segmented controls ───────────────────────────────────────────────

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Route tabs render as links; omit for in-page tabs. */
  href?: string;
}

/** Underline tabs; the indicator slides between tabs. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange?: (v: T) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="tablist" className={`flex border-b border-line overflow-x-auto touch-pan-x [scrollbar-width:none] ${className}`}>
      {tabs.map((t) => {
        const active = t.value === value;
        const cls = `relative shrink-0 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 ${
          active ? "text-ink" : "text-faint hover:text-ink-2"
        }`;
        const inner = (
          <>
            {t.label}
            {active && (
              <motion.span
                layoutId={`${id}-tab`}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-brand"
                transition={springSnappy}
              />
            )}
          </>
        );
        return t.href ? (
          <Link key={t.value} href={t.href} role="tab" aria-selected={active} className={cls}>
            {inner}
          </Link>
        ) : (
          <button key={t.value} type="button" role="tab" aria-selected={active} className={cls} onClick={() => onChange?.(t.value)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
}

/** iOS-style segmented control; the selected pill glides. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = "",
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex p-0.5 rounded-md bg-muted border border-line ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.title}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative grow flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-sm text-dense font-medium transition-colors duration-150 ${
              active ? "text-ink" : "text-faint hover:text-ink-2"
            }`}
          >
            {active && (
              <motion.span
                layoutId={`${id}-seg`}
                className="absolute inset-0 rounded-sm bg-card border border-line shadow-[var(--shadow-card)]"
                transition={springSnappy}
              />
            )}
            <span className="relative flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Forms ───────────────────────────────────────────────────────────────────

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    // ponytail: stays a <label> so plain inputs keep their accessible name. Safari forwards
    // clicks from nested buttons to the label's first control — which re-fires a picker's own
    // buttons (tap a customer → the Clear button it just rendered eats the pick). Cancel the
    // forward when the tap came from a button; bare inputs/checkboxes are untouched.
    <label className="block" onClick={(e) => (e.target as HTMLElement).closest("button") && e.preventDefault()}>
      <span className="label block mb-1.5">{label}</span>
      {children}
      {hint && <span className="block mt-1.5 text-xs text-faint">{hint}</span>}
    </label>
  );
}

export function SubmitButton({ children, className = "btn btn-primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-busy={pending}>
      {pending ? <Busy>Saving…</Busy> : children}
    </button>
  );
}

/** Copies text; the label swaps to a check for a beat so the tap visibly registered. */
export function CopyButton({ text, label = "Copy", className = "btn btn-sm" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}
      aria-live="polite"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          className={`inline-flex items-center gap-1.5 ${copied ? "text-ok" : ""}`}
          initial={{ opacity: 0, scale: 0.85, filter: "blur(2px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.85, filter: "blur(2px)" }}
          transition={{ duration: 0.16 }}
        >
          {copied ? (
            <>
              <IconCheck width={14} height={14} /> Copied
            </>
          ) : (
            label
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/**
 * Save-type button driven by the caller's state machine: idle → Busy → a check "Saved"
 * for a beat, errors inline beside it. The label swap is the CopyButton pattern.
 */
export function SuccessButton({
  state,
  onClick,
  children,
  doneLabel = "Saved",
  busyLabel = "Saving…",
  className = "btn btn-primary btn-sm",
  disabled,
}: {
  state: "idle" | "saving" | "saved" | (string & {});
  onClick: () => void;
  children: ReactNode;
  doneLabel?: string;
  busyLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const error = state !== "idle" && state !== "saving" && state !== "saved" ? state : null;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <button type="button" className={className} onClick={onClick} disabled={disabled || state === "saving"} aria-busy={state === "saving"} aria-live="polite">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state === "saved" ? "done" : state === "saving" ? "busy" : "idle"}
            className="inline-flex items-center gap-1.5"
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.16 }}
          >
            {state === "saving" ? (
              <Busy>{busyLabel}</Busy>
            ) : state === "saved" ? (
              <>
                <IconCheck width={14} height={14} weight="bold" /> {doneLabel}
              </>
            ) : (
              children
            )}
          </motion.span>
        </AnimatePresence>
      </button>
      {error && (
        <span role="alert" className="text-sm text-bad truncate">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * A list that changes while you look at it (jobs done, reminders cleared): rows rise in
 * and collapse out. Pair `LiveList` with `LiveRow` children keyed by id. First paint is
 * left to the CSS `.stagger` entrance (`initial={false}`), so nothing animates twice.
 * HIG motion.md: brief, purposeful, tied to the change — not decoration.
 */
export function LiveList({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {children}
    </AnimatePresence>
  );
}

export function LiveRow({ children, className, ref }: { children: ReactNode; className?: string; ref?: React.Ref<HTMLDivElement> }) {
  return (
    <motion.div
      ref={ref}
      layout="position"
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={spring}
    >
      {children}
    </motion.div>
  );
}

/** In-flight label for a button: the brand wheel + verb ("Saving…"). */
export function Busy({ children }: { children: ReactNode }) {
  return (
    <>
      <Wheel size={16} /> {children}
    </>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty card px-6 py-12 text-center">
      {icon && (
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-faint">{icon}</div>
      )}
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-2 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <motion.p
      role="alert"
      className="note note-bad"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSnappy}
    >
      {children}
    </motion.p>
  );
}

/**
 * Inline confirmation for an action with consequences: title, one line on what happens,
 * optional extras (a checkbox row), Cancel + a verb-labelled primary. Two buttons, no
 * "OK" (HIG alerts.md › Best practices). Destructive = red primary.
 */
export function ConfirmPanel({
  title,
  consequence,
  confirmLabel,
  busyLabel = "Working…",
  destructive,
  pending,
  onConfirm,
  onCancel,
  cancelLabel = "Cancel",
  children,
}: {
  title: string;
  consequence?: string;
  confirmLabel: string;
  busyLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="well p-4 flex flex-col gap-3" role="group" aria-label={title}>
      <div>
        <p className="h-card">{title}</p>
        {consequence && <p className="mt-1 text-sm text-ink-2">{consequence}</p>}
      </div>
      {children}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </button>
        <button type="button" className={`btn ${destructive ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={pending} aria-busy={pending}>
          {pending ? <Busy>{busyLabel}</Busy> : confirmLabel}
        </button>
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  pending: "chip-warn",
  scheduled: "chip-brand",
  completed: "chip-ok",
  cancelled: "line-through",
  no_show: "chip-warn",
  active: "chip-ok",
  paused: "chip-warn",
  ended: "",
};

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${STATUS_TONE[status] ?? ""}`}>{status.replace("_", "-")}</span>;
}

/** Green for credit, red for owed, muted zero. */
export function Balance({ amount }: { amount: number }) {
  const cls = amount > 0 ? "text-ok" : amount < 0 ? "text-bad" : "text-faint";
  const label = amount > 0 ? "credit" : amount < 0 ? "owes" : "";
  return (
    <span className={`num font-medium ${cls}`}>
      {money(Math.abs(amount))}
      {label && <span className="ml-1 text-label font-semibold uppercase tracking-wide">{label}</span>}
    </span>
  );
}
