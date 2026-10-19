import { requireOwner } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { MoneyTabs } from "./money-tabs";

export default async function MoneyLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  return (
    <div className="page max-w-5xl">
      <div className="-mb-2">
        <PageHeader title="Money" />
      </div>
      <MoneyTabs />
      {children}
    </div>
  );
}
