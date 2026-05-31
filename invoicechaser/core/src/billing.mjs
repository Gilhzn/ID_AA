// Success-fee billing — turns collected invoices into a monthly statement the
// founder can charge the agency for (docs/07 §7.3, gtm/03). Fee applies only to
// "creditable" invoices: overdue when first chased, then paid within the period.

import { paymentInfo } from "./operator.mjs";
import { formatMoney } from "./domain.mjs";

/** Is an ISO/date within [from, to] inclusive (either bound optional)? */
function inPeriod(date, from, to) {
  const t = new Date(date).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime()) return false;
  return true;
}

/**
 * Compute a billing statement for a period.
 * @param {import("./store.mjs").Workspace} ws
 * @param {Object} opts
 * @param {number} [opts.ratePct]   success-fee percent (default 12)
 * @param {string} [opts.from]      ISO date (inclusive)
 * @param {string} [opts.to]        ISO date (inclusive)
 * @returns {Object}
 */
export function computeBilling(ws, { ratePct = 12, from, to } = {}) {
  const lineItems = [];
  let creditableTotal = 0;
  let collectedTotal = 0;

  for (const inv of ws.invoices) {
    const p = paymentInfo(ws, inv);
    if (!p.paid) continue;
    if (!inPeriod(p.paidAt, from, to)) continue;
    collectedTotal += p.amount;
    const fee = p.creditable ? Math.round(p.amount * ratePct) / 100 : 0;
    if (p.creditable) creditableTotal += p.amount;
    lineItems.push({
      invoiceId: inv.id,
      customerName: inv.customerName,
      currency: inv.currency,
      amount: p.amount,
      paidAt: p.paidAt.toISOString().slice(0, 10),
      daysToPay: p.daysToPay,
      creditable: p.creditable,
      fee,
    });
  }

  lineItems.sort((a, b) => a.paidAt.localeCompare(b.paidAt));
  const fee = Math.round(creditableTotal * ratePct) / 100;
  return {
    businessName: ws.brand.businessName,
    ratePct,
    from: from || null,
    to: to || null,
    currency: ws.invoices[0]?.currency || "ILS",
    lineItems,
    collectedTotal,
    creditableTotal,
    fee,
  };
}

/** Render a billing statement as standalone HTML (RTL). */
export function renderStatement(stmt) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = stmt.lineItems
    .map(
      (li) =>
        `<tr><td>${esc(li.invoiceId)}</td><td>${esc(li.customerName)}</td><td class="num">${esc(
          formatMoney(li.amount, li.currency)
        )}</td><td class="num">${li.paidAt}</td><td class="num">${li.daysToPay ?? "—"}</td><td>${
          li.creditable ? "✓" : "—"
        }</td><td class="num">${esc(formatMoney(li.fee, li.currency))}</td></tr>`
    )
    .join("\n");
  const period = `${stmt.from || "התחלה"} — ${stmt.to || "היום"}`;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<title>חיוב — ${esc(stmt.businessName)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;background:#0b1020;color:#e9edf7;max-width:800px;margin:0 auto;padding:28px}
h1{margin:0 0 4px}.sub{color:#9aa6c2}table{width:100%;border-collapse:collapse;background:#151c33;border-radius:12px;overflow:hidden;margin:16px 0}
th,td{padding:10px;border-bottom:1px solid #ffffff14;text-align:right;font-size:14px}th{color:#9aa6c2}.num{font-variant-numeric:tabular-nums}
.tot{font-size:20px;font-weight:700;color:#34d399}.box{background:#151c33;border-radius:12px;padding:16px;margin-top:12px}</style></head><body>
<h1>דוח חיוב — InvoiceChaser</h1>
<p class="sub">${esc(stmt.businessName)} · תקופה: ${esc(period)} · עמלת-הצלחה: ${stmt.ratePct}%</p>
<table><thead><tr><th>חשבונית</th><th>לקוח</th><th>סכום ששולם</th><th>תאריך</th><th>ימים</th><th>מזכה</th><th>עמלה</th></tr></thead>
<tbody>${rows || '<tr><td colspan="7">אין תשלומים בתקופה.</td></tr>'}</tbody></table>
<div class="box">
  <div>סך נגבה בתקופה: ${esc(formatMoney(stmt.collectedTotal, stmt.currency))}</div>
  <div>סך מזכה (בסיס-עמלה): ${esc(formatMoney(stmt.creditableTotal, stmt.currency))}</div>
  <div class="tot">לחיוב (${stmt.ratePct}%): ${esc(formatMoney(stmt.fee, stmt.currency))}</div>
</div></body></html>`;
}
