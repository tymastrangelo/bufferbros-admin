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
      .then(({ data }) => setOwner(data.session?.user?.app_metadata?.role === "owner"));
  }, []);
  return owner;
}
