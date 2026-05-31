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
import { loadWorkspace, saveWorkspace, emptyWorkspace } from "./store.mjs";
import { buildOutbox, recordSent, markPaid, markDisputed, computeImpact } from "./operator.mjs";
import { exportOutbox } from "./outbox-export.mjs";
import { formatMoney } from "./domain.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const pos = argv.slice(1).filter((a) => !a.startsWith("--"));
const flag = (name, def) => {
  const f = argv.find((a) => a.startsWith(`--${name}=`));
  return f ? f.slice(name.length + 3) : def;
};
const dateFlag = (name) => (flag(name) ? new Date(flag(name)) : new Date());

function usage() {
  console.error("commands: import | outbox | sent-all | sent | pay | dispute | impact");
  process.exit(1);
}

const wsPath = pos[0];
if (!cmd || !wsPath) usage();

switch (cmd) {
  case "import": {
    const csv = pos[1];
    const ws = loadWorkspace(wsPath).invoices ? loadWorkspace(wsPath) : emptyWorkspace();
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
    const outbox = buildOutbox(ws, today, mode);
    console.log(`📬 Outbox ל-${today.toISOString().slice(0, 10)} (${mode}) — ${outbox.length} הודעות:\n`);
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

  case "sent-all": {
    const ws = loadWorkspace(wsPath);
    const today = dateFlag("today");
    const outbox = buildOutbox(ws, today, flag("mode", "approval"));
    for (const { invoice, decision } of outbox) recordSent(ws, invoice.id, decision.step.key, today);
    saveWorkspace(wsPath, ws);
    console.log(`✓ תועדו ${outbox.length} שליחות (${today.toISOString().slice(0, 10)})`);
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
