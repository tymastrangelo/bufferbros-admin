"use client";

// Small pieces shared by the Marketing tabs.
import {
  IconBoat,
  IconBrowser,
  IconChats,
  IconEquals,
  IconHourglass,
  IconMail,
  IconMessage,
  IconPause,
  IconPhone,
  IconTrendUp,
  IconWarning,
  IconWave,
  IconWrench,
  type IconComponent,
} from "@/components/icons";
import { CALLS, CHANNELS, type Call } from "@/lib/marketing";
import type { ChannelId, LeadKind, MarketingCampaign } from "@/lib/types";

const CALL_ICON: Record<Call, IconComponent> = {
  scale: IconTrendUp,
  hold: IconEquals,
  learning: IconHourglass,
  fix: IconWrench,
  investigate: IconWarning,
  pause: IconPause,
};

/** The weekly call: glyph + word + tone, so it never rides on color alone (color.md › Inclusive color). */
export function CallChip({ call }: { call: Call }) {
  const { label, tone } = CALLS[call];
  const Icon = CALL_ICON[call];
  return (
    <span className={`chip ${tone ? `chip-${tone}` : ""} shrink-0`}>
      <Icon width={12} height={12} weight="bold" aria-hidden />
      {label}
    </span>
  );
}

const KIND_ICON: Record<LeadKind, IconComponent> = {
  call: IconPhone,
  text: IconMessage,
  dm: IconChats,
  form: IconBrowser,
  boat_inquiry: IconBoat,
  email_signup: IconMail,
  in_person: IconWave,
};

export function KindIcon({ kind }: { kind: LeadKind }) {
  const Icon = KIND_ICON[kind] ?? IconPhone;
  return (
    <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-ink-2">
      <Icon width={16} height={16} />
    </span>
  );
}

/** Native select (the iOS wheel on phones) for one channel; "" = unknown. */
export function ChannelSelect({
  value,
  onChange,
  unknownLabel = "Not sure",
  className = "select",
  disabled,
  id,
}: {
  value: ChannelId | null;
  onChange: (v: ChannelId | null) => void;
  unknownLabel?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <select id={id} className={className} value={value ?? ""} disabled={disabled} onChange={(e) => onChange((e.target.value || null) as ChannelId | null)}>
      <option value="">{unknownLabel}</option>
      {CHANNELS.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

/** Campaigns to credit, narrowed to the chosen channel when there is one. */
export function CampaignSelect({
  campaigns,
  channel,
  value,
  onChange,
}: {
  campaigns: MarketingCampaign[];
  channel: ChannelId | null;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const options = campaigns.filter((c) => (!channel || c.channel === channel) && (c.status !== "ended" || c.id === value));
  return (
    <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={options.length === 0}>
      <option value="">{options.length ? "No specific campaign" : "No campaigns on this channel"}</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
