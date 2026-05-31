// Zero-dependency test runner for the InvoiceChaser core.
// Run with: node test/run-tests.mjs

import assert from "node:assert/strict";
import { daysOverdue, formatMoney } from "../src/domain.mjs";
import { decideNextAction, DEFAULT_CADENCE } from "../src/cadence.mjs";
import { enforceGuardrails } from "../src/guardrails.mjs";
import { generateReminder } from "../src/generator.mjs";
import { parseCsv, rowsToInvoices } from "../src/csv.mjs";
import { renderReport } from "../src/report.mjs";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const BRAND = {
  businessName: "Test Agency",
  lang: "he",
  tone: "friendly",
  signerName: "רותם",
  replyTo: "x@test.example",
};

const inv = (over, status = "open", lang = "he") => ({
  id: "INV-1",
  customerName: "מאיה",
  customerEmail: "a@b.example",
  amount: 18000,
  currency: "ILS",
  issueDate: new Date("2026-01-01"),
  dueDate: new Date("2026-05-01"),
  status,
  lang,
});
const today = (daysAfterDue) => new Date(2026, 4, 1 + daysAfterDue); // May=4

console.log("domain:");
test("daysOverdue computes calendar days", () => {
  assert.equal(daysOverdue(inv(), today(7)), 7);
  assert.equal(daysOverdue(inv(), today(0)), 0);
  assert.equal(daysOverdue(inv(), today(-3)), -3);
});
test("formatMoney uses currency symbol", () => {
  assert.equal(formatMoney(18000, "ILS"), "₪18,000");
  assert.equal(formatMoney(9500, "USD"), "$9,500");
});

console.log("cadence:");
test("stops on paid and disputed", () => {
  assert.equal(decideNextAction(inv(7, "paid"), today(7), "auto").action, "stop");
  assert.equal(decideNextAction(inv(7, "disputed"), today(7), "auto").action, "stop");
});
test("waits before first step", () => {
  assert.equal(decideNextAction(inv(), today(-10), "auto").action, "wait");
});
test("sends in auto mode when a step is due", () => {
  const r = decideNextAction(inv(), today(7), "auto");
  assert.equal(r.action, "send");
  assert.equal(r.step.key, "overdue_7");
});
test("final notice always needs approval, even in auto mode", () => {
  const r = decideNextAction(inv(), today(30), "auto");
  assert.equal(r.action, "approve");
  assert.equal(r.step.urgency, 4);
});
test("approval mode forces approve on any step", () => {
  assert.equal(decideNextAction(inv(), today(7), "approval").action, "approve");
});

console.log("guardrails:");
test("blocks threatening language", () => {
  const r = enforceGuardrails("we will take legal action", 3);
  assert.equal(r.ok, false);
  assert.ok(r.violations.length >= 1);
});
test("blocks Hebrew legal-threat phrasing", () => {
  assert.equal(enforceGuardrails("ננקוט בהוצאה לפועל נגדך", 4).ok, false);
});
test("clean message passes and collapses shouting", () => {
  const r = enforceGuardrails("תודה רבה!!!", 2);
  assert.equal(r.ok, true);
  assert.equal(r.body.includes("!!!"), false);
});

console.log("generator:");
test("generates personalized Hebrew reminder with payment link and no violations", () => {
  const step = DEFAULT_CADENCE.find((s) => s.key === "overdue_7");
  const d = generateReminder({ invoice: inv(), brand: BRAND, step, today: today(7) });
  assert.ok(d.subject.includes("INV-1"));
  assert.ok(d.body.includes("מאיה"));
  assert.ok(d.body.includes("₪18,000"));
  assert.ok(/pay\.invoicechaser\.app/.test(d.body));
  assert.equal(d.guardrailViolations.length, 0);
});
test("escalation changes the subject tone across steps", () => {
  const s1 = generateReminder({ invoice: inv(), brand: BRAND, step: DEFAULT_CADENCE[1], today: today(0) }).subject;
  const s4 = generateReminder({ invoice: inv(), brand: BRAND, step: DEFAULT_CADENCE[4], today: today(30) }).subject;
  assert.notEqual(s1, s4);
});
test("English invoice produces English copy", () => {
  const step = DEFAULT_CADENCE.find((s) => s.key === "overdue_7");
  const d = generateReminder({ invoice: inv(7, "open", "en"), brand: BRAND, step, today: today(7) });
  assert.ok(/reminder|overdue|open/i.test(d.subject));
});

console.log("csv:");
test("parses quoted CSV and maps to invoices", () => {
  const text = 'id,customerName,customerEmail,amount,currency,issueDate,dueDate,status,lang\nINV-9,"Doe, Jane",j@x.example,1000,USD,2026-01-01,2026-02-01,open,en';
  const invs = rowsToInvoices(parseCsv(text));
  assert.equal(invs.length, 1);
  assert.equal(invs[0].customerName, "Doe, Jane");
  assert.equal(invs[0].amount, 1000);
});

console.log("report:");
test("renders standalone RTL HTML with per-currency totals and no banned phrases", () => {
  const invoices = [
    inv(30, "open", "he"),
    { ...inv(46, "open", "en"), id: "INV-2", currency: "USD", amount: 9500 },
    { ...inv(2, "disputed", "he"), id: "INV-3" },
  ];
  const html = renderReport(invoices, BRAND, today(30));
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(html.includes("דוח שחזור תזרים"));
  assert.ok(html.includes("₪18,000")); // ILS total
  assert.ok(html.includes("$9,500")); // USD total kept separate (no bad cross-currency sum)
  assert.ok(!/legal action|תביעה משפטית/.test(html)); // guardrails hold in samples
});

console.log(`\n${passed} checks passed.`);
