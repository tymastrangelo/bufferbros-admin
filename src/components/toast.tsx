"use client";

// One toast at a time: "Job cancelled · Undo". Confirms that an action landed and, when
// the inverse is cheap, offers it right there (HIG feedback.md › "confirm that a
// significant action completed"; undo-and-redo.md › "show the results of an undo").
// Bottom-center above the floating tab bar on phones, bottom-right on desktop.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { springSnappy } from "@/lib/motion";
import { IconCheck, IconWarning } from "./icons";
import { Busy, useMounted } from "./ui";

export type ToastInput = {
  title: string;
  detail?: string;
  tone?: "ok" | "warn" | "bad";
  /** Inverse action. Resolving ok swaps the toast to "Put back"; an error shows inline. */
  undo?: () => Promise<{ ok: boolean; error?: string }>;
  undoLabel?: string;
  /** Title shown once the undo lands. Default "Put back". */
  undoneTitle?: string;
};

type Live = ToastInput & { id: number; phase: "shown" | "undoing" | "undone" };

const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Live | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const mounted = useMounted();

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null); // drops the undo closure with it — a late tap can't run a stale inverse
  }, []);

  const arm = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(dismiss, ms);
    },
    [dismiss]
  );

  const show = useCallback(
    (t: ToastInput) => {
      setToast({ ...t, id: ++seq.current, phase: "shown" });
      arm(t.undo ? 8000 : 5000);
    },
    [arm]
  );

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  useEffect(() => {
    if (!toast) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toast, dismiss]);

  async function runUndo() {
    if (!toast?.undo || toast.phase !== "shown") return;
    if (timer.current) clearTimeout(timer.current);
    setToast({ ...toast, phase: "undoing" });
    const res = await toast.undo();
    if (res.ok) {
      setToast({ ...toast, phase: "undone", title: toast.undoneTitle ?? "Put back", detail: undefined, tone: "ok" });
      arm(1600);
    } else {
      setToast({ ...toast, phase: "shown", tone: "bad", detail: res.error ?? "Couldn't undo that.", undo: undefined });
      arm(5000);
    }
  }

  const Icon = toast?.tone === "warn" || toast?.tone === "bad" ? IconWarning : IconCheck;

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                role="status"
                aria-live="polite"
                className="toast"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={springSnappy}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0.05, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 40 || info.velocity.y > 400) dismiss();
                }}
              >
                <span className={`toast-icon ${toast.tone === "bad" ? "text-pit-bad" : toast.tone === "warn" ? "text-pit-warn" : "text-pit-ok"}`} aria-hidden>
                  <Icon width={18} height={18} weight="bold" />
                </span>
                <span className="min-w-0 grow">
                  <span className="block text-sm font-medium leading-tight truncate">{toast.title}</span>
                  {toast.detail && <span className="block text-xs opacity-80 leading-tight mt-0.5 truncate">{toast.detail}</span>}
                </span>
                {toast.undo && toast.phase !== "undone" && (
                  <button type="button" className="toast-action" onClick={runUndo} disabled={toast.phase === "undoing"}>
                    {toast.phase === "undoing" ? <Busy>Undoing…</Busy> : (toast.undoLabel ?? "Undo")}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </ToastCtx.Provider>
  );
}
