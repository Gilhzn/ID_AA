// Tone-safety guardrails. The product sends in the user's name, so a single bad
// message can damage their client relationship. See invoicechaser/docs/05 §5.4.
// Every generated message MUST pass `enforceGuardrails` before it can be sent.

// Words/phrases we never allow in a first-party reminder (no threats / legal scare / abuse).
const BANNED_PATTERNS = [
  /\blawsuit\b/i,
  /\blegal action\b/i,
  /\bdebt collector\b/i,
  /\bcredit (score|bureau)\b/i,
  /\bseize\b/i,
  /תביעה משפטית/,
  /הוצאה לפועל/,
  /עורך[- ]דין/,
  /נקיטת הליכים/,
];

/**
 * @typedef {Object} GuardrailResult
 * @property {boolean} ok
 * @property {string[]} violations
 * @property {string} body          possibly-sanitized body
 */

/**
 * Enforce tone-safety on a drafted message.
 * - Blocks banned/threatening language.
 * - Caps urgency: even the final notice stays factual, never abusive.
 * @param {string} body
 * @param {1|2|3|4} urgency
 * @returns {GuardrailResult}
 */
export function enforceGuardrails(body, urgency) {
  const violations = [];
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(body)) violations.push(`banned phrase: ${pattern}`);
  }
  if (urgency > 4) violations.push("urgency exceeds allowed maximum (4)");

  // Defensive: collapse excessive exclamation marks (anti-aggressive tone).
  const body2 = body.replace(/!{2,}/g, "!");

  return { ok: violations.length === 0, violations, body: body2 };
}

/**
 * Whether a step at this urgency must be human-approved before sending,
 * regardless of global mode (final notices always get a human in the loop).
 * @param {1|2|3|4} urgency
 */
export function mustHumanApprove(urgency) {
  return urgency >= 4;
}
