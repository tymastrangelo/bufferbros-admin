"use client";

// Which worker a payment's cut goes to — shared by the job sheet (complete / who did it)
// and Money › Payouts (unattributed payments).
import { Field } from "./ui";

export type EmployeeLite = { id: string; name: string; active: boolean };

/**
 * Owner-only "who did this detail" chips. Picking "Me" reveals the
 * keep-all-the-money box — checked, the worker/business split is skipped and the
 * whole payment stays with the business.
 */
export function WhoPicker({
  employees,
  value,
  keepAll,
  onChange,
  label = "Who did this detail?",
  allowOwner = true,
}: {
  employees: EmployeeLite[];
  value: string | null;
  keepAll: boolean;
  onChange: (employeeId: string | null, keepAll: boolean) => void;
  label?: string;
  /** Hide "Me": a payment with no job can only go to a worker (or be settled). */
  allowOwner?: boolean;
}) {
  // Active workers, plus the current assignee even if since deactivated.
  const options = employees.filter((e) => e.active || e.id === value);
  return (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1.5">
        {options.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onChange(e.id, false)}
            className="choice min-h-9 px-1 py-1.5 text-dense" aria-pressed={value === e.id}
          >
            {e.name}
          </button>
        ))}
        {allowOwner && (
          <button
            type="button"
            onClick={() => onChange(null, true)}
            className="choice min-h-9 px-1 py-1.5 text-dense" aria-pressed={value === null}
          >
            Me
          </button>
        )}
      </div>
      {allowOwner && value === null && (
        <label className="mt-2 flex items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" checked={keepAll} onChange={(e) => onChange(null, e.target.checked)} />
          Keep all the money — skip the worker split
        </label>
      )}
    </Field>
  );
}
