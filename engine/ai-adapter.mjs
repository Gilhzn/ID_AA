// AI adapter seam. Prefers a real LLM (Claude) when available, ALWAYS re-applies
// guardrails to the output, and falls back to the deterministic template generator
// on any failure or guardrail violation. Keeps the core zero-dependency.
// See invoicechaser/docs/05 §5.6 and docs/09 §9.6.

import { generateReminder as templateGenerate } from "./generator.mjs";
import { enforceGuardrails } from "./guardrails.mjs";
import { draftWithClaude } from "./llm-claude.mjs";

// Browser-safe access to env (no `process` in the browser static build).
const ENV = typeof process !== "undefined" && process.env ? process.env : {};

/**
 * Whether a real LLM is configured (env or explicit opts).
 * @param {{apiKey?:string}} [opts]
 */
export function llmAvailable(opts = {}) {
  return Boolean(opts.apiKey || ENV.ANTHROPIC_API_KEY);
}

/**
 * Generate a reminder, preferring the LLM when available, always enforcing guardrails,
 * and falling back to the deterministic template generator on any failure.
 *
 * @param {object} ctx  { invoice, brand, step, today, history? }
 * @param {object} [opts]  { apiKey?, fetchImpl?, model? } — injectable for tests/offline
 * @returns {Promise<object>}  draft + `source: "llm"|"template"`
 */
export async function generateReminderSmart(ctx, opts = {}) {
  const apiKey = opts.apiKey || ENV.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const llm = await draftWithClaude(ctx, { apiKey, fetchImpl: opts.fetchImpl, model: opts.model });
      if (llm && llm.body) {
        const guard = enforceGuardrails(llm.body, ctx.step.urgency);
        if (guard.ok) {
          return {
            subject: llm.subject,
            body: guard.body,
            urgency: ctx.step.urgency,
            channel: "email",
            guardrailViolations: [],
            source: "llm",
          };
        }
        // LLM output failed guardrails -> fall back safely (never send unsafe copy).
      }
    } catch {
      // network/parse error -> fall back
    }
  }
  return { ...templateGenerate(ctx), source: "template" };
}
