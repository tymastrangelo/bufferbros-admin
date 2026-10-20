import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { LARP_COOKIE, VIEW_AS_COOKIE, wrapClient } from "@/lib/larp/client";

/**
 * Request-scoped client. LARP mode (cookie bb_larp) swaps business tables for the demo
 * dataset; "view as" (bb_view_as) keeps real reads but refuses every write. Both are
 * read-only, so nothing a demo or preview click does can touch prod data.
 * `realData`: skip LARP — Marketing always shows (and writes) the real numbers, never demo
 * ones (Tyler, 2026-10-20). "View as" stays read-only either way.
 */
export async function createClient({ realData = false }: { realData?: boolean } = {}) {
  const cookieStore = await cookies();
  const real = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // called from a Server Component — middleware refreshes sessions instead
          }
        },
      },
    }
  );
  return wrapClient(real, {
    larp: !realData && cookieStore.get(LARP_COOKIE)?.value === "1",
    readOnly: !!cookieStore.get(VIEW_AS_COOKIE)?.value,
  });
}

/** Service-role client for cron/webhook routes only. Never import in client code. */
export function createServiceClient() {
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
