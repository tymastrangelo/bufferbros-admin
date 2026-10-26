"use client";

// Google Ads, run from here: a connection checklist that always names the next step,
// the period's numbers, and one card per campaign with pause / resume / budget.
// Mutations confirm first (HIG alerts.md); numbers are the synced truth, never estimates.
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bars } from "@/components/bars";
import { IconCheckCircle, IconCircle, IconWarning } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Busy, ConfirmPanel, EmptyState, ErrorNote, Field, Segmented, Stat, StatusChip } from "@/components/ui";
import { deleteExpense } from "@/lib/actions/money";
import { disconnectGoogleAds, linkGoogleCampaign, listGoogleAdsAccounts, pickGoogleAdsCustomer, setCampaignStatus, setDailyBudget, syncGoogleAdsNow } from "@/lib/actions/ads";
import { money } from "@/lib/format";
import { addDays, fmtDateShort } from "@/lib/time";
import type { AdCampaign, AdMetric, ChannelId } from "@/lib/types";

export interface AdsData {
  today: string;
  /** How the dashboard signs in: the service account, a saved OAuth token, or not yet. */
  auth: "service_account" | "oauth" | null;
  saConfigured: boolean;
  saEmail: string | null;
  oauthConfigured: boolean;
  connected: boolean;
  customerId: string;
  accessible: string[];
  tokenLevel: "unknown" | "pending" | "ok" | "basic";
  syncedAt: string | null;
  lastError: string | null;
  campaigns: AdCampaign[];
  metrics: AdMetric[];
  crm: { id: string; name: string; channel: ChannelId; google_campaign_id: string | null }[];
  handLogged: { id: string; occurred_on: string; amount: number; memo: string | null; campaign_id: string | null }[];
  flash: { error: string | null; pick: boolean; connected: boolean };
}

type Period = "7d" | "30d" | "90d";
const PERIODS: { value: Period; label: string; days: number }[] = [
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
];
const CHANNEL_LABEL: Record<string, string> = { SEARCH: "Search", LOCAL_SERVICES: "Local Services", PERFORMANCE_MAX: "Performance Max", DISPLAY: "Display", VIDEO: "Video" };
const fmtAt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const perUnit = (cost: number, n: number) => (n > 0 ? money(cost / n) : "—");

function Step({ done, warn, label, detail, action }: { done: boolean; warn?: boolean; label: string; detail?: React.ReactNode; action?: React.ReactNode }) {
  const Icon = done ? IconCheckCircle : warn ? IconWarning : IconCircle;
  return (
    <li className="row gap-3 items-start">
      <Icon width={20} height={20} weight={done ? "fill" : "regular"} className={`shrink-0 mt-0.5 ${done ? "text-ok" : warn ? "text-warn" : "text-faint"}`} aria-hidden />
      <span className="min-w-0 grow">
        <span className="block text-sm font-medium">
          {label}
          <span className="sr-only">{done ? " — done" : " — not yet"}</span>
        </span>
        {detail && <span className="block text-xs text-ink-2">{detail}</span>}
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </li>
  );
}

export function AdsClient({ data }: { data: AdsData }) {
  const router = useRouter();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("30d");
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState<"idle" | "confirm" | "busy">("idle");
  const [customerDraft, setCustomerDraft] = useState(data.accessible[0] ?? "");
  const [pickError, setPickError] = useState<string | null>(null);

  const days = PERIODS.find((p) => p.value === period)!.days;
  const from = addDays(data.today, -(days - 1));
  const inPeriod = useMemo(() => data.metrics.filter((m) => m.date >= from), [data.metrics, from]);
  const tot = inPeriod.reduce(
    (s, m) => ({ cost: s.cost + m.cost, clicks: s.clicks + m.clicks, conv: s.conv + m.conversions, calls: s.calls + m.phone_calls, impr: s.impr + m.impressions }),
    { cost: 0, clicks: 0, conv: 0, calls: 0, impr: 0 }
  );
  const [finding, setFinding] = useState(false);
  const approved = data.tokenLevel === "ok" || data.tokenLevel === "basic";
  const canMutate = data.connected && !!data.customerId && data.tokenLevel !== "pending";
  const nextStep = !data.connected
    ? data.saConfigured
      ? "Add the service account as a Standard user on the Ads account, then find the account below."
      : "Add the service account keys (GCAL_SA_EMAIL / GCAL_SA_KEY) on Vercel, or connect with Google."
    : !data.customerId
      ? "Pick which Ads account to sync."
      : data.tokenLevel === "pending"
        ? "Waiting on Google to approve the Cloud project's access level (Explorer or Basic)."
        : !data.syncedAt
          ? "Run the first sync."
          : null;

  async function findAccounts() {
    setFinding(true);
    const res = await listGoogleAdsAccounts();
    setFinding(false);
    router.refresh();
    if (!res.ok) return toast({ title: "Couldn't list Ads accounts", detail: res.error, tone: "bad" });
    toast({ title: res.ids?.length ? `${res.ids.length} account${res.ids.length === 1 ? "" : "s"} found` : "No accounts visible yet", detail: res.ids?.length ? undefined : "Add the service account as a user on the Ads account first." });
  }

  async function sync() {
    setSyncing(true);
    const res = await syncGoogleAdsNow();
    setSyncing(false);
    router.refresh();
    if (!res.ok) return toast({ title: "Sync didn't finish", detail: res.error, tone: "bad" });
    toast({ title: "Google Ads synced", detail: `${res.result?.campaigns ?? 0} campaigns · ${res.result?.days ?? 0} days of spend` });
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      {data.flash.error && <ErrorNote>{data.flash.error}</ErrorNote>}
      {data.flash.connected && <p className="note note-ok text-dense">Connected. The first sync runs now, then nightly.</p>}

      {/* Connection */}
      <section className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
          <div>
            <h2 className="h-card">Connection</h2>
            {nextStep ? <p className="text-xs text-ink-2 mt-0.5">Next: {nextStep}</p> : <p className="text-xs text-ok mt-0.5">All set — syncing nightly.</p>}
          </div>
          {data.connected && (
            <button className="btn btn-sm" disabled={syncing} onClick={sync}>
              {syncing ? <Busy>Syncing…</Busy> : "Sync now"}
            </button>
          )}
        </div>
        <ul className="divide-y divide-line">
          <Step
            done={data.saConfigured || data.oauthConfigured}
            label="Sign-in method"
            detail={
              data.saConfigured
                ? `Service account ${data.saEmail} (shared with the calendar sync) — add it as a Standard user under Admin › Access and security on the Ads account`
                : data.oauthConfigured
                  ? "OAuth web client on Vercel — connect with your Google account below"
                  : "Nothing on Vercel yet: GCAL_SA_EMAIL + GCAL_SA_KEY (service account) or GADS_CLIENT_ID + GADS_CLIENT_SECRET (OAuth)"
            }
          />
          <Step
            done={data.connected}
            label="Connected to Google Ads"
            detail={
              data.connected
                ? data.auth === "service_account"
                  ? "Signing in as the service account"
                  : "Signed in with your Google account"
                : "A one-time sign-in that lets the dashboard read and manage your campaigns"
            }
            action={
              data.connected ? (
                data.auth === "oauth" && disconnecting === "idle" ? (
                  <button className="btn btn-sm" onClick={() => setDisconnecting("confirm")}>
                    Disconnect
                  </button>
                ) : null
              ) : data.oauthConfigured ? (
                <a className="btn btn-sm btn-primary" href="/api/google-ads/connect">
                  Connect Google Ads
                </a>
              ) : (
                <button className="btn btn-sm btn-primary" disabled aria-disabled="true" title="Add the keys on Vercel first">
                  Connect Google Ads
                </button>
              )
            }
          />
          {disconnecting !== "idle" && (
            <li className="p-3">
              <ConfirmPanel
                title="Disconnect Google Ads?"
                consequence="Synced campaigns and spend stay. Nothing new comes in until you connect again."
                confirmLabel="Disconnect"
                busyLabel="Disconnecting…"
                destructive
                pending={disconnecting === "busy"}
                onCancel={() => setDisconnecting("idle")}
                onConfirm={async () => {
                  setDisconnecting("busy");
                  const res = await disconnectGoogleAds();
                  setDisconnecting("idle");
                  router.refresh();
                  toast(res.ok ? { title: "Google Ads disconnected" } : { title: "Couldn't disconnect", detail: res.error, tone: "bad" });
                }}
              />
            </li>
          )}
          <Step
            done={!!data.customerId}
            label="Serving account"
            detail={data.customerId ? `Account ${data.customerId.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}` : data.connected ? "Which Google Ads account the dashboard syncs" : "Set after connecting"}
            action={
              data.connected && !data.customerId ? (
                <form
                  className="flex items-center gap-1.5"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPickError(null);
                    const res = await pickGoogleAdsCustomer(customerDraft);
                    if (!res.ok) return setPickError(res.error);
                    router.refresh();
                  }}
                >
                  {data.accessible.length > 1 ? (
                    <select className="select h-9" value={customerDraft} onChange={(e) => setCustomerDraft(e.target.value)} aria-label="Google Ads account">
                      {data.accessible.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="input h-9 w-36 num" placeholder="10-digit id" value={customerDraft} onChange={(e) => setCustomerDraft(e.target.value)} aria-label="Google Ads customer id" />
                  )}
                  <button className="btn btn-sm btn-primary" type="submit">
                    Use
                  </button>
                  <button className="btn btn-sm" type="button" disabled={finding} onClick={findAccounts}>
                    {finding ? <Busy>Looking…</Busy> : "Find accounts"}
                  </button>
                </form>
              ) : null
            }
          />
          {pickError && (
            <li className="px-4 py-2">
              <ErrorNote>{pickError}</ErrorNote>
            </li>
          )}
          <Step
            done={approved}
            warn={data.tokenLevel === "pending"}
            label="Cloud project access level"
            detail={
              approved
                ? "Explorer or higher — the live account answers"
                : data.tokenLevel === "pending"
                  ? "Google is still reviewing the project's access level; the live account can't be read until then."
                  : "In the Cloud console's Google Ads API page, apply for Explorer access (automatic in most cases); Basic needs brand verification."
            }
            action={
              !approved ? (
                <a className="btn btn-sm" href="https://console.cloud.google.com/google/ads-apis/overview" target="_blank" rel="noreferrer">
                  Cloud console
                </a>
              ) : null
            }
          />
          <Step
            done={!!data.syncedAt && !data.lastError}
            warn={!!data.lastError}
            label="Last sync"
            detail={data.lastError ? data.lastError : data.syncedAt ? `${fmtAt(data.syncedAt)} · runs nightly around 6 am Eastern` : "Not yet"}
          />
        </ul>
      </section>

      {data.campaigns.length === 0 ? (
        <EmptyState
          title={data.connected ? "No campaigns synced yet." : "Nothing here until Google Ads is connected."}
          hint={data.connected ? "Run a sync — campaigns and the last 30 days of spend land here." : "Once connected, spend flows into Marketing by itself and campaigns can be paused or re-budgeted from here."}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
            <p className="text-xs text-faint num">
              {fmtDateShort(from)} → {fmtDateShort(data.today)}
            </p>
          </div>
          <div className="stat-grid grid-cols-2 md:grid-cols-6">
            <Stat label="Spend" value={money(tot.cost)} />
            <Stat label="Clicks" value={tot.clicks} hint={`${tot.impr} impressions`} />
            <Stat label="Cost per click" value={perUnit(tot.cost, tot.clicks)} />
            <Stat label="Conversions" value={Math.round(tot.conv * 10) / 10} hint="bookings + call taps" />
            <Stat label="Cost per conversion" value={perUnit(tot.cost, tot.conv)} />
            <Stat label="Phone calls" value={tot.calls} />
          </div>

          <div className="flex flex-col gap-3">
            {data.campaigns.map((c) => (
              <CampaignCard key={c.google_id} c={c} metrics={inPeriod.filter((m) => m.google_id === c.google_id)} all={data.metrics.filter((m) => m.google_id === c.google_id)} crm={data.crm} canMutate={canMutate} today={data.today} />
            ))}
          </div>

          <details className="disclose card px-4 py-3">
            <summary className="text-dense text-ink-2 cursor-pointer">Daily spend · last 14 days</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Campaign</th>
                    <th className="text-right">Spend</th>
                    <th className="text-right">Clicks</th>
                    <th className="text-right">Conv.</th>
                    <th className="text-right">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {data.metrics
                    .filter((m) => m.date >= addDays(data.today, -13))
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((m) => (
                      <tr key={`${m.google_id}-${m.date}`}>
                        <td className="num">{fmtDateShort(m.date)}</td>
                        <td>{data.campaigns.find((c) => c.google_id === m.google_id)?.name ?? m.google_id}</td>
                        <td className="num text-right">{money(m.cost)}</td>
                        <td className="num text-right">{m.clicks}</td>
                        <td className="num text-right">{m.conversions}</td>
                        <td className="num text-right">{m.phone_calls}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {data.handLogged.length > 0 && (
        <section className="card p-4 flex flex-col gap-2">
          <h2 className="h-card">Logged by hand</h2>
          <p className="text-xs text-ink-2">These Google rows sit in months the sync now covers, so Marketing may be counting the spend twice. Remove the ones the sync replaced.</p>
          <ul className="divide-y divide-line">
            {data.handLogged.map((e) => (
              <HandRow key={e.id} e={e} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function HandRow({ e }: { e: AdsData["handLogged"][number] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <li className="py-2 flex items-center gap-3 text-sm">
      <span className="num text-faint">{fmtDateShort(e.occurred_on)}</span>
      <span className="truncate grow">{e.memo ?? "Marketing expense"}</span>
      <span className="num font-medium">{money(e.amount)}</span>
      <button
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await deleteExpense(e.id);
          setBusy(false);
          router.refresh();
          toast(res.ok ? { title: `Removed the hand-logged ${money(e.amount)}` } : { title: "Couldn't remove it", detail: res.error, tone: "bad" });
        }}
      >
        {busy ? <Busy>Removing…</Busy> : `Remove ${money(e.amount)}`}
      </button>
    </li>
  );
}

function CampaignCard({ c, metrics, all, crm, canMutate, today }: { c: AdCampaign; metrics: AdMetric[]; all: AdMetric[]; crm: AdsData["crm"]; canMutate: boolean; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [panel, setPanel] = useState<"none" | "status" | "budget" | "link">("none");
  const [budget, setBudget] = useState(c.daily_budget != null ? String(c.daily_budget) : "");
  const [link, setLink] = useState(crm.find((x) => x.google_campaign_id === c.google_id)?.id ?? "new");
  const [pending, setPending] = useState(false);
  const cost = metrics.reduce((s, m) => s + m.cost, 0);
  const clicks = metrics.reduce((s, m) => s + m.clicks, 0);
  const conv = metrics.reduce((s, m) => s + m.conversions, 0);
  const linked = crm.find((x) => x.google_campaign_id === c.google_id);
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));
  const paused = c.status === "PAUSED";

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setPending(true);
    const res = await fn();
    setPending(false);
    router.refresh();
    if (!res.ok) return toast({ title: "Google didn't take that change", detail: res.error, tone: "bad" });
    setPanel("none");
    toast({ title: done });
  }

  return (
    <article className="card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 grow">
          <h3 className="text-md font-semibold truncate">{c.name}</h3>
          <p className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="chip">{CHANNEL_LABEL[c.channel] ?? c.channel}</span>
            <StatusChip status={paused ? "paused" : "active"} />
            <span className="text-xs text-ink-2 num">{c.daily_budget != null ? `${money(c.daily_budget)}/day · ≈ ${money(c.daily_budget * 30.4)}/mo` : "no budget"}</span>
          </p>
        </div>
        <div className="flex gap-1.5">
          <button className="btn btn-sm" disabled={!canMutate || pending} onClick={() => setPanel(panel === "budget" ? "none" : "budget")} title={canMutate ? undefined : "Needs Google's API approval"}>
            Budget
          </button>
          <button className={`btn btn-sm ${paused ? "btn-primary" : ""}`} disabled={!canMutate || pending} onClick={() => setPanel(panel === "status" ? "none" : "status")} title={canMutate ? undefined : "Needs Google's API approval"}>
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <span>
          <span className="label block">Spend</span>
          <span className="num font-semibold">{money(cost)}</span>
        </span>
        <span>
          <span className="label block">Clicks</span>
          <span className="num font-semibold">{clicks}</span>
        </span>
        <span>
          <span className="label block">Cost / conv.</span>
          <span className="num font-semibold">{perUnit(cost, conv)}</span>
          <span className="text-micro text-faint num"> · {Math.round(conv * 10) / 10} conv.</span>
        </span>
      </div>

      <Bars
        labels={last7.map((d) => fmtDateShort(d).replace(/^\w+ /, ""))}
        height={40}
        up={[{ key: "spend", label: "Spend", color: "var(--color-viz-1)", values: last7.map((d) => all.find((m) => m.date === d)?.cost ?? 0) }]}
        ariaLabel={(i) => `${fmtDateShort(last7[i])}: ${money(all.find((m) => m.date === last7[i])?.cost ?? 0)}`}
      />

      <p className="text-xs text-ink-2 flex items-center gap-2 flex-wrap">
        {linked ? (
          <>
            Counts under <span className="font-medium text-ink">{linked.name}</span> in Marketing
          </>
        ) : (
          "Not linked to a Marketing campaign yet"
        )}
        <button className="link" onClick={() => setPanel(panel === "link" ? "none" : "link")}>
          {linked ? "Change" : "Link"}
        </button>
      </p>

      {panel === "status" && (
        <ConfirmPanel
          title={paused ? `Resume “${c.name}”?` : `Pause “${c.name}”?`}
          consequence={paused ? "Ads start serving again within minutes; spend resumes at the daily budget." : "Ads stop within minutes. Nothing is spent until you resume."}
          confirmLabel={paused ? "Resume campaign" : "Pause campaign"}
          busyLabel="Telling Google…"
          destructive={!paused}
          pending={pending}
          onCancel={() => setPanel("none")}
          onConfirm={() => run(() => setCampaignStatus(c.google_id, paused ? "ENABLED" : "PAUSED"), paused ? "Campaign resumed" : "Campaign paused")}
        />
      )}
      {panel === "budget" && (
        <ConfirmPanel
          title="Daily budget"
          consequence={`Google can spend up to 2× this on a given day but averages to it over the month (≈ ${money((Number(budget) || 0) * 30.4)}/mo).`}
          confirmLabel="Save budget"
          busyLabel="Telling Google…"
          pending={pending}
          onCancel={() => setPanel("none")}
          onConfirm={() => {
            if (!(Number(budget) >= 1)) return toast({ title: "Enter a daily budget of at least $1", tone: "warn" });
            run(() => setDailyBudget(c.google_id, Number(budget)), `Budget set to ${money(Number(budget))}/day`);
          }}
        >
          <Field label="Per day">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-faint">$</span>
              <input type="number" inputMode="decimal" min={1} max={1000} className="input num pl-7" value={budget} onChange={(e) => setBudget(e.target.value)} autoFocus />
            </div>
          </Field>
        </ConfirmPanel>
      )}
      {panel === "link" && (
        <ConfirmPanel
          title="Count this campaign under"
          consequence="Synced spend moves with it, so Marketing's cost per customer stays honest."
          confirmLabel="Save link"
          busyLabel="Saving…"
          pending={pending}
          onCancel={() => setPanel("none")}
          onConfirm={() => run(() => linkGoogleCampaign(c.google_id, link), "Campaign linked")}
        >
          <select className="select" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Marketing campaign">
            <option value="new">New Marketing campaign “{c.name}”</option>
            {crm.filter((x) => x.channel === "google_ads" || x.channel === "google_lsa").map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </ConfirmPanel>
      )}
    </article>
  );
}
