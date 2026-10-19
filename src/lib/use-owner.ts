"use client";

// UI-level role check for client components (hides owner-only buttons).
// Real enforcement lives in the server actions + the appointments DB trigger.
import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";

export function useOwner(): boolean {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    createClient()
      .auth.getSession()
      // A previewing owner ("view as Gabe") sees the worker UI.
      .then(({ data }) => setOwner(data.session?.user?.app_metadata?.role === "owner" && !document.cookie.includes("bb_view_as=")));
  }, []);
  return owner;
}
