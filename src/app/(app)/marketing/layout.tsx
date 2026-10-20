import { cookies } from "next/headers";
import { requireOwner } from "@/lib/auth";
import { LARP_COOKIE } from "@/lib/larp/client";
import { PageHeader } from "@/components/ui";
import { MarketingTabs } from "./marketing-tabs";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  const demo = (await cookies()).get(LARP_COOKIE)?.value === "1";
  return (
    <div className="page max-w-5xl">
      <div className="-mb-2">
        <PageHeader title="Marketing" />
      </div>
      {demo && <p className="note note-brand mt-3 text-sm">Demo data is on everywhere else. Marketing always shows your real numbers.</p>}
      <MarketingTabs />
      {children}
    </div>
  );
}
