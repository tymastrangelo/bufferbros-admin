// Job checklists: what a detail includes, ticked on site. Seeded at booking from the
// service's steps (services.checklist, editable in Settings) plus one item per add-on and
// one per chosen boat component; re-seeded when add-ons change so ticks survive.
import type { ChecklistItem } from "@/lib/types";

export type { ChecklistItem };

/** Steps for a job. ids are stable slugs so re-seeding can keep ticks: svc:N, addon:ID, boat:ID. */
export function seedChecklist(
  serviceSteps: string[],
  addons: { id: string; name: string }[],
  boatComponents: { id: string; name: string }[] = []
): ChecklistItem[] {
  return [
    ...serviceSteps.map((name, i) => ({ id: `svc:${i}`, name, done: false })),
    ...addons.map((a) => ({ id: `addon:${a.id}`, name: a.name, done: false })),
    ...boatComponents.map((b) => ({ id: `boat:${b.id}`, name: b.name, done: false })),
  ];
}

/** Keep `done` for ids that survive, add new ids unticked, drop ids that vanished. */
export function reseedChecklist(current: ChecklistItem[], next: ChecklistItem[]): ChecklistItem[] {
  const done = new Map(current.map((i) => [i.id, i.done]));
  return next.map((i) => ({ ...i, done: done.get(i.id) ?? false }));
}

export const checklistProgress = (items: ChecklistItem[]) => ({ done: items.filter((i) => i.done).length, total: items.length });
