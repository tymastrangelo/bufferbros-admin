// "Handle an issue" on a client's profile (migration 0040): Tyler wrote what's going on with one
// client (a reschedule, a complaint, an odd ask). run.mjs has just synced texts; this drafts the
// text he sends next, in his voice, from everything the dashboard knows about them plus the whole
// thread, and applies the make-good rule: when it's on us, settings.make_good_credit dollars off
// their next visit. The amount is never the model's call; it only says whether it's on us.
import { askClaude, customerBrief, voiceBlock, voiceSample, workerNames } from "./summarize.mjs";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "our_fault", "notes"],
  properties: {
    text: { type: "string" },
    our_fault: { type: "boolean" },
    notes: { type: "array", maxItems: 3, items: { type: "string" } },
  },
};

const system = (credit) => `You help Tyler, who owns Buffer Bros (mobile car and boat detailing on Marco Island and in Naples, Florida), handle something that came up with one customer. You get Tyler's note, the customer's CRM record (schedule, plan, money, past visits) and their text thread. Write the text Tyler sends them next.

Rules:
- Sound exactly like Tyler. "How Tyler texts" shows his real messages: copy their length, tone, capitalization, punctuation and emoji habits. Casual and friendly, never corporate or salesy.
- Keep it short: 1 to 3 short sentences, under 280 characters. Start with "Hey <first name>," or jump straight in. No sign-off.
- Handle what Tyler's note says, and answer whatever they last asked if it is still open. If Tyler's note gives a day, time or price, use exactly that.
- The Schedule block is the truth about what is booked. Never offer a date or time that is not in Tyler's note or on the Schedule. Never invent prices or facts: prices come from Tyler's note, the Schedule or the texts.
${credit > 0
  ? `- It is on us when Buffer Bros moved or cancelled a booked visit, ran late or no-showed, or missed or messed up something on a job. Then set our_fault true, apologize once, simply, and tell them they get $${credit} off their next visit. Only ever offer exactly $${credit}. If the texts show they already got money off for this same issue, set our_fault false and say so in notes.
- If they asked for the change, or it is nobody's fault, our_fault is false and offer nothing.`
  : `- Never offer money off. Set our_fault true only if Buffer Bros moved or cancelled a booked visit, ran late or no-showed, or messed something up.`}
- notes: up to 3 short things Tyler should do or know, like a calendar change to make, a question still unanswered, or a pattern (we have moved them before). Empty if none.
Plain words. No em dashes.`;

/** @returns {Promise<{ text: string, our_fault: boolean, credit: number, notes: string[] }>} */
export async function helpWith(call, { customer_id, ask }) {
  const [setting, voice, workerName] = await Promise.all([
    call("settings?key=eq.make_good_credit&select=value"),
    voiceSample(call),
    workerNames(call),
  ]);
  const credit = Math.max(0, Number(setting[0]?.value ?? 0)) || 0;
  const { input } = await customerBrief(call, customer_id, workerName);
  const out = askClaude(system(credit), [`Tyler's note: ${ask?.trim() || "(none, just draft the right next text)"}`, voiceBlock(voice), input].join("\n"), SCHEMA);
  const onUs = !!out.our_fault;
  return {
    text: out.text.trim().replace(/bufferbros\.org\/book(?!ing)/g, "bufferbros.org/booking"),
    our_fault: onUs,
    credit: onUs ? credit : 0,
    notes: (out.notes ?? []).filter(Boolean),
  };
}
