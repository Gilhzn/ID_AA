// Zero-dependency test runner for the InvoiceChaser core.
// Run with: node test/run-tests.mjs

import assert from "node:assert/strict";
import { daysOverdue, formatMoney } from "../src/domain.mjs";
import { decideNextAction, DEFAULT_CADENCE } from "../src/cadence.mjs";
import { enforceGuardrails } from "../src/guardrails.mjs";
import { generateReminder } from "../src/generator.mjs";
import { parseCsv, rowsToInvoices } from "../src/csv.mjs";
import { renderReport } from "../src/report.mjs";
import { emptyWorkspace } from "../src/store.mjs";
import { buildOutbox, dueSteps, recordSent, markPaid, markDisputed, computeImpact } from "../src/operator.mjs";
import { buildPrompt, parseResponse } from "../src/llm-claude.mjs";
import { generateReminderSmart } from "../src/ai-adapter.mjs";
import { DEFAULT_CADENCE as CAD } from "../src/cadence.mjs";

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
async function testAsync(name, fn) {
  try {
    await fn();
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

console.log("operator:");
function wsWith(invoices) {
  const ws = emptyWorkspace({ businessName: "Test", signerName: "רותם", replyTo: "x@test.example" });
  ws.invoices = invoices;
  return ws;
}
test("dueSteps dedupes a step once it was sent", () => {
  const ws = wsWith([inv(7)]);
  const t = today(7);
  let due = dueSteps(ws, t, "auto");
  assert.equal(due.length, 1);
  assert.equal(due[0].decision.step.key, "overdue_7");
  recordSent(ws, "INV-1", "overdue_7", t);
  due = dueSteps(ws, t, "auto"); // same day, same step -> nothing new
  assert.equal(due.length, 0);
});
test("disputed invoice never enters dueSteps", () => {
  const ws = wsWith([inv(7)]);
  markDisputed(ws, "INV-1", today(7));
  assert.equal(dueSteps(ws, today(7), "auto").length, 0);
});
test("impact credits an overdue invoice paid after first reminder", () => {
  const ws = wsWith([inv(7)]);
  recordSent(ws, "INV-1", "overdue_7", today(7)); // chased while overdue
  markPaid(ws, "INV-1", 18000, today(12)); // paid 5 days later
  const m = computeImpact(ws, today(12));
  assert.equal(m.collected, 18000);
  assert.equal(m.creditable, 18000);
  assert.equal(m.creditableCount, 1);
  assert.equal(m.avgDaysToPay, 5);
});

// Fake Anthropic fetch that returns a given assistant text in the API's shape.
const fakeFetch = (assistantText, ok = true, status = 200) => async () => ({
  ok,
  status,
  json: async () => ({ content: [{ type: "text", text: assistantText }] }),
});

const step7 = CAD.find((s) => s.key === "overdue_7");

await (async () => {
  console.log("llm (offline):");

  test("buildPrompt includes rules, invoice id, amount and payment link", () => {
    const { system, user } = buildPrompt({ invoice: inv(), brand: BRAND, step: step7, today: today(7) });
    assert.ok(/never threaten/i.test(system));
    assert.ok(system.includes("JSON"));
    assert.ok(user.includes("INV-1"));
    assert.ok(user.includes("₪18,000"));
    assert.ok(/pay\.invoicechaser\.app/.test(user));
    assert.ok(/Days overdue: 7/.test(user));
  });

  test("parseResponse extracts JSON from fenced / noisy text", () => {
    const r = parseResponse('```json\n{"subject":"S","body":"B"}\n``` thanks');
    assert.equal(r.subject, "S");
    assert.equal(r.body, "B");
    assert.equal(parseResponse("no json here"), null);
  });

  await testAsync("generateReminderSmart uses LLM output when guardrails pass", async () => {
    const text = '{"subject":"תזכורת על חשבונית INV-1","body":"היי מאיה, רצינו להזכיר בעדינות..."}';
    const d = await generateReminderSmart(
      { invoice: inv(), brand: BRAND, step: step7, today: today(7) },
      { apiKey: "test-key", fetchImpl: fakeFetch(text) }
    );
    assert.equal(d.source, "llm");
    assert.ok(d.body.includes("מאיה"));
    assert.equal(d.guardrailViolations.length, 0);
  });

  await testAsync("falls back to template when LLM output violates guardrails", async () => {
    const bad = '{"subject":"x","body":"שלם או שננקוט בהוצאה לפועל נגדך"}';
    const d = await generateReminderSmart(
      { invoice: inv(), brand: BRAND, step: step7, today: today(7) },
      { apiKey: "test-key", fetchImpl: fakeFetch(bad) }
    );
    assert.equal(d.source, "template");
    assert.equal(d.guardrailViolations.length, 0); // template copy is clean
  });

  await testAsync("falls back to template on API error", async () => {
    const d = await generateReminderSmart(
      { invoice: inv(), brand: BRAND, step: step7, today: today(7) },
      { apiKey: "test-key", fetchImpl: fakeFetch("", false, 500) }
    );
    assert.equal(d.source, "template");
  });

  await testAsync("uses template when no API key is configured", async () => {
    const d = await generateReminderSmart({ invoice: inv(), brand: BRAND, step: step7, today: today(7) });
    assert.equal(d.source, "template");
  });

  await testAsync("buildOutbox drafts due reminders (template fallback offline)", async () => {
    const ws = wsWith([inv(7)]);
    const box = await buildOutbox(ws, today(7), "auto");
    assert.equal(box.length, 1);
    assert.ok(box[0].draft.body.includes("מאיה"));
    assert.equal(box[0].draft.source, "template");
  });

  console.log(`\n${passed} checks passed.`);
})();
