#!/usr/bin/env node
// Zero-dependency web dashboard + JSON API over the InvoiceChaser core.
// Runs with `node` only (built-in http). Backed by a workspace JSON file.
//
// Usage:
//   node src/server.mjs [ws.json] [--port=3000]
//   (if the workspace is empty, use the UI's import box or operator-cli import)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { loadWorkspace, saveWorkspace, emptyWorkspace } from "./store.mjs";
import { buildOutbox, dueSteps, recordSent, markPaid, markDisputed, computeImpact } from "./operator.mjs";
import { decideNextAction } from "./cadence.mjs";
import { parseCsv, rowsToInvoices } from "./csv.mjs";
import { daysOverdue, formatMoney } from "./domain.mjs";

const args = process.argv.slice(2);
const WS_PATH = args.find((a) => !a.startsWith("--")) || "ws.json";
const PORT = Number((args.find((a) => a.startsWith("--port=")) || "--port=3000").split("=")[1]);

const ld = () => loadWorkspace(WS_PATH);
const todayFrom = (q) => (q.get("today") ? new Date(q.get("today")) : new Date());

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const q = url.searchParams;
  const path = url.pathname;

  try {
    // ---- UI ----
    if (req.method === "GET" && (path === "/" || path === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }

    // ---- API ----
    if (path === "/api/state" && req.method === "GET") {
      const ws = ld();
      const today = todayFrom(q);
      const mode = q.get("mode") || "approval";
      const invoices = ws.invoices.map((i) => {
        const d = decideNextAction(i, today, mode);
        return {
          id: i.id,
          customerName: i.customerName,
          amount: i.amount,
          currency: i.currency,
          money: formatMoney(i.amount, i.currency),
          daysOverdue: daysOverdue(i, today),
          status: i.status,
          nextAction: d.action,
          nextStep: d.step ? d.step.key : null,
        };
      });
      return json(res, 200, {
        brand: ws.brand,
        today: today.toISOString().slice(0, 10),
        invoices,
        impact: computeImpact(ws, today),
        dueCount: dueSteps(ws, today, mode).length,
      });
    }

    if (path === "/api/outbox" && req.method === "GET") {
      const ws = ld();
      const today = todayFrom(q);
      const mode = q.get("mode") || "approval";
      const outbox = await buildOutbox(ws, today, mode);
      return json(res, 200, {
        mode,
        today: today.toISOString().slice(0, 10),
        source: outbox[0]?.draft?.source || "template",
        items: outbox.map((o) => ({
          invoiceId: o.invoice.id,
          customerName: o.invoice.customerName,
          customerEmail: o.invoice.customerEmail,
          stepKey: o.decision.step.key,
          action: o.decision.action,
          subject: o.draft.subject,
          body: o.draft.body,
        })),
      });
    }

    if (path === "/api/sent" && req.method === "POST") {
      const { invoiceId, stepKey, today } = await readBody(req);
      const ws = ld();
      recordSent(ws, invoiceId, stepKey, today ? new Date(today) : new Date());
      saveWorkspace(WS_PATH, ws);
      return json(res, 200, { ok: true });
    }

    if (path === "/api/sent-all" && req.method === "POST") {
      const { today, mode } = await readBody(req);
      const ws = ld();
      const t = today ? new Date(today) : new Date();
      const due = dueSteps(ws, t, mode || "approval");
      for (const { invoice, decision } of due) recordSent(ws, invoice.id, decision.step.key, t);
      saveWorkspace(WS_PATH, ws);
      return json(res, 200, { ok: true, count: due.length });
    }

    if (path === "/api/pay" && req.method === "POST") {
      const { invoiceId, amount, at } = await readBody(req);
      const ws = ld();
      markPaid(ws, invoiceId, amount ? Number(amount) : undefined, at ? new Date(at) : new Date());
      saveWorkspace(WS_PATH, ws);
      return json(res, 200, { ok: true });
    }

    if (path === "/api/dispute" && req.method === "POST") {
      const { invoiceId } = await readBody(req);
      const ws = ld();
      markDisputed(ws, invoiceId);
      saveWorkspace(WS_PATH, ws);
      return json(res, 200, { ok: true });
    }

    if (path === "/api/import" && req.method === "POST") {
      const { csv, name, signer, reply } = await readBody(req);
      const ws = existsSync(WS_PATH) ? ld() : emptyWorkspace();
      if (name) ws.brand.businessName = name;
      if (signer) ws.brand.signerName = signer;
      if (reply) ws.brand.replyTo = reply;
      const imported = rowsToInvoices(parseCsv(csv || ""));
      const seen = new Set(ws.invoices.map((i) => i.id));
      let added = 0;
      for (const inv of imported) {
        if (inv.id && !seen.has(inv.id)) {
          ws.invoices.push(inv);
          ws.events.push({ type: "imported", invoiceId: inv.id, at: new Date().toISOString() });
          added++;
        }
      }
      saveWorkspace(WS_PATH, ws);
      return json(res, 200, { ok: true, added, total: ws.invoices.length });
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err && err.message) });
  }
});

// Single-page dashboard (inline, RTL, no build step).
const PAGE = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>InvoiceChaser</title>
<style>
:root{--bg:#0b1020;--card:#151c33;--ink:#e9edf7;--mut:#9aa6c2;--acc:#5b8cff;--good:#34d399;--warn:#fbbf24;--bad:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,Arial,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:24px 18px}h1{margin:0 0 2px}.sub{color:var(--mut);margin:0 0 16px}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
input,select,button,textarea{font:inherit;border-radius:9px;border:1px solid #ffffff22;background:#0e1530;color:var(--ink);padding:8px 10px}
button{background:var(--acc);border:0;cursor:pointer;font-weight:600}button.ghost{background:#1c2547}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:14px 0}
.kpi{background:var(--card);border-radius:12px;padding:14px}.kpi .v{font-size:22px;font-weight:700}.kpi .l{color:var(--mut);font-size:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border-radius:12px;overflow:hidden}
th,td{padding:9px 10px;text-align:right;border-bottom:1px solid #ffffff14;font-size:14px}th{color:var(--mut)}
.badge{padding:2px 8px;border-radius:999px;font-size:12px}.ok{background:#34d39922;color:var(--good)}.due{background:#fbbf2422;color:var(--warn)}
.late{background:#f8717122;color:var(--bad)}.paid{background:#9aa6c222;color:var(--mut)}.disputed{background:#a78bfa22;color:#c4b5fd}
h2{margin:22px 0 8px;font-size:18px}.card{background:var(--card);border-radius:12px;padding:12px;margin:8px 0;border-right:3px solid var(--acc)}
pre{white-space:pre-wrap;font-family:inherit;color:var(--mut);margin:6px 0}details{margin:4px 0}
.row-actions button{padding:4px 8px;font-size:12px}.src{font-size:12px;color:var(--mut)}
textarea{width:100%;min-height:90px}
</style></head><body><div class="wrap">
<h1>InvoiceChaser</h1><p class="sub" id="brand">—</p>
<div class="bar">
  תאריך: <input type="date" id="today" value="2026-05-31">
  מצב: <select id="mode"><option value="approval">approval (אישור לכל הודעה)</option><option value="auto">auto</option></select>
  <button onclick="refresh()">רענן</button>
  <button class="ghost" onclick="sentAll()">סמן את כל ה-Outbox כנשלח</button>
</div>
<div class="kpis" id="kpis"></div>
<h2>חשבוניות</h2><table id="tbl"><thead><tr><th>חשבונית</th><th>לקוח</th><th>סכום</th><th>ימים</th><th>סטטוס</th><th>פעולה הבאה</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<h2>Outbox <span class="src" id="src"></span></h2><div id="outbox"></div>
<h2>ייבוא חשבוניות (CSV)</h2>
<p class="sub">כותרות: id,customerName,customerEmail,amount,currency,issueDate,dueDate,status,lang</p>
<textarea id="csv" placeholder="הדבק כאן CSV..."></textarea>
<div class="bar"><button onclick="doImport()">ייבא</button></div>
<script>
const $=s=>document.querySelector(s);
const q=()=>"today="+$("#today").value+"&mode="+$("#mode").value;
async function api(p,m,b){const r=await fetch(p,{method:m||"GET",headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined});return r.json();}
function badge(s,d){if(s==="paid")return"paid";if(s==="disputed")return"disputed";if(d>14)return"late";if(d>0)return"due";return"ok";}
async function refresh(){
  const st=await api("/api/state?"+q());
  $("#brand").textContent=st.brand.businessName+" · "+st.today+" · "+st.dueCount+" ממתינות בתור";
  const m=st.impact;
  $("#kpis").innerHTML=[
    ["נגבה ע\\"י המערכת",m.creditable.toLocaleString()],["סה\\"כ נגבה",m.collected.toLocaleString()],
    ["ימים-עד-תשלום",m.avgDaysToPay??"—"],["פתוח באיחור",m.openOverdueAmount.toLocaleString()+" ("+m.openOverdueCount+")"],
    ["תזכורות שנשלחו",m.remindersSent]
  ].map(k=>'<div class="kpi"><div class="v">'+k[1]+'</div><div class="l">'+k[0]+'</div></div>').join("");
  $("#rows").innerHTML=st.invoices.map(i=>'<tr><td>'+i.id+'</td><td>'+i.customerName+'</td><td>'+i.money+'</td><td>'+(i.daysOverdue>=0?"+":"")+i.daysOverdue+'</td><td><span class="badge '+badge(i.status,i.daysOverdue)+'">'+i.status+'</span></td><td>'+i.nextAction+(i.nextStep?" ("+i.nextStep+")":"")+'</td><td class="row-actions">'+(i.status==="open"?'<button onclick="pay(\\''+i.id+'\\','+i.amount+')">שולם</button> <button class="ghost" onclick="dispute(\\''+i.id+'\\')">מחלוקת</button>':'')+'</td></tr>').join("");
  const ob=await api("/api/outbox?"+q());
  $("#src").textContent="[ניסוח: "+ob.source+"]";
  $("#outbox").innerHTML=ob.items.length?ob.items.map(o=>'<div class="card"><b>'+o.invoiceId+' → '+o.customerName+'</b> '+(o.action==="approve"?'⚠️ אישור':'')+'<br><span class="src">'+o.customerEmail+' · '+o.stepKey+'</span><div><b>'+o.subject+'</b></div><pre>'+o.body.replace(/</g,"&lt;")+'</pre><button onclick="sent(\\''+o.invoiceId+'\\',\\''+o.stepKey+'\\')">סמן כנשלח</button></div>').join(""):'<p class="sub">אין הודעות לשליחה.</p>';
}
async function sent(id,step){await api("/api/sent","POST",{invoiceId:id,stepKey:step,today:$("#today").value});refresh();}
async function sentAll(){await api("/api/sent-all","POST",{today:$("#today").value,mode:$("#mode").value});refresh();}
async function pay(id,amt){const a=prompt("סכום ששולם:",amt);if(a===null)return;await api("/api/pay","POST",{invoiceId:id,amount:a,at:$("#today").value});refresh();}
async function dispute(id){if(!confirm("לסמן במחלוקת? הרדיפה תיעצר."))return;await api("/api/dispute","POST",{invoiceId:id});refresh();}
async function doImport(){const r=await api("/api/import","POST",{csv:$("#csv").value});alert("נוספו "+r.added+" (סה\\"כ "+r.total+")");$("#csv").value="";refresh();}
refresh();
</script></div></body></html>`;

server.listen(PORT, () => console.log(`InvoiceChaser dashboard → http://localhost:${PORT}  (workspace: ${WS_PATH})`));
