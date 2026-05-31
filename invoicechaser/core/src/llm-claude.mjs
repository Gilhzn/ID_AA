// Claude (Anthropic) adapter for drafting reminders — zero-dependency (uses fetch).
// Plugs into the AI Dunning Engine seam (docs/05 §5.6, docs/09 §9.6). The output is
// always re-checked by guardrails upstream (ai-adapter.mjs), with a safe template fallback.
//
// Live calls require ANTHROPIC_API_KEY + network. The prompt builder and response parser
// are pure functions so they can be unit-tested offline.

import { daysOverdue, formatMoney, paymentLink } from "./domain.mjs";

// Cheap + fast model is the right default for short reminders; override via env.
export const DEFAULT_MODEL = process.env.INVOICECHASER_MODEL || "claude-haiku-4-5-20251001";

const URGENCY_GUIDE = {
  1: "ידידותי ורך — תזכורת קלילה, בלי לחץ",
  2: "ידידותי אך ברור — מציינים שעבר זמן, מציעים עזרה",
  3: "ענייני ונחרץ-מעט — תזכורת שנייה, מבקשים הסדרה",
  4: "ענייני ורציני — איחור משמעותי, מבקשים הסדרה, בלי איום",
};

/**
 * Build the system + user prompt for a reminder.
 * Pure function — safe to unit-test.
 * @param {Object} ctx
 * @param {import("./domain.mjs").Invoice} ctx.invoice
 * @param {import("./domain.mjs").BrandProfile} ctx.brand
 * @param {import("./cadence.mjs").CadenceStep} ctx.step
 * @param {Date} ctx.today
 * @param {string[]} [ctx.history]  short notes on prior contact (optional)
 * @returns {{system:string, user:string}}
 */
export function buildPrompt(ctx) {
  const { invoice, brand, step, today } = ctx;
  const lang = invoice.lang || brand.lang || "he";
  const langName = lang === "en" ? "English" : "Hebrew";
  const d = daysOverdue(invoice, today);
  const money = formatMoney(invoice.amount, invoice.currency);
  const url = paymentLink(brand, invoice);

  const system = [
    `You write payment-reminder emails on behalf of "${brand.businessName}".`,
    `Write in ${langName}. Brand tone: ${brand.tone}.`,
    `Goal: get the invoice paid while PRESERVING the client relationship.`,
    `Hard rules:`,
    `- Never threaten, never mention lawsuits/lawyers/debt-collectors/credit bureaus.`,
    `- Be respectful and human; no aggressive or shaming language.`,
    `- Always reference the invoice id and amount, and include the payment link exactly as given.`,
    `- Keep it short (2-5 sentences).`,
    `Escalation level ${step.urgency}/4: ${URGENCY_GUIDE[step.urgency] || URGENCY_GUIDE[2]}.`,
    `Sign as "${brand.signerName}" from "${brand.businessName}".`,
    `Return ONLY JSON: {"subject": "...", "body": "..."} with no extra text.`,
  ].join("\n");

  const user = [
    `Invoice: ${invoice.id}`,
    `Customer: ${invoice.customerName}`,
    `Amount: ${money}`,
    d >= 0 ? `Days overdue: ${d}` : `Due in ${-d} days`,
    `Payment link: ${url}`,
    ctx.history && ctx.history.length ? `Prior contact: ${ctx.history.join("; ")}` : `Prior contact: none`,
  ].join("\n");

  return { system, user };
}

/**
 * Parse the model's text into {subject, body}. Tolerant of code fences / surrounding text.
 * @param {string} text
 * @returns {{subject:string, body:string}|null}
 */
export function parseResponse(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (typeof obj.subject === "string" && typeof obj.body === "string") {
      return { subject: obj.subject.trim(), body: obj.body.trim() };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Call Claude to draft a reminder. Throws on failure (caller falls back to template).
 * @param {Object} ctx  same shape as buildPrompt
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.model]
 * @returns {Promise<{subject:string, body:string}|null>}
 */
export async function draftWithClaude(ctx, { apiKey, fetchImpl, model } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (!apiKey || !doFetch) return null;
  const { system, user } = buildPrompt(ctx);

  const res = await doFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
  const data = await res.json();
  const text = Array.isArray(data.content) ? data.content.map((c) => c.text || "").join("") : "";
  return parseResponse(text);
}
