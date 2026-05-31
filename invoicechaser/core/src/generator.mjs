// Reminder generator — turns (invoice + brand + step) into a personalized message.
//
// This is the offline, deterministic implementation of the AI Dunning Engine's
// `generateReminder(context)` interface (invoicechaser/docs/05 §5.6). It proves the
// tone/escalation/personalization logic without any external API, and it doubles as
// the safe fallback when no LLM is configured. A real LLM adapter (ai-adapter.mjs)
// can replace the drafting while reusing the same context + guardrails.

import { formatMoney, daysOverdue, paymentLink } from "./domain.mjs";
import { enforceGuardrails } from "./guardrails.mjs";

/**
 * @typedef {Object} ReminderDraft
 * @property {string} subject
 * @property {string} body
 * @property {1|2|3|4} urgency
 * @property {string} channel        "email" for MVP
 * @property {string[]} guardrailViolations
 */

// Subject + opening lines per language and urgency. Friendly -> firm, never abusive.
const COPY = {
  he: {
    subject: (inv, u) =>
      u <= 1
        ? `תזכורת קטנה — חשבונית ${inv.id}`
        : u === 2
        ? `חשבונית ${inv.id} עדיין פתוחה`
        : u === 3
        ? `תזכורת שנייה — חשבונית ${inv.id} באיחור`
        : `הודעה לגבי חשבונית ${inv.id} באיחור`,
    greeting: (name) => `היי ${name},`,
    line: (inv, u, days, money) =>
      u <= 1
        ? days < 0
          ? `רצינו רק להזכיר שחשבונית ${inv.id} על סך ${money} מגיעה לתשלום בקרוב.`
          : `רצינו להזכיר בעדינות שחשבונית ${inv.id} על סך ${money} מגיעה לתשלום היום.`
        : u === 2
        ? `שמנו לב שחשבונית ${inv.id} על סך ${money} עדיין פתוחה (${days} ימים). אם משהו תקוע — נשמח לעזור.`
        : u === 3
        ? `זוהי תזכורת שנייה: חשבונית ${inv.id} על סך ${money} באיחור של ${days} ימים. נשמח להסדרה.`
        : `חשבונית ${inv.id} על סך ${money} באיחור של ${days} ימים. נודה להסדרת התשלום, ואם יש בעיה — נשמח לדבר.`,
    cta: (url) => `לתשלום מאובטח בקליק: ${url}`,
    signoff: (brand) => `תודה,\n${brand.signerName}\n${brand.businessName}`,
  },
  en: {
    subject: (inv, u) =>
      u <= 1
        ? `Quick reminder — invoice ${inv.id}`
        : u === 2
        ? `Invoice ${inv.id} is still open`
        : u === 3
        ? `Second reminder — invoice ${inv.id} overdue`
        : `Regarding overdue invoice ${inv.id}`,
    greeting: (name) => `Hi ${name},`,
    line: (inv, u, days, money) =>
      u <= 1
        ? days < 0
          ? `Just a friendly reminder that invoice ${inv.id} for ${money} is due soon.`
          : `A gentle reminder that invoice ${inv.id} for ${money} is due today.`
        : u === 2
        ? `We noticed invoice ${inv.id} for ${money} is still open (${days} days). If anything's holding it up, happy to help.`
        : u === 3
        ? `Second reminder: invoice ${inv.id} for ${money} is ${days} days overdue. We'd appreciate settling it.`
        : `Invoice ${inv.id} for ${money} is ${days} days overdue. We'd appreciate payment, and if there's an issue we're glad to talk.`,
    cta: (url) => `Pay securely in one click: ${url}`,
    signoff: (brand) => `Thanks,\n${brand.signerName}\n${brand.businessName}`,
  },
};

/**
 * Generate a reminder draft for an invoice at a given cadence step.
 * Applies guardrails before returning (docs/05 §5.4).
 *
 * @param {Object} ctx
 * @param {import("./domain.mjs").Invoice} ctx.invoice
 * @param {import("./domain.mjs").BrandProfile} ctx.brand
 * @param {import("./cadence.mjs").CadenceStep} ctx.step
 * @param {Date} ctx.today
 * @returns {ReminderDraft}
 */
export function generateReminder({ invoice, brand, step, today }) {
  const lang = invoice.lang || brand.lang || "he";
  const c = COPY[lang] || COPY.he;
  const u = step.urgency;
  const days = daysOverdue(invoice, today);
  const money = formatMoney(invoice.amount, invoice.currency);
  const url = paymentLink(brand, invoice);

  const subject = c.subject(invoice, u);
  const rawBody = [
    c.greeting(invoice.customerName),
    "",
    c.line(invoice, u, days, money),
    "",
    c.cta(url),
    "",
    c.signoff(brand),
  ].join("\n");

  const guard = enforceGuardrails(rawBody, u);

  return {
    subject,
    body: guard.body,
    urgency: u,
    channel: "email",
    guardrailViolations: guard.violations,
  };
}
