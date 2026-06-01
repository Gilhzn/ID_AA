// Cadence Engine — decides, for a given invoice and date, which reminder step is due
// and whether to escalate or hand off to a human.
// Implements the "four decisions" logic from invoicechaser/docs/05-ai-dunning-engine.md (timing + escalation).

import { daysOverdue } from "./domain.mjs";

/**
 * @typedef {Object} CadenceStep
 * @property {string} key
 * @property {number} offsetDays           days relative to due date (0 = due date)
 * @property {1|2|3|4} urgency             1 = friendly … 4 = final notice
 * @property {boolean} requiresApproval    escalate => ask the business owner first
 */

/**
 * Default cadence for the Beachhead (agencies). Friendly first, firm later,
 * with human approval before the strongest step. See docs/04 §4.2 and docs/05 §5.2.
 * @type {CadenceStep[]}
 */
export const DEFAULT_CADENCE = [
  { key: "pre_due", offsetDays: -3, urgency: 1, requiresApproval: false },
  { key: "on_due", offsetDays: 0, urgency: 1, requiresApproval: false },
  { key: "overdue_7", offsetDays: 7, urgency: 2, requiresApproval: false },
  { key: "overdue_14", offsetDays: 14, urgency: 3, requiresApproval: false },
  { key: "overdue_30", offsetDays: 30, urgency: 4, requiresApproval: true },
];

/**
 * @typedef {Object} NextAction
 * @property {"send"|"approve"|"wait"|"stop"} action
 * @property {CadenceStep|null} step
 * @property {string} reason
 */

/**
 * Decide the next action for an invoice today.
 * - stop: invoice is paid or disputed (never chase disputed money — docs/05 §5.4)
 * - send: a step is due and can go automatically
 * - approve: a step is due but needs human sign-off (escalation)
 * - wait: nothing due yet
 *
 * @param {import("./domain.mjs").Invoice} invoice
 * @param {Date} today
 * @param {"auto"|"approval"} mode  global send mode (docs/04 §4.6)
 * @param {CadenceStep[]} [cadence]
 * @returns {NextAction}
 */
export function decideNextAction(invoice, today, mode, cadence = DEFAULT_CADENCE) {
  if (invoice.status === "paid") return { action: "stop", step: null, reason: "invoice paid" };
  if (invoice.status === "disputed")
    return { action: "stop", step: null, reason: "invoice disputed — chasing halted" };

  const d = daysOverdue(invoice, today);

  // The current step is the latest one whose offset has been reached.
  let current = null;
  for (const step of cadence) {
    if (d >= step.offsetDays) current = step;
  }
  if (!current) return { action: "wait", step: null, reason: `not due yet (${d} days)` };

  const needsApproval = mode === "approval" || current.requiresApproval;
  return {
    action: needsApproval ? "approve" : "send",
    step: current,
    reason: `step "${current.key}" due at ${d} days overdue`,
  };
}

/**
 * Build the full planned sequence for an invoice (what was/should be sent at each step),
 * useful for previews and for the Concierge validation phase (docs/10 Phase 0).
 * @param {import("./domain.mjs").Invoice} invoice
 * @param {Date} today
 * @param {CadenceStep[]} [cadence]
 */
export function plannedSequence(invoice, today, cadence = DEFAULT_CADENCE) {
  const d = daysOverdue(invoice, today);
  return cadence.map((step) => ({
    step,
    dueAtDaysOverdue: step.offsetDays,
    state: d >= step.offsetDays ? "due_or_sent" : "upcoming",
  }));
}
