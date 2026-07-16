import { redirect } from "next/navigation";
import { Shell } from "@/components/nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const role = user.app_metadata?.role === "owner" ? ("owner" as const) : ("washer" as const);
  return (
    <Shell userEmail={user.email ?? ""} role={role}>
      {children}
    </Shell>
  );
}
