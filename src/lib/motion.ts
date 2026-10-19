// Motion tokens — the only springs/easings components should use (CSS twins live
// in globals.css as --ease-*). Productivity-tool rules: fast, no overshoot, and
// nothing animates on keyboard-driven or 100×-a-day interactions. See DESIGN.md.

/** Default UI spring: sheets, panels, popovers. */
export const spring = { type: "spring", duration: 0.34, bounce: 0 } as const;
/** Small things that track the pointer: tab underlines, segmented pills, nav highlight. */
export const springSnappy = { type: "spring", duration: 0.26, bounce: 0 } as const;

export const easeOut = "cubic-bezier(0.22, 1, 0.36, 1)";
export const easeIn = "cubic-bezier(0.55, 0, 1, 0.45)";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Exit animation for things React unmounts outright (`{open && <Sheet/>}`): clone
 * the node into <body> right before it's removed, animate the clone away, drop it.
 * Lets every close path — save, Esc, scrim tap, drag — animate without callers
 * wrapping anything in AnimatePresence.
 * ponytail: the clone is a static snapshot; fine for a ~200ms exit.
 */
export function ghostExit(el: HTMLElement | null, keyframes: Keyframe[], ms = 200): HTMLElement | null {
  if (!el || !el.isConnected || prefersReducedMotion()) return null;
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("role");
  ghost.style.pointerEvents = "none";
  document.body.appendChild(ghost);
  // keep inner scroll positions so content doesn't jump to the top mid-exit
  const src = el.querySelectorAll<HTMLElement>("[data-scroll]");
  ghost.querySelectorAll<HTMLElement>("[data-scroll]").forEach((n, i) => (n.scrollTop = src[i]?.scrollTop ?? 0));
  const anim = ghost.animate(keyframes, { duration: ms, easing: easeIn, fill: "forwards" });
  anim.finished.then(
    () => ghost.remove(),
    () => ghost.remove()
  );
  return ghost;
}
