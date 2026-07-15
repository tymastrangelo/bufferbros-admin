import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-[360px]">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={40} height={40} className="rounded-[10px]" />
            <div>
              <h1 className="text-[17px] font-bold leading-none">BUFFER BROS</h1>
              <p className="label mt-1">Operations dashboard</p>
            </div>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-8 text-xs text-faint">
          Mobile detailing · Marco Island &amp; Naples, FL · Owners only — accounts are created by hand, there is no signup.
        </p>
      </main>
    </div>
  );
}
