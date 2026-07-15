"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtPhone } from "@/lib/format";
import type { Customer, Vehicle } from "@/lib/types";
import { IconX } from "./icons";

export type PickedCustomer = Customer & { vehicles: Vehicle[] };

export function CustomerPicker({
  value,
  onChange,
  autoFocus,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const supabase = createClient();

  useEffect(() => {
    if (!q.trim() || value) return;
    const t = setTimeout(async () => {
      const term = q.trim().replace(/[%,()]/g, "");
      const { data } = await supabase
        .from("customers")
        .select("*, vehicles(*)")
        .or(`name.ilike.%${term}%,phone.ilike.%${term.replace(/\D/g, "") || term}%,email.ilike.%${term}%`)
        .eq("archived", false)
        .limit(6);
      setResults((data as PickedCustomer[]) ?? []);
    }, 150);
    return () => clearTimeout(t);
  }, [q, value, supabase]);

  const shown = q.trim() && !value ? results : [];

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 border border-line-2 rounded-md px-3 py-2 bg-brand-wash/50">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{value.name}</p>
          <p className="text-xs text-faint num truncate">{fmtPhone(value.phone) || value.email || "no contact info"}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => onChange(null)} aria-label="Clear customer">
          <IconX width={14} height={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className="input"
        placeholder="Search name, phone, or email…"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
      />
      {shown.length > 0 && (
        <div className="absolute z-10 inset-x-0 top-full mt-1 card shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-brand-wash flex items-baseline justify-between gap-2"
              onClick={() => {
                onChange(c);
                setQ("");
              }}
            >
              <span className="text-sm font-medium truncate">{c.name}</span>
              <span className="text-xs text-faint num shrink-0">{fmtPhone(c.phone) || c.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
