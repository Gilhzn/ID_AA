// Operator logic — pure functions over a Workspace. This is what lets a founder
// actually *run* a chase manually during the Concierge phase (docs/10 Phase 0):
// build today's outbox, log what was sent, record payments, and measure impact.

import { decideNextAction } from "./cadence.mjs";
import { generateReminder } from "./generator.mjs";
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
 * Build today's outbox: the reminders that are due and not yet sent for their step.
 * Disputed/paid invoices are skipped by the cadence engine.
 * @param {import("./store.mjs").Workspace} ws
 * @param {Date} today
 * @param {"auto"|"approval"} mode
 * @returns {{invoice:any, decision:any, draft:any}[]}
 */
export function buildOutbox(ws, today, mode = "approval") {
  const out = [];
  for (const invoice of ws.invoices) {
    const decision = decideNextAction(invoice, today, mode);
    if (decision.action !== "send" && decision.action !== "approve") continue;
    if (alreadySent(ws, invoice.id, decision.step.key)) continue; // don't resend the same step
    const draft = generateReminder({ invoice, brand: ws.brand, step: decision.step, today });
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
  const DAY = 86400000;
  let collected = 0;
  let creditable = 0;
  let creditableCount = 0;
  let daysToPaySum = 0;
  let daysToPayN = 0;

  for (const inv of ws.invoices) {
    const paid = ws.events.find((e) => e.type === "paid" && e.invoiceId === inv.id);
    if (!paid) continue;
    const amount = paid.amount ?? inv.amount;
    collected += amount;

    const fs = firstSent(ws, inv.id);
    if (fs) {
      const dtp = Math.max(0, Math.round((new Date(paid.at) - new Date(fs.at)) / DAY));
      daysToPaySum += dtp;
      daysToPayN++;
      // Creditable if the invoice was already overdue at the moment of the first reminder.
      if (daysOverdue(inv, new Date(fs.at)) > 0) {
        creditable += amount;
        creditableCount++;
      }
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
