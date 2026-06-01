// Operator logic — pure functions over a Workspace. This is what lets a founder
// actually *run* a chase manually during the Concierge phase (docs/10 Phase 0):
// build today's outbox, log what was sent, record payments, and measure impact.

import { decideNextAction } from "./cadence.mjs";
import { generateReminderSmart } from "./ai-adapter.mjs";
import { daysOverdue } from "./domain.mjs";

/** Whether a reminder for this invoice+step was already sent (dedupe). */
function alreadySent(ws, invoiceId, stepKey) {
  return ws.events.some((e) => e.type === "sent" && e.invoiceId === invoiceId && e.stepKey === stepKey);
}

/** First 'sent' event for an invoice, or null. */
function firstSent(ws, invoiceId) {
  return ws.events.filter((e) => e.type === "sent" && e.invoiceId === invoiceId).sort((a, b) => a.at.localeCompare(b.at))[0] || null;
}

/**
 * Payment facts for one invoice — the single source of truth for impact AND billing.
 * "creditable" = the invoice was already overdue at the moment of the first reminder
 * and was subsequently paid (i.e. the chase plausibly drove the payment).
 * @param {import("./store.mjs").Workspace} ws
 * @param {import("./domain.mjs").Invoice} inv
 */
export function paymentInfo(ws, inv) {
  const paid = ws.events.find((e) => e.type === "paid" && e.invoiceId === inv.id);
  const fs = firstSent(ws, inv.id);
  if (!paid) return { paid: false, creditable: false, daysToPay: null, firstSentAt: fs ? new Date(fs.at) : null };
  const amount = paid.amount ?? inv.amount;
  const paidAt = new Date(paid.at);
  let daysToPay = null;
  let creditable = false;
  if (fs) {
    daysToPay = Math.max(0, Math.round((paidAt - new Date(fs.at)) / 86400000));
    creditable = daysOverdue(inv, new Date(fs.at)) > 0;
  }
  return { paid: true, amount, paidAt, firstSentAt: fs ? new Date(fs.at) : null, daysToPay, creditable };
}

/**
 * Which invoices have a step due today that wasn't already sent (no drafting).
 * Pure + sync — cheap, used by sent-all and as the basis for the outbox.
 * @param {import("./store.mjs").Workspace} ws
 * @param {Date} today
 * @param {"auto"|"approval"} mode
 * @returns {{invoice:any, decision:any}[]}
 */
export function dueSteps(ws, today, mode = "approval") {
  const out = [];
  for (const invoice of ws.invoices) {
    const decision = decideNextAction(invoice, today, mode);
    if (decision.action !== "send" && decision.action !== "approve") continue;
    if (alreadySent(ws, invoice.id, decision.step.key)) continue; // don't resend the same step
    out.push({ invoice, decision });
  }
  return out;
}

/**
 * Build today's outbox by drafting a reminder for each due step. Uses the LLM when
 * configured (via generateReminderSmart) and falls back to the template otherwise.
 * @param {import("./store.mjs").Workspace} ws
 * @param {Date} today
 * @param {"auto"|"approval"} mode
 * @param {object} [opts]  passed to generateReminderSmart ({apiKey?, fetchImpl?, model?})
 * @returns {Promise<{invoice:any, decision:any, draft:any}[]>}
 */
export async function buildOutbox(ws, today, mode = "approval", opts = {}) {
  const due = dueSteps(ws, today, mode);
  const out = [];
  for (const { invoice, decision } of due) {
    const draft = await generateReminderSmart({ invoice, brand: ws.brand, step: decision.step, today }, opts);
    out.push({ invoice, decision, draft });
  }
  return out;
}

/** Append a 'sent' event (call after you actually send a reminder). Mutates ws. */
export function recordSent(ws, invoiceId, stepKey, at = new Date()) {
  ws.events.push({ type: "sent", invoiceId, stepKey, at: new Date(at).toISOString() });
  return ws;
}

/** Mark an invoice paid. Mutates ws. */
export function markPaid(ws, invoiceId, amount, at = new Date()) {
  const inv = ws.invoices.find((i) => i.id === invoiceId);
  if (inv) inv.status = "paid";
  ws.events.push({ type: "paid", invoiceId, amount, at: new Date(at).toISOString() });
  return ws;
}

/** Mark an invoice disputed (chasing halts automatically). Mutates ws. */
export function markDisputed(ws, invoiceId, at = new Date()) {
  const inv = ws.invoices.find((i) => i.id === invoiceId);
  if (inv) inv.status = "disputed";
  ws.events.push({ type: "disputed", invoiceId, at: new Date(at).toISOString() });
  return ws;
}

/**
 * Compute impact metrics — the proof of value and the basis for success-fee
 * (docs/06 §6.6, docs/07 §7.7). "Creditable" = was overdue when first chased and
 * then paid after the first reminder.
 * @param {import("./store.mjs").Workspace} ws
 * @param {Date} today
 */
export function computeImpact(ws, today) {
  let collected = 0;
  let creditable = 0;
  let creditableCount = 0;
  let daysToPaySum = 0;
  let daysToPayN = 0;

  for (const inv of ws.invoices) {
    const p = paymentInfo(ws, inv);
    if (!p.paid) continue;
    collected += p.amount;
    if (p.daysToPay !== null) {
      daysToPaySum += p.daysToPay;
      daysToPayN++;
    }
    if (p.creditable) {
      creditable += p.amount;
      creditableCount++;
    }
  }

  const openOverdue = ws.invoices.filter((i) => i.status === "open" && daysOverdue(i, today) > 0);

  return {
    collected,
    creditable,
    creditableCount,
    avgDaysToPay: daysToPayN ? Math.round(daysToPaySum / daysToPayN) : null,
    openOverdueAmount: openOverdue.reduce((s, i) => s + i.amount, 0),
    openOverdueCount: openOverdue.length,
    remindersSent: ws.events.filter((e) => e.type === "sent").length,
  };
}
