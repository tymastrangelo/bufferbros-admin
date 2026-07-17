// Phone push via ntfy.sh — Tyler and Gabe subscribe to private topics in the ntfy app.
// The topic name IS the secret (NTFY_TOPIC_OWNER / NTFY_TOPIC_WASHER). Fire-and-forget:
// a dead notification must never fail the action that triggered it.
import "server-only";

const APP_URL = "https://admin.bufferbros.org";

export type NotifyTarget = "owner" | "washer" | "both";

const TOPICS: Record<"owner" | "washer", string | undefined> = {
  owner: process.env.NTFY_TOPIC_OWNER,
  washer: process.env.NTFY_TOPIC_WASHER,
};

export async function notify(to: NotifyTarget, title: string, message: string, path = "/") {
  const targets = to === "both" ? (["owner", "washer"] as const) : ([to] as const);
  await Promise.all(
    targets.map(async (t) => {
      const topic = TOPICS[t];
      if (!topic) return; // not configured (e.g. local dev): silently skip
      try {
        const res = await fetch("https://ntfy.sh", {
          method: "POST",
          body: JSON.stringify({ topic, title, message, click: `${APP_URL}${path}`, tags: ["oncoming_automobile"] }),
        });
        if (!res.ok) console.error(`ntfy ${t}: ${res.status} ${await res.text()}`);
      } catch (e) {
        console.error(`ntfy ${t}:`, e);
      }
    })
  );
}
