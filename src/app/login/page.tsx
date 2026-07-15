import type { Metadata } from "next";
import { Suspense } from "react";
import { LogoFull } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="min-h-dvh bg-pit flex flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-[380px]">
        <LogoFull className="w-[min(78vw,320px)] mx-auto mb-3" />
        <p className="label text-center text-pit-text/70! mb-8">Operations dashboard</p>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-8 text-xs text-pit-text/70 text-center leading-relaxed">
          Marco Island &amp; Naples, FL · Owners only —<br />
          accounts are created by hand, there is no signup.
        </p>
      </main>
    </div>
  );
}
