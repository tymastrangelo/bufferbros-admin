import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";

// CSV export for the accountant: payments (all non-charge money events),
// charges, or expenses, over a date range. Session-guarded by the auth proxy.
export async function GET(request: Request) {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "payments";
  const from = url.searchParams.get("from") || "2000-01-01";
  const to = url.searchParams.get("to") || todayYmd();

  let header: string[];
  let rows: (string | number | null)[][];

  if (type === "expenses") {
    const { data } = await db
      .from("expenses")
      .select("*")
      .gte("occurred_on", from)
      .lte("occurred_on", to)
      .order("occurred_on");
    header = ["date", "category", "amount", "memo"];
    rows = (data ?? []).map((e) => [e.occurred_on, e.category, Number(e.amount), e.memo]);
  } else {
    const kinds = type === "charges" ? ["charge"] : ["payment", "credit", "refund", "discount"];
    const { data } = await db
      .from("ledger_entries")
      .select("*, customers(name)")
      .in("kind", kinds)
      .gte("occurred_on", from)
      .lte("occurred_on", to)
      .order("occurred_on");
    header = ["date", "customer", "kind", "method", "amount", "memo"];
    rows = (data ?? []).map((e) => [
      e.occurred_on,
      (e.customers as { name: string } | null)?.name ?? "",
      e.kind,
      e.method,
      Number(e.amount),
      e.memo,
    ]);
  }

  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bufferbros-${type}-${from}-to-${to}.csv"`,
    },
  });
}
