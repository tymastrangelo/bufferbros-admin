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
    <div className="relative min-h-dvh bg-pit flex flex-col items-center justify-center px-4 py-10 overflow-hidden">
      {/* soft brand glow behind the logo */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[18%] h-[420px] w-[620px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgb(37 99 235 / 0.55), transparent)" }}
      />
      <main className="stagger relative w-full max-w-[380px]">
        <LogoFull className="w-[min(70vw,280px)] mx-auto mb-3" />
        <p className="label text-center text-pit-text/70! mb-8">Set a new password</p>
        <ResetPasswordForm email={user.email ?? ""} />
      </main>
    </div>
  );
}
