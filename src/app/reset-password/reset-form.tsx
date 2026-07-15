"use client";

import { useState } from "react";
import { Wheel } from "@/components/brand";
import { createClient } from "@/lib/supabase/client";
import { ErrorNote, Field } from "@/components/ui";

export function ResetPasswordForm({ email }: { email: string }) {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const repeat = String(form.get("repeat") ?? "");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== repeat) return setError("Those passwords don't match.");

    setPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setPending(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <form onSubmit={onSubmit} className="card p-5 flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        For <span className="font-medium text-ink">{email}</span>
      </p>
      <Field label="New password">
        <input name="password" type="password" autoComplete="new-password" required autoFocus className="input" />
      </Field>
      <Field label="Repeat it">
        <input name="repeat" type="password" autoComplete="new-password" required className="input" />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <button type="submit" className="btn btn-primary h-10" disabled={pending}>
        {pending ? (
          <>
            <Wheel size={16} /> Saving…
          </>
        ) : (
          "Save new password"
        )}
      </button>
    </form>
  );
}
