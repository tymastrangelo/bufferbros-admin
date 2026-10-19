import { createBrowserClient } from "@supabase/ssr";
import { LARP_COOKIE, VIEW_AS_COOKIE, wrapClient } from "@/lib/larp/client";

const hasCookie = (name: string, value?: string) =>
  typeof document !== "undefined" &&
  document.cookie.split("; ").some((c) => (value ? c === `${name}=${value}` : c.startsWith(`${name}=`) && c.length > name.length + 1));

export function createClient() {
  const real = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  // Same LARP / view-as wrapping as the server client, so client-side searches agree.
  return wrapClient(real, { larp: hasCookie(LARP_COOKIE, "1"), readOnly: hasCookie(VIEW_AS_COOKIE) });
}
