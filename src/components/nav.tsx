"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LogoFull } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { fmtPhone } from "@/lib/format";
import type { Customer } from "@/lib/types";
import {
  IconBlock,
  IconCalendar,
  IconDollar,
  IconMore,
  IconPlus,
  IconRepeat,
  IconSearch,
  IconSettings,
  IconToday,
  IconUpload,
  IconUsers,
} from "./icons";
import { Sheet } from "./ui";

const NAV = [
  { href: "/", label: "Today", icon: IconToday },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/customers", label: "Customers", icon: IconUsers },
  { href: "/plans", label: "Plans", icon: IconRepeat },
  { href: "/money", label: "Money", icon: IconDollar },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

// Washers see jobs and their pay — none of the business machinery.
const NAV_WASHER = [
  { href: "/", label: "Today", icon: IconToday },
  { href: "/calendar", label: "Calendar", icon: IconCalendar },
  { href: "/my-pay", label: "My Pay", icon: IconDollar },
];

const NEW_ACTIONS = [
  { href: "/calendar?new=1", label: "New appointment", icon: IconCalendar },
  { href: "/customers?new=1", label: "New customer", icon: IconUsers },
  { href: "/money/payments?new=1", label: "Record payment", icon: IconDollar },
  { href: "/calendar?block=1", label: "Block time", icon: IconBlock },
];

const NEW_ACTIONS_WASHER = NEW_ACTIONS.filter((a) => a.label === "New appointment" || a.label === "Block time");

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Shell({
  children,
  userEmail,
  role,
}: {
  children: React.ReactNode;
  userEmail: string;
  role: "owner" | "washer";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const owner = role === "owner";
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
    <div className="min-h-dvh md:pl-[208px]">
      {/* Desktop sidebar — light, with the logo on its ink plate (the artwork is white) */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[208px] flex-col border-r border-line bg-card z-30">
        <Link href="/" className="block px-3 pt-3 pb-3">
          <span className="block bg-pit rounded-lg px-3 py-3.5">
            <LogoFull className="w-full" />
          </span>
        </Link>
        <div className="px-3 pb-2 flex gap-1.5">
          <button className="btn btn-primary btn-sm grow" onClick={() => setNewOpen(true)}>
            <IconPlus width={14} height={14} /> New
          </button>
          <button className="btn btn-sm" onClick={() => setSearchOpen(true)} aria-label="Search (⌘K)" title="Search (⌘K)">
            <IconSearch width={14} height={14} />
          </button>
        </div>
        <nav className="px-3 py-2 flex flex-col gap-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 ${
                  active ? "bg-brand-wash text-brand-deep" : "text-ink-2 hover:bg-[#f1f4f9] hover:text-ink"
                }`}
              >
                {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-brand" />}
                <Icon width={16} height={16} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-4 py-4 border-t border-line">
          <p className="label mb-1">Signed in</p>
          <p className="text-xs text-ink-2 truncate" title={userEmail}>
            {userEmail}
          </p>
          <SignOutButton className="mt-1.5 text-xs text-ink-2 hover:text-ink underline underline-offset-2" />
        </div>
      </aside>

      {/* Page content */}
      <main className="pb-24 md:pb-8">{children}</main>

      {/* Mobile bottom tab bar */}
      <nav
        className={`tabbar md:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-line grid ${
          owner ? "grid-cols-5" : "grid-cols-4"
        }`}
      >
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href) && !moreOpen;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-semibold transition-colors duration-150 ${
                active ? "text-brand" : "text-faint"
              }`}
            >
              <Icon width={20} height={20} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[10px] font-semibold transition-colors duration-150 ${
            moreOpen || isActive(pathname, "/plans") || isActive(pathname, "/settings") ? "text-brand" : "text-faint"
          }`}
        >
          <IconMore width={20} height={20} />
          More
        </button>
      </nav>

      {/* Mobile floating Search + New buttons (thumb zone, above tab bar) */}
      <button
        onClick={() => setSearchOpen(true)}
        aria-label="Search"
        className="md:hidden fixed z-30 rounded-full bg-card border border-line text-ink-2 shadow-lg flex items-center justify-center active:scale-95 transition-transform duration-150"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 136px)", right: 20, width: 44, height: 44 }}
      >
        <IconSearch width={18} height={18} />
      </button>
      <button
        onClick={() => setNewOpen(true)}
        aria-label="New"
        className="md:hidden fixed right-4 z-30 w-13 h-13 rounded-full bg-brand text-white shadow-lg shadow-brand/30 flex items-center justify-center active:scale-95 transition-transform duration-150"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 72px)", width: 52, height: 52 }}
      >
        <IconPlus width={22} height={22} />
      </button>

      {/* More sheet (mobile) */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col gap-1 -mx-1">
          {owner &&
            [
              { href: "/plans", label: "Plans", icon: IconRepeat },
              { href: "/settings", label: "Settings", icon: IconSettings },
              { href: "/customers/import", label: "Import contacts", icon: IconUpload },
            ].map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 rounded-md px-3 py-3 text-[15px] font-medium hover:bg-[#f1f4f9]"
              >
                <Icon width={18} height={18} className="text-ink-2" />
                {label}
              </Link>
            ))}
          <div className="border-t border-line mt-2 pt-2 px-3 pb-1">
            <p className="text-xs text-faint mb-2">{userEmail}</p>
            <SignOutButton className="btn btn-sm w-full" />
          </div>
        </div>
      </Sheet>

      {/* New action sheet */}
      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="New">
        <div className="flex flex-col gap-1 -mx-1">
          {actions.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-3 text-[15px] font-medium hover:bg-[#f1f4f9]"
            >
              <Icon width={18} height={18} className="text-ink-2" />
              {label}
            </Link>
          ))}
        </div>
      </Sheet>

      <CommandK open={searchOpen} onClose={() => setSearchOpen(false)} pages={nav} />
    </div>
  );
}

function SignOutButton({ className }: { className?: string }) {
  const supabase = createClient();
  return (
    <button
      className={className}
      onClick={async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
      }}
    >
      Sign out
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
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="fixed z-50 inset-x-3 top-[10dvh] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[520px] card overflow-hidden shadow-xl"
      >
        <div className="flex items-center gap-2 px-3 border-b border-line">
          <IconSearch width={16} height={16} className="text-faint shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search customers, pages…"
            className="w-full h-12 text-[16px] md:text-[15px] outline-none placeholder:text-faint bg-transparent"
          />
          <kbd className="hidden md:block text-[10px] text-faint border border-line rounded px-1.5 py-0.5">esc</kbd>
        </div>
        <div className="max-h-[50dvh] overflow-y-auto py-1.5">
          {total === 0 && (
            <p className="px-4 py-6 text-sm text-faint text-center">
              {q.trim() ? "No matches." : "Type a name, phone number, or email."}
            </p>
          )}
          {shownResults.map((c, i) => (
            <button
              key={c.id}
              onClick={() => go(i)}
              onMouseEnter={() => setSel(i)}
              className={`w-full text-left px-4 py-2.5 flex items-baseline justify-between gap-3 ${sel === i ? "bg-brand-wash" : ""}`}
            >
              <span className="font-medium text-sm truncate">{c.name}</span>
              <span className="text-xs text-faint num shrink-0">{fmtPhone(c.phone) || c.email}</span>
            </button>
          ))}
          {pages.map((p, j) => {
            const i = shownResults.length + j;
            return (
              <button
                key={p.href}
                onClick={() => go(i)}
                onMouseEnter={() => setSel(i)}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-2.5 text-sm ${sel === i ? "bg-brand-wash" : ""}`}
              >
                <p.icon width={15} height={15} className="text-faint" />
                Go to {p.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
