"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui";

const TABS = [
  { href: "/marketing", label: "Overview" },
  { href: "/marketing/leads", label: "Leads" },
  { href: "/marketing/campaigns", label: "Campaigns" },
  { href: "/marketing/ads", label: "Ads" },
  { href: "/marketing/playbook", label: "Playbook" },
];

export function MarketingTabs() {
  const pathname = usePathname();
  return <Tabs className="mt-3" value={pathname} tabs={TABS.map((t) => ({ value: t.href, label: t.label, href: t.href }))} />;
}
