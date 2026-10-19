// Every exported server action must tell Tyler what a worker did (logActivity / a push)
// or say why not with an `// activity: <reason>` marker. Run after adding any action:
//   npx tsx src/lib/actions/activity.check.ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "src/lib/actions");
const missing: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".check.ts"))) {
  const src = readFileSync(join(dir, file), "utf8");
  if (!src.startsWith('"use server"')) continue;
  const fileMarker = /^\/\/ activity:/m.test(src.split("export ")[0]);
  const parts = src.split(/\n(?=export async function )/).slice(1);
  for (const body of parts) {
    const name = body.match(/^export async function (\w+)/)![1];
    const covered = fileMarker || /logActivity\(|sendPush\(|notify\(|\/\/ activity:/.test(body.split(/\n(?:export |\/\*\*|function |async function )/)[0]);
    if (!covered) missing.push(`${file} › ${name}`);
  }
}
assert.deepEqual(missing, [], `Server actions with no activity push or "// activity:" marker:\n  ${missing.join("\n  ")}`);
console.log("activity.check: ok");
