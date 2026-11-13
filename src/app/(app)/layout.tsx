import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Shell } from "@/components/nav";
import { InactiveScreen } from "@/components/inactive";
import { ToastProvider } from "@/components/toast";
import { getRealRole, getViewAs } from "@/lib/auth";
import { reconcileGcal } from "@/lib/gcal";
import { LARP_COOKIE } from "@/lib/larp/client";
import { createClient } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/time";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Website bookings land straight in Supabase: put any job missing from Google Calendar on it.
  after(() => reconcileGcal(true));
  const realRole = await getRealRole();
  const viewAs = await getViewAs();

  // Employees table is real in every mode — it's who's on the crew, not money.
  const { data: emps } = await supabase.from("employees").select("id,name,user_id,active").order("created_at");
  const all = (emps ?? []) as { id: string; name: string; user_id: string | null; active: boolean }[];
  const crew = all.filter((e) => e.active);
  const me = all.find((e) => e.user_id === user.id);
  // Deactivated worker, or a login not linked to anyone on the crew (the DB shows them nothing
  // either): no schedule, no pay — just a sign-out screen until Tyler adds/reactivates them.
  if (realRole !== "owner" && !me?.active) return <InactiveScreen name={me?.name ?? user.email?.split("@")[0] ?? "there"} />;
  const previewing = viewAs ? crew.find((e) => e.id === viewAs) ?? null : null;

  const name =
    realRole === "owner"
      ? (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? "Tyler"
      : me?.name ?? user.email?.split("@")[0] ?? "Crew";

  // The Leads badge: unanswered inquiries + follow-ups that have come due (same split as
  // leadQueue() in src/lib/marketing.ts). Always the real leads, like the rest of Marketing.
  let leadsDue = 0;
  if (realRole === "owner" && !previewing) {
    const { count } = await (await createClient({ realData: true }))
      .from("leads")
      .select("id", { count: "exact", head: true })
      .or(`and(status.eq.new,kind.neq.email_signup),and(status.in.(contacted,quoted),follow_up_on.lte.${todayYmd()})`);
    leadsDue = count ?? 0;
  }

  return (
    <ToastProvider>
      <Shell
        role={previewing ? "washer" : realRole}
        me={{ name, roleLabel: realRole === "owner" ? "Owner" : "Crew" }}
        crew={realRole === "owner" ? crew.map((e) => ({ id: e.id, name: e.name })) : []}
        previewing={previewing ? { id: previewing.id, name: previewing.name } : null}
        larp={realRole === "owner" && (await cookies()).get(LARP_COOKIE)?.value === "1"}
        leadsDue={leadsDue}
      >
        {children}
      </Shell>
      <VersionTag />
    </ToastProvider>
  );
}

/** Tiny release marker, bottom-right — the deployed commit so we can tell what's live. */
function VersionTag() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return (
    <span className="fixed bottom-1 right-2 z-10 text-micro text-faint tabular-nums pointer-events-none select-none opacity-70">{sha ?? "dev"}</span>
  );
}
