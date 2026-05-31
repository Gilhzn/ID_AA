// HTML report generator — turns a CSV of invoices into a polished, self-contained
// "cash-flow recovery" report. This is the deliverable for the "free invoice analysis"
// offer (invoicechaser/gtm + docs/08 §8.4): a shareable asset that sells the product.
// Zero dependencies; outputs one standalone .html file (RTL Hebrew, inline styles).

import { daysOverdue, formatMoney, paymentLink } from "./domain.mjs";
import { decideNextAction } from "./cadence.mjs";
import { generateReminder } from "./generator.mjs";

const ACTION_LABEL = {
  send: "תזכורת מוכנה לשליחה",
  approve: "הסלמה — לאישורך",
  wait: "טרם הגיע זמן",
  stop: "עצירה",
};

/** Sum amounts grouped by currency (honest multi-currency totals). */
function totalsByCurrency(invoices, predicate) {
  const t = {};
  for (const inv of invoices) {
    if (!predicate(inv)) continue;
    t[inv.currency] = (t[inv.currency] || 0) + inv.amount;
  }
  return Object.entries(t)
    .map(([cur, amt]) => formatMoney(amt, cur))
    .join(" + ") || "—";
}

/** Weighted average days overdue across open+overdue invoices (a DSO-ish proxy). */
function avgDaysOverdue(invoices, today) {
  const overdue = invoices.filter((i) => i.status === "open" && daysOverdue(i, today) > 0);
  if (overdue.length === 0) return 0;
  const sum = overdue.reduce((s, i) => s + daysOverdue(i, today) * i.amount, 0);
  const weight = overdue.reduce((s, i) => s + i.amount, 0);
  return Math.round(sum / weight);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Render the full HTML report.
 * @param {import("./domain.mjs").Invoice[]} invoices
 * @param {import("./domain.mjs").BrandProfile} brand
 * @param {Date} today
 * @returns {string} HTML
 */
export function renderReport(invoices, brand, today) {
  const open = invoices.filter((i) => i.status === "open");
  const overdue = open.filter((i) => daysOverdue(i, today) > 0);

  const rows = invoices
    .map((inv) => {
      const d = daysOverdue(inv, today);
      const decision = decideNextAction(inv, today, "approval");
      const badge =
        inv.status === "paid"
          ? "paid"
          : inv.status === "disputed"
          ? "disputed"
          : d > 14
          ? "late"
          : d > 0
          ? "due"
          : "ok";
      return `<tr>
        <td>${esc(inv.id)}</td>
        <td>${esc(inv.customerName)}</td>
        <td class="num">${esc(formatMoney(inv.amount, inv.currency))}</td>
        <td class="num">${d >= 0 ? "+" + d : d}</td>
        <td><span class="badge ${badge}">${esc(inv.status)}</span></td>
        <td>${esc(ACTION_LABEL[decision.action])}</td>
      </tr>`;
    })
    .join("\n");

  // Up to 3 sample drafted reminders to showcase the AI tone.
  const samples = invoices
    .map((inv) => ({ inv, dec: decideNextAction(inv, today, "approval") }))
    .filter((x) => x.dec.action === "send" || x.dec.action === "approve")
    .slice(0, 3)
    .map(({ inv, dec }) => {
      const draft = generateReminder({ invoice: inv, brand, step: dec.step, today });
      return `<div class="sample">
        <div class="sample-h">${esc(draft.subject)}</div>
        <pre>${esc(draft.body)}</pre>
      </div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>דוח שחזור תזרים — ${esc(brand.businessName)}</title>
<style>
  :root{--bg:#0b1020;--card:#151c33;--ink:#e9edf7;--mut:#9aa6c2;--acc:#5b8cff;--good:#34d399;--warn:#fbbf24;--bad:#f87171}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,'Segoe UI',Arial,sans-serif;line-height:1.6}
  .wrap{max-width:920px;margin:0 auto;padding:32px 20px}
  h1{font-size:26px;margin:0 0 4px} .sub{color:var(--mut);margin:0 0 24px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:20px 0}
  .kpi{background:var(--card);border-radius:14px;padding:18px}
  .kpi .v{font-size:24px;font-weight:700} .kpi .l{color:var(--mut);font-size:13px}
  .kpi.hl .v{color:var(--acc)}
  table{width:100%;border-collapse:collapse;background:var(--card);border-radius:14px;overflow:hidden;margin:8px 0 28px}
  th,td{padding:10px 12px;text-align:right;border-bottom:1px solid #ffffff14;font-size:14px}
  th{color:var(--mut);font-weight:600} td.num{font-variant-numeric:tabular-nums}
  .badge{padding:2px 9px;border-radius:999px;font-size:12px}
  .badge.ok{background:#34d39922;color:var(--good)} .badge.due{background:#fbbf2422;color:var(--warn)}
  .badge.late{background:#f8717122;color:var(--bad)} .badge.paid{background:#9aa6c222;color:var(--mut)}
  .badge.disputed{background:#a78bfa22;color:#c4b5fd}
  h2{font-size:18px;margin:24px 0 10px}
  .sample{background:var(--card);border-radius:12px;padding:14px;margin:10px 0;border-right:3px solid var(--acc)}
  .sample-h{font-weight:600;margin-bottom:6px}
  pre{white-space:pre-wrap;font-family:inherit;color:var(--mut);margin:0}
  .cta{margin-top:30px;padding:18px;background:linear-gradient(90deg,#5b8cff22,#34d39922);border-radius:14px}
  .foot{color:var(--mut);font-size:12px;margin-top:24px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
  <h1>דוח שחזור תזרים</h1>
  <p class="sub">${esc(brand.businessName)} · נכון ל-${today.toISOString().slice(0, 10)} · הופק ע"י InvoiceChaser</p>

  <div class="kpis">
    <div class="kpi hl"><div class="v">${esc(totalsByCurrency(invoices, (i) => i.status === "open"))}</div><div class="l">סך פתוח</div></div>
    <div class="kpi"><div class="v">${esc(totalsByCurrency(invoices, (i) => i.status === "open" && daysOverdue(i, today) > 0))}</div><div class="l">מתוכו באיחור</div></div>
    <div class="kpi"><div class="v">${overdue.length}/${open.length}</div><div class="l">חשבוניות באיחור / פתוחות</div></div>
    <div class="kpi"><div class="v">${avgDaysOverdue(invoices, today)} ימים</div><div class="l">איחור ממוצע (משוקלל)</div></div>
  </div>

  <h2>תוכנית הגבייה</h2>
  <table>
    <thead><tr><th>חשבונית</th><th>לקוח</th><th>סכום</th><th>ימים</th><th>סטטוס</th><th>פעולה מומלצת</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <h2>דוגמאות לתזכורות שה-AI ינסח</h2>
  ${samples || "<p class='sub'>אין כרגע תזכורות פעילות.</p>"}

  <div class="cta">
    <strong>השורה התחתונה:</strong> יש כאן כסף שכבר הרווחת וממתין להיגבות.
    InvoiceChaser ירדוף אחריו אוטומטית, באדיבות, ובלי שתצטרך להרים אצבע — ותשלם רק על מה שייגבה.
  </div>

  <p class="foot">Powered by InvoiceChaser · ${esc(paymentLink(brand, { id: "demo" }).split("/i/")[0])}</p>
</div>
</body>
</html>`;
}
