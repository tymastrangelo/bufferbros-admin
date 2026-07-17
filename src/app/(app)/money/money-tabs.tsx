"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/money", label: "Overview" },
  { href: "/money/capital", label: "Capital" },
  { href: "/money/payments", label: "Payments" },
  { href: "/money/payouts", label: "Payouts" },
  { href: "/money/balances", label: "Balances" },
  { href: "/money/expenses", label: "Expenses" },
];

export function MoneyTabs() {
  const pathname = usePathname();
  return (
    <div className="mt-3 flex border-b border-line overflow-x-auto" role="tablist">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={`px-3.5 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors duration-150 ${
              active ? "border-brand text-brand-deep" : "border-transparent text-faint hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
