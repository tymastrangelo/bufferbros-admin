import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/nav";
import { getRealRole, getViewAs } from "@/lib/auth";
import { LARP_COOKIE } from "@/lib/larp/client";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const realRole = await getRealRole();
  const viewAs = await getViewAs();

  // Employees table is real in every mode — it's who's on the crew, not money.
  const { data: emps } = await supabase.from("employees").select("id,name,user_id,active").order("created_at");
  const crew = ((emps ?? []) as { id: string; name: string; user_id: string | null; active: boolean }[]).filter((e) => e.active);
  const me = crew.find((e) => e.user_id === user.id);
  const previewing = viewAs ? crew.find((e) => e.id === viewAs) ?? null : null;

  const name =
    realRole === "owner"
      ? (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? "Tyler"
      : me?.name ?? user.email?.split("@")[0] ?? "Crew";

  return (
    <>
      <Shell
        role={previewing ? "washer" : realRole}
        me={{ name, roleLabel: realRole === "owner" ? "Owner" : "Crew" }}
        crew={realRole === "owner" ? crew.map((e) => ({ id: e.id, name: e.name })) : []}
        previewing={previewing ? { id: previewing.id, name: previewing.name } : null}
        larp={realRole === "owner" && (await cookies()).get(LARP_COOKIE)?.value === "1"}
      >
        {children}
      </Shell>
      <VersionTag />
    </>
  );
}

/** Tiny release marker, bottom-right — the deployed commit so we can tell what's live. */
function VersionTag() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return (
    <span className="fixed bottom-1 right-2 z-10 text-micro text-faint tabular-nums pointer-events-none select-none opacity-70">{sha ?? "dev"}</span>
  );
}
