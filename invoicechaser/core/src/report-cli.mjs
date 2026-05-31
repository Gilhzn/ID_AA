#!/usr/bin/env node
// Generate the standalone HTML "cash-flow recovery" report from a CSV.
// Usage:
//   node src/report-cli.mjs <invoices.csv> <out.html> [--today=YYYY-MM-DD]

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv, rowsToInvoices } from "./csv.mjs";
import { renderReport } from "./report.mjs";

// Demo brand (in the product this comes from Account settings).
const BRAND = {
  businessName: "Pixel & Co. Agency",
  lang: "he",
  tone: "friendly",
  signerName: "רותם",
  replyTo: "billing@pixelco.example",
  paymentBaseUrl: "https://pay.invoicechaser.app",
};

const args = process.argv.slice(2);
const inputCsv = args.find((a) => a.endsWith(".csv"));
const out = args.find((a) => a.endsWith(".html")) || "report.html";
const todayArg = args.find((a) => a.startsWith("--today="));
const today = todayArg ? new Date(todayArg.slice("--today=".length)) : new Date();

if (!inputCsv) {
  console.error("usage: node src/report-cli.mjs <invoices.csv> <out.html> [--today=YYYY-MM-DD]");
  process.exit(1);
}

const invoices = rowsToInvoices(parseCsv(readFileSync(inputCsv, "utf8")));
const html = renderReport(invoices, BRAND, today);
writeFileSync(out, html, "utf8");
console.log(`✓ דוח נוצר: ${out}  (${invoices.length} חשבוניות, נכון ל-${today.toISOString().slice(0, 10)})`);
