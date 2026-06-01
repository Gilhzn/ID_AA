#!/usr/bin/env node
// InvoiceChaser operator — run a real chase manually during the Concierge phase.
// Stateful (JSON workspace file), fully offline.
//
// Commands:
//   import   <ws.json> <invoices.csv> [--name=..] [--signer=..] [--reply=..]
//   outbox   <ws.json> [--today=YYYY-MM-DD] [--mode=auto|approval] [--out=dir]
//   sent-all <ws.json> [--today=YYYY-MM-DD] [--mode=auto|approval]
//   sent     <ws.json> <invoiceId> <stepKey> [--today=YYYY-MM-DD]
//   pay      <ws.json> <invoiceId> [amount] [--at=YYYY-MM-DD]
//   dispute  <ws.json> <invoiceId>
//   impact   <ws.json> [--today=YYYY-MM-DD]

import { readFileSync } from "node:fs";
import { parseCsv, rowsToInvoices } from "./csv.mjs";
import { loadWorkspace, saveWorkspace } from "./store.mjs";
import { buildOutbox, dueSteps, recordSent, markPaid, markDisputed, computeImpact } from "./operator.mjs";
import { exportOutbox } from "./outbox-export.mjs";
import { computeBilling, renderStatement } from "./billing.mjs";
import { sendEmail } from "./email.mjs";
import { formatMoney } from "./domain.mjs";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));
const flag = (name, def) => {
  const f = argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : def;
};
const dateFlag = (name) => (flag(name) ? new Date(flag(name)) : new Date());

function usage() {
  console.error("commands: import | outbox | send | sent-all | sent | pay | dispute | impact | bill");
  process.exit(1);
}

const wsPath = pos[0];
if (!cmd || !wsPath) usage();

switch (cmd) {
  case "import": {
    const csv = pos[1];
    const ws = loadWorkspace(wsPath); // returns an empty workspace if the file doesn't exist yet
    ws.brand.businessName = flag("name", ws.brand.businessName);
    ws.brand.signerName = flag("signer", ws.brand.signerName);
    ws.brand.replyTo = flag("reply", ws.brand.replyTo);
    const imported = rowsToInvoices(parseCsv(readFileSync(csv, "utf8")));
    const existing = new Set(ws.invoices.map((i) => i.id));
    for (const inv of imported) {
      if (!existing.has(inv.id)) {
        ws.invoices.push(inv);
        ws.events.push({ type: "imported", invoiceId: inv.id, at: new Date().toISOString() });
      }
    }
    saveWorkspace(wsPath, ws);
    console.log(`✓ ייבוא: ${imported.length} חשבוניות (${ws.invoices.length} סה"כ ב-${wsPath})`);
    break;
  }

  case "outbox": {
    const ws = loadWorkspace(wsPath);
    const today = dateFlag("today");
    const mode = flag("mode", "approval");
    const outbox = await buildOutbox(ws, today, mode); // uses Claude if ANTHROPIC_API_KEY is set
    const src = outbox[0]?.draft?.source ? ` [ניסוח: ${outbox[0].draft.source}]` : "";
    console.log(`📬 Outbox ל-${today.toISOString().slice(0, 10)} (${mode})${src} — ${outbox.length} הודעות:\n`);
    for (const { invoice, decision, draft } of outbox) {
      const flagTxt = decision.action === "approve" ? " ⚠️ אישור" : "";
      console.log(`• ${invoice.id} → ${invoice.customerName} [${decision.step.key}]${flagTxt}: ${draft.subject}`);
    }
    const outDir = flag("out");
    if (outDir) {
      const res = exportOutbox(outDir, outbox, ws, today);
      console.log(`\n✓ יוצאו ${res.count} קבצי .eml ל-${res.dir} (כולל index.md)`);
    } else {
      console.log(`\n(הוסף --out=dir כדי לייצא קבצי .eml מוכנים-לשליחה)`);
    }
    break;
  }

  case "send": {
    // Build today's outbox, send each (dry-run unless --live), and log the send.
    const ws = loadWorkspace(wsPath);
    const today = dateFlag("today");
    const mode = flag("mode", "approval");
    const live = argv.includes("--live");
    const outbox = await buildOutbox(ws, today, mode);
    let sentCount = 0;
    for (const { invoice, decision, draft } of outbox) {
      if (decision.action === "approve" && !argv.includes("--yes")) {
        console.log(`⏭️  דילוג (דורש אישור): ${invoice.id} — הוסף --yes לשליחת הסלמות`);
        continue;
      }
      const r = await sendEmail(
        { to: invoice.customerEmail, toName: invoice.customerName, fromName: ws.brand.businessName, subject: draft.subject, body: draft.body },
        { live, from: ws.brand.replyTo }
      );
      // Only log a 'sent' event when a real email actually went out (dry-run is preview-only).
      if (r.sent) {
        recordSent(ws, invoice.id, decision.step.key, today);
        sentCount++;
      }
      const tag = r.sent ? "📧 נשלח" : r.dryRun ? "📝 dry-run (תצוגה מקדימה)" : `⚠️ ${r.error}`;
      console.log(`${tag}: ${invoice.id} → ${invoice.customerEmail} (${decision.step.key})`);
    }
    saveWorkspace(wsPath, ws);
    console.log(
      live
        ? `\n✓ נשלחו ותועדו ${sentCount} הודעות (LIVE)`
        : `\n📝 תצוגה-מקדימה בלבד (לא תועד). --live לשליחה אמיתית, או 'sent-all' לתיעוד ידני.`
    );
    break;
  }

  case "bill": {
    const ws = loadWorkspace(wsPath);
    const stmt = computeBilling(ws, {
      ratePct: Number(flag("rate", "12")),
      from: flag("from"),
      to: flag("to"),
    });
    console.log("══ חיוב (success-fee) ══");
    console.log(`  תקופה: ${stmt.from || "התחלה"} — ${stmt.to || "היום"}  |  שיעור: ${stmt.ratePct}%`);
    for (const li of stmt.lineItems) {
      console.log(`   ${li.creditable ? "✓" : "·"} ${li.invoiceId} ${li.customerName} · ${formatMoney(li.amount, li.currency)} · ${li.paidAt} · עמלה ${formatMoney(li.fee, li.currency)}`);
    }
    console.log(`  סך מזכה: ${formatMoney(stmt.creditableTotal, stmt.currency)}`);
    console.log(`  לחיוב: ${formatMoney(stmt.fee, stmt.currency)}`);
    const out = flag("out");
    if (out) {
      writeFileSync(out, renderStatement(stmt), "utf8");
      console.log(`  ✓ דוח HTML: ${out}`);
    }
    break;
  }

  case "sent-all": {
    const ws = loadWorkspace(wsPath);
    const today = dateFlag("today");
    const due = dueSteps(ws, today, flag("mode", "approval")); // no drafting needed to log sends
    for (const { invoice, decision } of due) recordSent(ws, invoice.id, decision.step.key, today);
    saveWorkspace(wsPath, ws);
    console.log(`✓ תועדו ${due.length} שליחות (${today.toISOString().slice(0, 10)})`);
    break;
  }

  case "sent": {
    const ws = loadWorkspace(wsPath);
    recordSent(ws, pos[1], pos[2], dateFlag("today"));
    saveWorkspace(wsPath, ws);
    console.log(`✓ תועדה שליחה: ${pos[1]} / ${pos[2]}`);
    break;
  }

  case "pay": {
    const ws = loadWorkspace(wsPath);
    const amount = pos[2] ? Number(pos[2]) : undefined;
    markPaid(ws, pos[1], amount, dateFlag("at"));
    saveWorkspace(wsPath, ws);
    console.log(`✓ סומן כשולם: ${pos[1]}${amount ? " · " + amount : ""}`);
    break;
  }

  case "dispute": {
    const ws = loadWorkspace(wsPath);
    markDisputed(ws, pos[1], dateFlag("at"));
    saveWorkspace(wsPath, ws);
    console.log(`✓ סומן במחלוקת (הרדיפה נעצרת): ${pos[1]}`);
    break;
  }

  case "impact": {
    const ws = loadWorkspace(wsPath);
    const m = computeImpact(ws, dateFlag("today"));
    console.log("══ Impact ══");
    console.log(`  נגבה (סה"כ):        ${formatMoney(m.collected, ws.invoices[0]?.currency || "ILS")}`);
    console.log(`  נגבה ע"י המערכת:    ${formatMoney(m.creditable, ws.invoices[0]?.currency || "ILS")}  (${m.creditableCount} חשבוניות)`);
    console.log(`  ימים-ממוצע-עד-תשלום: ${m.avgDaysToPay ?? "—"}`);
    console.log(`  עדיין פתוח באיחור:  ${formatMoney(m.openOverdueAmount, ws.invoices[0]?.currency || "ILS")} (${m.openOverdueCount})`);
    console.log(`  תזכורות שנשלחו:     ${m.remindersSent}`);
    break;
  }

  default:
    usage();
}
