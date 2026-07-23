import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { notify } from "@/lib/notify";

// Refreshes the Supabase session cookie and guards every route except /login.
// Deep links survive login via ?next=.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  // Every server action (create/edit/delete anything) arrives as a POST with a
  // `next-action` header, so this one guard sees all washer activity — including
  // actions added later. Owner's own activity stays silent.
  if (user && user.app_metadata?.role !== "owner" && request.method === "POST" && request.headers.has("next-action")) {
    event.waitUntil(notify("owner", "Gabe made a change", `From ${path}`, path));
  }

  const onLogin = path === "/login";
  // The recovery-email landing must be reachable without a session — it's what creates one.
  if (path === "/auth/callback") return response;

  if (!user && !onLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (user && onLogin) {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.searchParams.get("next")?.split("?")[0] || "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Everything except static assets and the cron route (guarded by CRON_SECRET instead).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|icons/|brand/|manifest\\.webmanifest|api/cron|api/stripe).*)"],
};
