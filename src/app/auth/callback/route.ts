import { NextResponse } from "next/server";
import { safeNext } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

// Lands here from Supabase auth emails (password recovery). Exchanges the
// one-time code for a session cookie, then forwards to the target page.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin); // same-origin paths only

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  // Missing/expired/foreign-device code — back to login with a clear message.
  return NextResponse.redirect(new URL("/login?error=reset", url.origin));
}
