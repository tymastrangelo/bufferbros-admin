// Job checklists: what a detail includes, ticked on site. Seeded at booking from the
// service's steps (services.checklist, editable in Settings) plus one item per add-on and
// one per chosen boat component; re-seeded when add-ons change so ticks survive.
import type { ChecklistItem } from "@/lib/types";

export type { ChecklistItem };

/** Ticked on every job, whatever the service: the content that sells the next one.
 *  Website bookings never get seeded, so they get the same two from the column default
 *  on appointments.checklist (migration 0044) — change the wording in both places. */
export const EVERY_JOB: ChecklistItem[] = [
  { id: "always:story", name: "Post a story: video or photo with music, suds on the car", done: false },
  { id: "always:album", name: "Add photos to our photo album", done: false },
];

/** Steps for a job. ids are stable slugs so re-seeding can keep ticks: svc:N, addon:ID, boat:ID, always:X. */
export function seedChecklist(
  serviceSteps: string[],
  addons: { id: string; name: string }[],
  boatComponents: { id: string; name: string }[] = []
): ChecklistItem[] {
  return [
    ...serviceSteps.map((name, i) => ({ id: `svc:${i}`, name, done: false })),
    ...addons.map((a) => ({ id: `addon:${a.id}`, name: a.name, done: false })),
    ...boatComponents.map((b) => ({ id: `boat:${b.id}`, name: b.name, done: false })),
    ...EVERY_JOB,
  ];
}

/** Keep `done` for ids that survive, add new ids unticked, drop ids that vanished. */
export function reseedChecklist(current: ChecklistItem[], next: ChecklistItem[]): ChecklistItem[] {
  const done = new Map(current.map((i) => [i.id, i.done]));
  return next.map((i) => ({ ...i, done: done.get(i.id) ?? false }));
}

export const checklistProgress = (items: ChecklistItem[]) => ({ done: items.filter((i) => i.done).length, total: items.length });
