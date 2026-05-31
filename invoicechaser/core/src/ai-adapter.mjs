// AI adapter seam. The product can plug a real LLM (e.g. Claude) into the same
// `generateReminder` interface defined in invoicechaser/docs/05 §5.6, while always
// re-applying guardrails and falling back to the deterministic template generator.
//
// This file intentionally does NOT hard-depend on any SDK so the core stays
// zero-dependency and runnable offline. When ANTHROPIC_API_KEY is present and an
// SDK is wired in, replace `draftWithLLM` with a real call.

import { generateReminder as templateGenerate } from "./generator.mjs";
import { enforceGuardrails } from "./guardrails.mjs";

/**
 * Whether a real LLM is configured. Kept trivial for the MVP.
 */
export function llmAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Placeholder for the real LLM drafting call. Returns null to signal "fall back".
 * To enable: build the prompt from `ctx` (invoice, history, brand tone, step),
 * call the Claude API, and return { subject, body }.
 * @param {object} _ctx
 * @returns {Promise<{subject:string, body:string}|null>}
 */
async function draftWithLLM(_ctx) {
  // Not wired in this offline core. See docs/09 §9.6 for the integration point.
  return null;
}

/**
 * Generate a reminder, preferring the LLM when available, always enforcing guardrails,
 * and falling back to the deterministic template generator on any failure.
 * @param {object} ctx  same shape as generator.generateReminder
 */
export async function generateReminderSmart(ctx) {
  if (llmAvailable()) {
    try {
      const llm = await draftWithLLM(ctx);
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
        // LLM output failed guardrails -> fall back safely.
      }
    } catch {
      // swallow and fall back
    }
  }
  return { ...templateGenerate(ctx), source: "template" };
}
