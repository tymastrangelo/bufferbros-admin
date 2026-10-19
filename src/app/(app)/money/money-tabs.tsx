"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui";

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
  return <Tabs className="mt-3" value={pathname} tabs={TABS.map((t) => ({ value: t.href, label: t.label, href: t.href }))} />;
}
