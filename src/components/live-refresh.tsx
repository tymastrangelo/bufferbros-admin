"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps every open screen live: any row change in the realtime publication
 * (migration 0020) re-renders the current route from the server. Pages are
 * force-dynamic server components, so router.refresh() is the whole sync —
 * client state (open sheets, half-typed forms) survives it.
 * Also refreshes when the tab/phone wakes, since sockets drop while asleep.
 * ponytail: refetches the whole route per burst of changes; fine at a few users,
 * per-table filters are the upgrade if pages ever get heavy.
 */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Debounce: one save often touches several tables (appointment + ledger + split mirror).
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };

    const channel = supabase
      .channel("live-dashboard")
      .on("postgres_changes", { event: "*", schema: "public" }, refresh)
      .subscribe();

    const onWake = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onWake);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
