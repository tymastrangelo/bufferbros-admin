"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ErrorNote, Field } from "@/components/ui";

export function LoginForm() {
  const supabase = createClient();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "That email and password don't match. Try again."
          : error.message
      );
      setPending(false);
      return;
    }
    // Full navigation so the fresh session cookie reaches the server layout.
    window.location.href = params.get("next") || "/";
  }

  async function onForgot(email: string) {
    if (!email) {
      setError("Enter your email first, then tap “Forgot password.”");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (error) setError(error.message);
    else setResetSent(true);
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 flex flex-col gap-4">
      <Field label="Email">
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@bufferbros.org"
          className="input"
          id="login-email"
        />
      </Field>
      <Field label="Password">
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      {resetSent && <p className="text-sm text-ok">Password reset email sent — check your inbox.</p>}
      <button type="submit" className="btn btn-primary h-10" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <div className="flex items-center justify-between text-xs text-faint">
        <span>You&apos;ll stay signed in on this device.</span>
        <button
          type="button"
          className="underline underline-offset-2 hover:text-ink"
          onClick={() => onForgot((document.getElementById("login-email") as HTMLInputElement)?.value.trim())}
        >
          Forgot password
        </button>
      </div>
    </form>
  );
}
