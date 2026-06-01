#!/usr/bin/env node
// InvoiceChaser core demo CLI.
// Loads invoices from a CSV, and for each one decides the next action and drafts the
// reminder the AI Dunning Engine would send. Runs fully offline.
//
// Usage:
//   node src/cli.mjs samples/invoices.csv [--today=YYYY-MM-DD] [--mode=auto|approval]

import { readFileSync } from "node:fs";
import { parseCsv, rowsToInvoices } from "./csv.mjs";
import { decideNextAction } from "./cadence.mjs";
import { generateReminderSmart } from "./ai-adapter.mjs";
import { daysOverdue, formatMoney } from "./domain.mjs";

/** Demo brand profile (in the product this comes from the Account settings). */
const BRAND = {
  businessName: "Pixel & Co. Agency",
  lang: "he",
  tone: "friendly",
  signerName: "רותם",
  replyTo: "billing@pixelco.example",
  paymentBaseUrl: "https://pay.invoicechaser.app",
};

function parseArgs(argv) {
  const args = { file: null, today: new Date(), mode: "approval" };
  for (const a of argv) {
    if (a.startsWith("--today=")) args.today = new Date(a.slice("--today=".length));
    else if (a.startsWith("--mode=")) args.mode = a.slice("--mode=".length);
    else if (!a.startsWith("--")) args.file = a;
  }
  return args;
}

const ACTION_LABEL = {
  send: "📤 שליחה אוטומטית",
  approve: "🙋 ממתין לאישורך (הסלמה)",
  wait: "⏳ עוד לא בזמן",
  stop: "⛔ עצירה",
};

function main() {
  const { file, today, mode } = parseArgs(process.argv.slice(2));
  if (!file) {
    console.error("usage: node src/cli.mjs <invoices.csv> [--today=YYYY-MM-DD] [--mode=auto|approval]");
    process.exit(1);
  }

  const invoices = rowsToInvoices(parseCsv(readFileSync(file, "utf8")));

  console.log("══════════════════════════════════════════════════════════════");
  console.log(` InvoiceChaser — תוכנית גבייה ל-${BRAND.businessName}`);
  console.log(` תאריך הרצה: ${today.toISOString().slice(0, 10)}  |  מצב: ${mode}`);
  console.log("══════════════════════════════════════════════════════════════\n");

  let totalOpen = 0;
  let totalOverdue = 0;
  let toSend = 0;
  let toApprove = 0;

  // generateReminderSmart is async (LLM-ready); resolve sequentially for readable output.
  const run = async () => {
    for (const inv of invoices) {
      const d = daysOverdue(inv, today);
      const decision = decideNextAction(inv, today, mode);

      if (inv.status === "open") {
        totalOpen += inv.amount;
        if (d > 0) totalOverdue += inv.amount;
      }

      console.log("──────────────────────────────────────────────────────────");
      console.log(
        `חשבונית ${inv.id} · ${inv.customerName} · ${formatMoney(inv.amount, inv.currency)} · ` +
          `${d >= 0 ? `+${d} ימים` : `${d} ימים`} · סטטוס: ${inv.status}`
      );
      console.log(`פעולה: ${ACTION_LABEL[decision.action]}  (${decision.reason})`);

      if (decision.action === "send" || decision.action === "approve") {
        if (decision.action === "approve") toApprove++;
        else toSend++;
        const draft = await generateReminderSmart({ invoice: inv, brand: BRAND, step: decision.step, today });
        console.log(`\n  נושא: ${draft.subject}   [${draft.source}]`);
        console.log(
          draft.body
            .split("\n")
            .map((l) => "  | " + l)
            .join("\n")
        );
        if (draft.guardrailViolations.length) {
          console.log(`  ⚠️ guardrails: ${draft.guardrailViolations.join(", ")}`);
        }
      }
      console.log("");
    }

    console.log("══════════════════════════════════════════════════════════════");
    console.log(" סיכום");
    console.log(`  סך פתוח: ${formatMoney(totalOpen, "ILS")}  |  מתוכו באיחור: ${formatMoney(totalOverdue, "ILS")}`);
    console.log(`  לשליחה אוטומטית: ${toSend}  |  ממתין לאישורך: ${toApprove}`);
    console.log("══════════════════════════════════════════════════════════════");
  };

  run();
}

main();
