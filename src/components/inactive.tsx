"use client";

// What a deactivated worker sees instead of the app: one line and a way out. The owner
// reactivates them from their Team page.
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogoFull } from "./brand";

export function InactiveScreen({ name }: { name: string }) {
  const router = useRouter();
  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-6 px-6 text-center">
      <LogoFull />
      <div>
        <p className="text-md font-semibold">Hi {name} — this account is paused.</p>
        <p className="mt-1 text-sm text-ink-2 max-w-sm">You&apos;re not on the active crew right now. Ask Tyler if that&apos;s a mistake.</p>
      </div>
      <button
        className="btn"
        onClick={async () => {
          await createClient().auth.signOut();
          router.replace("/login");
        }}
      >
        Sign out
      </button>
    </main>
  );
}
