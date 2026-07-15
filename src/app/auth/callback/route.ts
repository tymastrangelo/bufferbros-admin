import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Lands here from Supabase auth emails (password recovery). Exchanges the
// one-time code for a session cookie, then forwards to the target page.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/";
  // only allow same-origin paths
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

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
