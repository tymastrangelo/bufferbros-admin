"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { LogoFull } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { fmtPhone } from "@/lib/format";
import type { Customer } from "@/lib/types";
import {
  IconBlock,
  IconBoat,
  IconCalendar,
  IconCaretUpDown,
  IconCheck,
  IconChevronRight,
  IconEye,
  IconDollar,
  IconLogout,
  IconMore,
  IconPlus,
  IconRepeat,
  IconSearch,
  IconSettings,
  IconSparkle,
  IconTeam,
  IconToday,
  IconUpload,
  IconUsers,
} from "./icons";
import { LiveRefresh } from "./live-refresh";
import { Avatar, Sheet } from "./ui";
import { setViewAs } from "@/lib/actions/view";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { springSnappy } from "@/lib/motion";

const NAV = [
  { href: "/", label: "Today", icon: IconToday },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/customers", label: "Customers", icon: IconUsers },
  { href: "/plans", label: "Plans", icon: IconRepeat },
  { href: "/quote", label: "Quote", icon: IconSparkle },
  { href: "/money", label: "Money", icon: IconDollar },
  { href: "/team", label: "Team", icon: IconTeam },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

// Washers see jobs and their pay — none of the business machinery.
const NAV_WASHER = [
  { href: "/", label: "Today", icon: IconToday },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/quote", label: "Quote", icon: IconSparkle },
  { href: "/my-pay", label: "My Pay", icon: IconDollar },
];

const NEW_ACTIONS = [
  { href: "/calendar?new=1", label: "New appointment", icon: IconCalendar },
  { href: "/calendar?new=boat", label: "New boat detail", icon: IconBoat },
  { href: "/plans?new=1", label: "New plan", icon: IconRepeat },
  { href: "/quote", label: "New quote", icon: IconSparkle },
  { href: "/customers?new=1", label: "New customer", icon: IconUsers },
  { href: "/money/payments?new=1", label: "Record payment", icon: IconDollar },
  { href: "/calendar?block=1", label: "Block time", icon: IconBlock },
];

const NEW_ACTIONS_WASHER = NEW_ACTIONS.filter((a) =>
  ["New appointment", "New boat detail", "New quote", "Block time"].includes(a.label)
);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export interface Me {
  name: string;
  roleLabel: string;
}
interface CrewRef {
  id: string;
  name: string;
}

export function Shell({
  children,
  role,
  me,
  crew,
  previewing,
  larp,
}: {
  children: React.ReactNode;
  role: "owner" | "washer";
  me: Me;
  /** Owner only: workers they can preview the app as. */
  crew: CrewRef[];
  /** Owner currently previewing as this worker (read-only). */
  previewing: CrewRef | null;
  /** Demo dataset on — only signalled by a tiny dot on the logo plate. */
  larp: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const owner = role === "owner";

  // Mobile keyboards only open for focus() inside the tap gesture, and CommandK's
  // input doesn't exist yet at that point. Focus a throwaway input now; the real
  // one steals focus when it mounts, so the keyboard stays up.
  const openSearchWithKeyboard = () => {
    const tmp = document.createElement("input");
    tmp.style.cssText = "position:fixed;top:0;left:0;opacity:0;height:0;font-size:16px";
    document.body.appendChild(tmp);
    tmp.focus({ preventScroll: true });
    setTimeout(() => tmp.remove(), 400);
    setSearchOpen(true);
  };

  const nav = owner ? NAV : NAV_WASHER;
  const actions = owner ? NEW_ACTIONS : NEW_ACTIONS_WASHER;
  // Mobile tab bar: Money earns a tab over Plans (Plans lives in the More sheet).
  const tabs = owner ? NAV.filter((n) => ["Today", "Calendar", "Customers", "Money"].includes(n.label)) : nav;

  // Global shortcuts: ⌘K search, N new appointment
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        router.push("/calendar?new=1");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  // Close transient menus on navigation (state adjustment during render)
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setNewOpen(false);
    setMoreOpen(false);
    setSearchOpen(false);
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh md:pl-[220px]">
        <LiveRefresh />
        {/* Desktop sidebar — the logo sits on its ink plate (the artwork is white) */}
        <aside className="hidden md:flex fixed inset-y-0 left-0 w-[220px] flex-col border-r border-line bg-card z-30">
          <Link href="/" className="block px-3 pt-3 pb-3">
            <span className="relative block bg-pit rounded-lg px-3 py-3.5 ring-1 ring-inset ring-pit-line">
              <LogoFull className="w-full" />
              {larp && <span className="absolute top-1.5 right-1.5 h-1 w-1 rounded-full bg-brand-glow/80" aria-hidden />}
            </span>
          </Link>
          <div className="px-3 pb-2 flex gap-1.5">
            <button className="btn btn-primary btn-sm grow" onClick={() => setNewOpen(true)}>
              <IconPlus width={14} height={14} /> New
            </button>
            <button
              className="btn btn-sm gap-2 text-faint"
              onClick={() => setSearchOpen(true)}
              aria-label="Search (⌘K)"
              title="Search (⌘K)"
            >
              <IconSearch width={14} height={14} />
              <kbd className="kbd">⌘K</kbd>
            </button>
          </div>
          <nav className="px-3 py-2 flex flex-col gap-0.5">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${
                    active ? "text-brand-deep" : "text-ink-2 hover:text-ink hover:bg-muted"
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-md bg-brand-wash"
                      transition={springSnappy}
                    />
                  )}
                  <Icon width={17} height={17} weight={active ? "fill" : "regular"} className="relative" />
                  <span className="relative">{label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto px-3 py-3 border-t border-line">
            <ProfileMenu me={me} crew={crew} previewing={previewing} />
          </div>
        </aside>

        {/* Page content */}
        <main className="pb-[calc(env(safe-area-inset-bottom)+150px)] md:pb-8">
          {previewing && <PreviewBar name={previewing.name} />}
          {children}
        </main>

        {/* Mobile tab bar — a floating glass capsule (iOS 26 style) with search as its own
            trailing circle; the primary "New" action floats above it, never inside it
            (HIG: tabs navigate, they don't act). */}
        <div
          className="md:hidden fixed inset-x-3 z-30 flex items-end gap-2 pointer-events-none"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 10px)" }}
        >
          <nav className="pointer-events-auto glass grow flex rounded-full border border-line shadow-[var(--shadow-pop)] p-1">
            {tabs.map(({ href, label, icon: Icon }) => (
              <TabItem key={href} href={href} label={label} active={isActive(pathname, href) && !moreOpen}>
                {(on) => <Icon width={22} height={22} weight={on ? "fill" : "regular"} />}
              </TabItem>
            ))}
            <TabItem
              label="More"
              active={moreOpen || ["/plans", "/settings", "/team", "/customers/import"].some((h) => isActive(pathname, h))}
              onClick={() => setMoreOpen(true)}
            >
              {(on) => (
                <span className="relative block">
                  <IconMore width={22} height={22} weight={on ? "fill" : "regular"} />
                  {larp && <span className="absolute -top-0.5 -right-1 h-1 w-1 rounded-full bg-brand-glow" aria-hidden />}
                </span>
              )}
            </TabItem>
          </nav>
          <div className="pointer-events-auto flex flex-col items-end gap-2.5">
            <button
              onClick={() => setNewOpen(true)}
              aria-label="New"
              className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 transition-transform duration-150 active:scale-90"
            >
              <IconPlus width={24} height={24} weight="bold" />
            </button>
            <button
              onClick={openSearchWithKeyboard}
              aria-label="Search"
              className="glass flex h-[58px] w-[58px] items-center justify-center rounded-full border border-line text-ink shadow-[var(--shadow-pop)] transition-transform duration-150 active:scale-90"
            >
              <IconSearch width={22} height={22} />
            </button>
          </div>
        </div>

        {/* More sheet (mobile) */}
        <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
          <div className="flex flex-col gap-0.5 -mx-1">
            {owner &&
              [
                { href: "/plans", label: "Plans", icon: IconRepeat },
                { href: "/quote", label: "Quote builder", icon: IconSparkle },
                { href: "/team", label: "Team", icon: IconTeam },
                { href: "/settings", label: "Settings", icon: IconSettings },
                { href: "/customers/import", label: "Import contacts", icon: IconUpload },
              ].map(({ href, label, icon: Icon }) => <MenuLink key={href} href={href} label={label} icon={Icon} />)}
            <div className="border-t border-line mt-2 pt-3 px-2 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar name={me.name} size={34} />
                <span className="grow min-w-0">
                  <span className="block text-sm font-semibold truncate">{me.name}</span>
                  <span className="block text-xs text-faint">{me.roleLabel}</span>
                </span>
                <SignOutButton className="btn btn-sm shrink-0" />
              </div>
              {crew.length > 0 && <ViewAsList crew={crew} previewing={previewing} me={me} />}
            </div>
          </div>
        </Sheet>

        {/* New action sheet */}
        <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="New">
          <div className="flex flex-col gap-0.5 -mx-1">
            {actions.map(({ href, label, icon: Icon }) => (
              <MenuLink key={href} href={href} label={label} icon={Icon} />
            ))}
          </div>
        </Sheet>

        <CommandK open={searchOpen} onClose={() => setSearchOpen(false)} pages={nav} />
      </div>
    </MotionConfig>
  );
}

/** One tab: filled glyph + label on a highlight that glides between tabs. */
function TabItem({
  href,
  label,
  active,
  onClick,
  children,
}: {
  href?: string;
  label: string;
  active: boolean;
  onClick?: () => void;
  children: (active: boolean) => React.ReactNode;
}) {
  const cls = `relative flex-1 flex flex-col items-center justify-center gap-0.5 h-[50px] rounded-full text-micro font-semibold transition-colors duration-150 ${
    active ? "text-brand-deep" : "text-ink-2"
  }`;
  const inner = (
    <>
      {active && <motion.span layoutId="tab-active" className="absolute inset-0 rounded-full bg-brand-wash" transition={springSnappy} />}
      <span className="relative">{children(active)}</span>
      <span className="relative">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} aria-current={active ? "page" : undefined} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-expanded={active} className={cls}>
      {inner}
    </button>
  );
}

function MenuLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof IconPlus }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-md px-3 py-3 text-md font-medium transition-colors hover:bg-muted active:bg-muted"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-ink-2 transition-colors group-hover:bg-card">
        <Icon width={17} height={17} />
      </span>
      {label}
      <IconChevronRight width={16} height={16} className="ml-auto text-faint transition-transform duration-150 group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Desktop footer: name + role; hover (or click) opens the "View as" switcher. */
function ProfileMenu({ me, crew, previewing }: { me: Me; crew: CrewRef[]; previewing: CrewRef | null }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };
  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && hide()}>
      <AnimatePresence>
        {open && (
          <motion.div
            className="absolute bottom-full left-0 right-0 mb-2 z-40 card p-1.5 shadow-[var(--shadow-pop)] origin-bottom-left"
            initial={{ opacity: 0, scale: 0.96, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 2 }}
            transition={springSnappy}
          >
            {crew.length > 0 && <ViewAsList crew={crew} previewing={previewing} me={me} />}
            <div className={crew.length > 0 ? "mt-1.5 pt-1.5 border-t border-line" : ""}>
              <SignOutButton className="w-full flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm text-ink-2 transition-colors hover:bg-muted hover:text-ink" withLabel />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="w-full flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <Avatar name={previewing?.name ?? me.name} size={30} />
        <span className="grow min-w-0">
          <span className="block text-sm font-semibold truncate">{previewing?.name ?? me.name}</span>
          <span className="block text-xs text-faint truncate">{previewing ? "Viewing as crew" : me.roleLabel}</span>
        </span>
        <IconCaretUpDown width={14} height={14} className="text-faint shrink-0" />
      </button>
    </div>
  );
}

/** Owner's switcher: render the app as any worker (read-only), or back to yourself. */
function ViewAsList({ crew, previewing, me }: { crew: CrewRef[]; previewing: CrewRef | null; me: Me }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const choose = (id: string | null) =>
    startTransition(async () => {
      await setViewAs(id);
      router.push("/");
      router.refresh();
    });
  const items = [{ id: null as string | null, name: me.name, sub: me.roleLabel }, ...crew.map((c) => ({ id: c.id as string | null, name: c.name, sub: "Crew" }))];
  return (
    <div role="menu" aria-label="View dashboard as" aria-busy={pending}>
      <p className="label px-2.5 pt-1 pb-1.5">View as</p>
      {items.map((it) => {
        const on = (previewing?.id ?? null) === it.id;
        return (
          <button
            key={it.id ?? "me"}
            role="menuitemradio"
            aria-checked={on}
            disabled={pending}
            onClick={() => !on && choose(it.id)}
            className={`w-full flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm transition-colors ${on ? "bg-brand-wash text-brand-deep" : "hover:bg-muted"}`}
          >
            <Avatar name={it.name} size={24} />
            <span className="grow min-w-0 truncate font-medium">{it.name}</span>
            <span className="text-xs text-faint">{it.sub}</span>
            {on && <IconCheck width={14} height={14} weight="bold" />}
          </button>
        );
      })}
    </div>
  );
}

/** Shown while the owner previews a worker's view. */
function PreviewBar({ name }: { name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b border-brand-line bg-brand-wash/95 backdrop-blur px-4 md:px-8 py-2 flex items-center gap-3 text-dense text-brand-deep">
      <IconEye width={16} height={16} className="shrink-0" />
      <span className="grow min-w-0 truncate">
        Viewing as <span className="font-semibold">{name}</span> — read-only preview
      </span>
      <button
        className="btn btn-sm shrink-0"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setViewAs(null);
            router.refresh();
          })
        }
      >
        Back to me
      </button>
    </div>
  );
}

function SignOutButton({ className, icon, withLabel }: { className?: string; icon?: boolean; withLabel?: boolean }) {
  const supabase = createClient();
  return (
    <button
      className={className}
      aria-label="Sign out"
      title="Sign out"
      onClick={async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
      }}
    >
      {icon ? (
        <IconLogout width={15} height={15} />
      ) : withLabel ? (
        <>
          <IconLogout width={15} height={15} /> Sign out
        </>
      ) : (
        "Sign out"
      )}
    </button>
  );
}

function CommandK({ open, onClose, pages: navPages }: { open: boolean; onClose: () => void; pages: typeof NAV }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const supabase = createClient();

  // Reset on open (state adjustment during render); focus is a real effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setQ("");
      setResults([]);
      setSel(0);
    }
  }
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(async () => {
      const term = q.trim().replace(/[%,()]/g, "");
      const { data } = await supabase
        .from("customers")
        .select("*")
        .or(`name.ilike.%${term}%,phone.ilike.%${term.replace(/\D/g, "") || term}%,email.ilike.%${term}%`)
        .eq("archived", false)
        .limit(8);
      setResults((data as Customer[]) ?? []);
      setSel(0);
    }, 150);
    return () => clearTimeout(t);
  }, [q, supabase]);

  const shownResults = useMemo(() => (q.trim() ? results : []), [q, results]);
  const pages = navPages.filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase()) && q.trim());
  const total = shownResults.length + pages.length;

  const go = useCallback(
    (i: number) => {
      if (i < shownResults.length) router.push(`/customers/${shownResults[i].id}`);
      else if (pages[i - shownResults.length]) router.push(pages[i - shownResults.length].href);
      onClose();
    },
    [shownResults, pages, router, onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, total - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
      }
      if (e.key === "Enter" && total > 0) {
        e.preventDefault();
        go(sel);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, total, sel, go, onClose]);

  if (!open) return null;
  return (
    <>
      <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="fixed z-50 inset-x-3 top-[10dvh] md:inset-x-0 md:mx-auto md:w-[560px] card overflow-hidden shadow-[var(--shadow-pop)] origin-top"
        initial={{ opacity: 0, scale: 0.97, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ ...springSnappy, duration: 0.2 }}
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-line">
          <IconSearch width={16} height={16} className="text-faint shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers, pages…"
            className="w-full h-13 text-base md:text-md outline-none placeholder:text-faint bg-transparent"
          />
          <kbd className="kbd hidden md:block">esc</kbd>
        </div>
        <div className="max-h-[50dvh] overflow-y-auto p-1.5">
          {total === 0 && (
            <p className="px-4 py-8 text-sm text-faint text-center">
              {q.trim() ? "No matches." : "Type a name, phone number, or email."}
            </p>
          )}
          {shownResults.length > 0 && <p className="label px-2.5 pt-1.5 pb-1">Customers</p>}
          {shownResults.map((c, i) => (
            <button
              key={c.id}
              onClick={() => go(i)}
              onMouseMove={() => setSel(i)}
              className={`w-full text-left px-2.5 py-2.5 rounded-md flex items-center justify-between gap-3 ${sel === i ? "bg-muted" : ""}`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-wash text-label font-semibold text-brand-deep">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="font-medium text-sm truncate">{c.name}</span>
              </span>
              <span className="text-xs text-faint num shrink-0">{fmtPhone(c.phone) || c.email}</span>
            </button>
          ))}
          {pages.length > 0 && <p className="label px-2.5 pt-2 pb-1">Pages</p>}
          {pages.map((p, j) => {
            const i = shownResults.length + j;
            return (
              <button
                key={p.href}
                onClick={() => go(i)}
                onMouseMove={() => setSel(i)}
                className={`w-full text-left px-2.5 py-2.5 rounded-md flex items-center gap-2.5 text-sm ${sel === i ? "bg-muted" : ""}`}
              >
                <p.icon width={15} height={15} className="text-faint" />
                Go to {p.label}
              </button>
            );
          })}
        </div>
      </motion.div>
    </>
  );
}
