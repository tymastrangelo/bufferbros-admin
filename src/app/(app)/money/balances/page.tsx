import type { Metadata } from "next";
import Link from "next/link";
import { Balance, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "Balances" };
export const dynamic = "force-dynamic";

export default async function BalancesPage() {
  const db = await createClient();
  const { data } = await db.from("customer_balances").select("*").neq("balance", 0).order("balance");
  const rows = ((data ?? []) as { customer_id: string; name: string; balance: number }[]).map((r) => ({
    ...r,
    balance: Number(r.balance),
  }));
  const owed = rows.filter((r) => r.balance < 0);
  const credit = rows.filter((r) => r.balance > 0).reverse();

  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="Everyone's settled up."
          hint="Owed and prepaid balances show here. Charges post when you complete a job; payments and credits raise the balance."
        />
      </div>
    );
  }

  return (
    <div className="mt-4 grid md:grid-cols-2 gap-4 items-start">
      <section>
        <h2 className="label mb-1.5">
          Owed to you — {money(owed.reduce((s, r) => s + Math.abs(r.balance), 0))}
        </h2>
        <div className="card divide-y divide-line">
          {owed.length === 0 && <p className="px-4 py-3 text-sm text-faint">Nobody owes you. Nice.</p>}
          {owed.map((r) => (
            <Link key={r.customer_id} href={`/customers/${r.customer_id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#f8fafd]">
              <span className="text-sm font-medium truncate">{r.name}</span>
              <Balance amount={r.balance} />
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="label mb-1.5">
          Prepaid credit held — {money(credit.reduce((s, r) => s + r.balance, 0))}
        </h2>
        <div className="card divide-y divide-line">
          {credit.length === 0 && <p className="px-4 py-3 text-sm text-faint">No prepaid credit on the books.</p>}
          {credit.map((r) => (
            <Link key={r.customer_id} href={`/customers/${r.customer_id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#f8fafd]">
              <span className="text-sm font-medium truncate">{r.name}</span>
              <Balance amount={r.balance} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
