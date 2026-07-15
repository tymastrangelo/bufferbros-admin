import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoFull } from "@/components/brand";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./reset-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=reset");

  return (
    <div className="min-h-dvh bg-pit flex flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-[380px]">
        <LogoFull className="w-[min(70vw,280px)] mx-auto mb-3" />
        <p className="label text-center text-pit-text/70! mb-8">Set a new password</p>
        <ResetPasswordForm email={user.email ?? ""} />
      </main>
    </div>
  );
}
