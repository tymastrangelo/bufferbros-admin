// Pure math for the Google Ads sync (kept import-free so google-ads.check.ts can run it).

/** One row per campaign per month, 2dp; a date seen twice counts once (last wins). */
export function monthSpend(metrics: { google_id: string; date: string; cost: number }[]): { google_id: string; month: string; amount: number }[] {
  const byDay = new Map<string, number>();
  for (const m of metrics) byDay.set(`${m.google_id}|${m.date}`, m.cost);
  const byMonth = new Map<string, number>();
  for (const [k, cost] of byDay) {
    const [id, date] = k.split("|");
    const key = `${id}|${date.slice(0, 7)}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + cost);
  }
  return [...byMonth]
    .map(([k, amount]) => {
      const [google_id, month] = k.split("|");
      return { google_id, month, amount: Math.round(amount * 100) / 100 };
    })
    .sort((a, b) => a.google_id.localeCompare(b.google_id) || a.month.localeCompare(b.month));
}
