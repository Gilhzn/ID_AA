// Export today's outbox to ready-to-send .eml files + a copy-paste index.
// Bridges the engine to real sending during Concierge: open the .eml in your mail
// client, or copy the text into Gmail — no email API needed yet.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Build a minimal RFC-822 .eml string for a drafted reminder. */
export function toEml(invoice, brand, draft, date = new Date()) {
  const to = `${invoice.customerName} <${invoice.customerEmail}>`;
  const from = `${brand.businessName} <${brand.replyTo || "billing@example.com"}>`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${draft.subject}`,
    `Date: ${date.toUTCString()}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    draft.body,
    ``,
  ].join("\r\n");
}

/**
 * Write the outbox to `dir`: one .eml per message + index.md summary.
 * @param {string} dir
 * @param {{invoice:any, decision:any, draft:any}[]} outbox
 * @param {import("./store.mjs").Workspace} ws
 * @param {Date} today
 * @returns {{count:number, dir:string}}
 */
export function exportOutbox(dir, outbox, ws, today) {
  mkdirSync(dir, { recursive: true });
  const lines = [`# Outbox — ${ws.brand.businessName} — ${today.toISOString().slice(0, 10)}`, ""];

  outbox.forEach(({ invoice, decision, draft }, i) => {
    const fname = `${String(i + 1).padStart(2, "0")}-${invoice.id}.eml`;
    writeFileSync(join(dir, fname), toEml(invoice, ws.brand, draft, today), "utf8");
    const flag = decision.action === "approve" ? " ⚠️ דורש אישורך" : "";
    lines.push(
      `## ${i + 1}. ${invoice.id} → ${invoice.customerName}${flag}`,
      `**אל:** ${invoice.customerEmail}  ·  **נושא:** ${draft.subject}`,
      "",
      "```",
      draft.body,
      "```",
      ""
    );
  });

  if (outbox.length === 0) lines.push("_אין הודעות לשליחה היום._");
  writeFileSync(join(dir, "index.md"), lines.join("\n"), "utf8");
  return { count: outbox.length, dir };
}
