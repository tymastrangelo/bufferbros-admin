"use client";

// Branded splash: shows on the first full page load of a browser session (and
// every PWA launch), fades out once the app is ready. A client component so it
// behaves under ANY remount — after server actions revalidate the root layout,
// a remounted splash hides itself before paint instead of sticking forever.
import { useLayoutEffect, useState } from "react";
import { LogoFull, Wheel } from "./brand";

export function Splash() {
  const [phase, setPhase] = useState<"show" | "fade" | "gone">("show");

  useLayoutEffect(() => {
    // Synchronous setState here is deliberate: on a repeat load or a layout
    // remount the splash must vanish BEFORE the browser paints, and the flag
    // lives in sessionStorage (unreadable during SSR render, so it can't be
    // initial state without a hydration mismatch).
    try {
      if (sessionStorage.getItem("bb-splash")) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhase("gone");
        return;
      }
      sessionStorage.setItem("bb-splash", "1");
    } catch {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPhase("gone");
      return;
    }
    const fade = setTimeout(() => setPhase("fade"), 600);
    const gone = setTimeout(() => setPhase("gone"), 1050);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, []);

  if (phase === "gone") return null;
  return (
    // suppressHydrationWarning: the inline guard script below sets display:none
    // on this div before hydration on repeat loads — that's intentional, and
    // React must not warn about (or undo) it.
    <div
      id="bb-splash"
      suppressHydrationWarning
      className={`splash ${phase === "fade" ? "splash-out" : ""}`}
      aria-hidden
    >
      <LogoFull className="w-[min(72vw,380px)]" />
      <Wheel size={44} className="mt-10" />
      {/* Pre-hydration guard: on repeat full loads, hide before first paint. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "try{sessionStorage.getItem('bb-splash')&&(document.getElementById('bb-splash').style.display='none')}catch(e){}",
        }}
      />
    </div>
  );
}
