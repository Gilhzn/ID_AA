#!/usr/bin/env node
// Polished, multi-client web dashboard + JSON API over the InvoiceChaser core.
// Zero-dependency (built-in http). Runs with `node` only.
//
// Two modes (auto-detected from the argument):
//   - single-client:  node src/server.mjs ws.json          (one workspace file)
//   - multi-client:   node src/server.mjs ./workspaces      (a folder, one .json per agency)
//
// Usage: node src/server.mjs [target] [--port=3000]

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { loadWorkspace, saveWorkspace, emptyWorkspace } from "./store.mjs";
import { buildOutbox, dueSteps, recordSent, markPaid, markDisputed, computeImpact } from "./operator.mjs";
import { decideNextAction } from "./cadence.mjs";
import { parseCsv, rowsToInvoices } from "./csv.mjs";
import { computeBilling, renderStatement } from "./billing.mjs";
import { renderReport } from "./report.mjs";
import { daysOverdue, formatMoney } from "./domain.mjs";

const todayFrom = (q) => (q.get("today") ? new Date(q.get("today")) : new Date());

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function html(res, code, body) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
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

/** Resolve single-vs-multi workspace storage from the CLI target. */
function setupStorage(target) {
  if (target.endsWith(".json")) return { mode: "single", singlePath: target };
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  return { mode: "multi", dir: target };
}

/** Build the HTTP server (no auto-listen — testable). */
export function makeServer(target) {
  const cfg = setupStorage(target);
  const sanitize = (name) => String(name || "default").replace(/[\\/.]+/g, "_").trim() || "default";

  const listClients = () => {
    if (cfg.mode === "single") return [basename(cfg.singlePath, ".json")];
    return readdirSync(cfg.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => basename(f, ".json"));
  };
  const wsPathFor = (client) => {
    if (cfg.mode === "single") return cfg.singlePath;
    const clients = listClients();
    const name = client && clients.includes(sanitize(client)) ? sanitize(client) : sanitize(client || clients[0] || "default");
    return join(cfg.dir, name + ".json");
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams;
    const path = url.pathname;
    const client = q.get("client");

    try {
      if (req.method === "GET" && (path === "/" || path === "/index.html")) return html(res, 200, PAGE);

      // ---- clients ----
      if (path === "/api/clients" && req.method === "GET") {
        return json(res, 200, { mode: cfg.mode, clients: listClients() });
      }
      if (path === "/api/clients" && req.method === "POST") {
        const { name } = await readBody(req);
        if (cfg.mode === "single") return json(res, 400, { error: "single-client mode" });
        const p = join(cfg.dir, sanitize(name) + ".json");
        if (!existsSync(p)) saveWorkspace(p, emptyWorkspace({ businessName: name || "לקוח חדש" }));
        return json(res, 200, { ok: true, clients: listClients() });
      }

      // ---- state ----
      if (path === "/api/state" && req.method === "GET") {
        const ws = loadWorkspace(wsPathFor(client));
        const today = todayFrom(q);
        const mode = q.get("mode") || "approval";
        const invoices = ws.invoices.map((i) => {
          const d = decideNextAction(i, today, mode);
          return {
            id: i.id, customerName: i.customerName, amount: i.amount, currency: i.currency,
            money: formatMoney(i.amount, i.currency), daysOverdue: daysOverdue(i, today),
            status: i.status, nextAction: d.action, nextStep: d.step ? d.step.key : null,
          };
        });
        return json(res, 200, {
          brand: ws.brand, today: today.toISOString().slice(0, 10),
          invoices, impact: computeImpact(ws, today), dueCount: dueSteps(ws, today, mode).length,
        });
      }

      if (path === "/api/outbox" && req.method === "GET") {
        const ws = loadWorkspace(wsPathFor(client));
        const today = todayFrom(q);
        const mode = q.get("mode") || "approval";
        const outbox = await buildOutbox(ws, today, mode);
        return json(res, 200, {
          mode, today: today.toISOString().slice(0, 10), source: outbox[0]?.draft?.source || "template",
          items: outbox.map((o) => ({
            invoiceId: o.invoice.id, customerName: o.invoice.customerName, customerEmail: o.invoice.customerEmail,
            stepKey: o.decision.step.key, action: o.decision.action, subject: o.draft.subject, body: o.draft.body,
          })),
        });
      }

      if (path === "/api/settings" && req.method === "GET") {
        return json(res, 200, loadWorkspace(wsPathFor(client)).brand);
      }
      if (path === "/api/settings" && req.method === "POST") {
        const b = await readBody(req);
        const p = wsPathFor(client);
        const ws = loadWorkspace(p);
        for (const k of ["businessName", "signerName", "replyTo", "tone", "lang", "paymentBaseUrl"]) {
          if (b[k] !== undefined) ws.brand[k] = b[k];
        }
        saveWorkspace(p, ws);
        return json(res, 200, { ok: true, brand: ws.brand });
      }

      if (path === "/api/billing" && req.method === "GET") {
        const ws = loadWorkspace(wsPathFor(client));
        return json(res, 200, computeBilling(ws, { ratePct: Number(q.get("rate") || "12"), from: q.get("from") || undefined, to: q.get("to") || undefined }));
      }
      if (path === "/api/statement" && req.method === "GET") {
        const ws = loadWorkspace(wsPathFor(client));
        const stmt = computeBilling(ws, { ratePct: Number(q.get("rate") || "12"), from: q.get("from") || undefined, to: q.get("to") || undefined });
        return html(res, 200, renderStatement(stmt));
      }
      if (path === "/api/report" && req.method === "GET") {
        const ws = loadWorkspace(wsPathFor(client));
        return html(res, 200, renderReport(ws.invoices, ws.brand, todayFrom(q)));
      }

      // ---- actions ----
      if (path === "/api/sent" && req.method === "POST") {
        const b = await readBody(req);
        const p = wsPathFor(b.client || client);
        const ws = loadWorkspace(p);
        recordSent(ws, b.invoiceId, b.stepKey, b.today ? new Date(b.today) : new Date());
        saveWorkspace(p, ws);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/sent-all" && req.method === "POST") {
        const b = await readBody(req);
        const p = wsPathFor(b.client || client);
        const ws = loadWorkspace(p);
        const t = b.today ? new Date(b.today) : new Date();
        const due = dueSteps(ws, t, b.mode || "approval");
        for (const { invoice, decision } of due) recordSent(ws, invoice.id, decision.step.key, t);
        saveWorkspace(p, ws);
        return json(res, 200, { ok: true, count: due.length });
      }
      if (path === "/api/pay" && req.method === "POST") {
        const b = await readBody(req);
        const p = wsPathFor(b.client || client);
        const ws = loadWorkspace(p);
        markPaid(ws, b.invoiceId, b.amount ? Number(b.amount) : undefined, b.at ? new Date(b.at) : new Date());
        saveWorkspace(p, ws);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/dispute" && req.method === "POST") {
        const b = await readBody(req);
        const p = wsPathFor(b.client || client);
        const ws = loadWorkspace(p);
        markDisputed(ws, b.invoiceId);
        saveWorkspace(p, ws);
        return json(res, 200, { ok: true });
      }
      if (path === "/api/import" && req.method === "POST") {
        const b = await readBody(req);
        const p = wsPathFor(b.client || client);
        const ws = existsSync(p) ? loadWorkspace(p) : emptyWorkspace();
        if (b.name) ws.brand.businessName = b.name;
        if (b.signer) ws.brand.signerName = b.signer;
        if (b.reply) ws.brand.replyTo = b.reply;
        const imported = rowsToInvoices(parseCsv(b.csv || ""));
        const seen = new Set(ws.invoices.map((i) => i.id));
        let added = 0;
        for (const inv of imported) {
          if (inv.id && !seen.has(inv.id)) {
            ws.invoices.push(inv);
            ws.events.push({ type: "imported", invoiceId: inv.id, at: new Date().toISOString() });
            added++;
          }
        }
        saveWorkspace(p, ws);
        return json(res, 200, { ok: true, added, total: ws.invoices.length });
      }

      json(res, 404, { error: "not found" });
    } catch (err) {
      json(res, 500, { error: String(err && err.message) });
    }
  });
}

const PAGE = String.raw`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>InvoiceChaser</title>
<style>
:root{--bg:#0a0f1f;--panel:#121a30;--card:#172139;--ink:#eef2fb;--mut:#94a1c0;--line:#ffffff14;
--acc:#6aa0ff;--acc2:#8b6dff;--good:#34d399;--warn:#f6c453;--bad:#f87171;--rad:14px}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--bg);color:var(--ink);font-family:system-ui,'Segoe UI',Arial,sans-serif;line-height:1.55}
header{position:sticky;top:0;z-index:5;background:rgba(10,15,31,.85);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.hbar{max-width:1080px;margin:0 auto;padding:12px 18px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.logo{font-weight:800;font-size:18px;background:linear-gradient(90deg,var(--acc),var(--acc2));-webkit-background-clip:text;background-clip:text;color:transparent}
.wrap{max-width:1080px;margin:0 auto;padding:18px}
select,input,button,textarea{font:inherit;color:var(--ink);background:#0e1730;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
button{background:linear-gradient(90deg,var(--acc),var(--acc2));border:0;font-weight:600;cursor:pointer}
button.ghost{background:#1b2747}button.sm{padding:5px 9px;font-size:12px}
.tabs{display:flex;gap:6px;margin:14px 0;flex-wrap:wrap}
.tab{padding:8px 14px;border-radius:999px;background:#141d34;cursor:pointer;color:var(--mut);border:1px solid var(--line)}
.tab.on{background:linear-gradient(90deg,var(--acc),var(--acc2));color:#fff;border:0}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:6px 0 16px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--rad);padding:14px}
.kpi .v{font-size:22px;font-weight:800}.kpi .l{color:var(--mut);font-size:12px}.kpi.hl .v{color:var(--good)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--rad);padding:14px;margin:10px 0}
table{width:100%;border-collapse:collapse}th,td{padding:9px 8px;border-bottom:1px solid var(--line);text-align:right;font-size:14px}th{color:var(--mut);font-weight:600}
.num{font-variant-numeric:tabular-nums}
.badge{padding:2px 9px;border-radius:999px;font-size:12px}.ok{background:#34d39922;color:var(--good)}.due{background:#f6c45322;color:var(--warn)}
.late{background:#f8717122;color:var(--bad)}.paid{background:#94a1c022;color:var(--mut)}.disputed{background:#8b6dff22;color:#c4b5fd}
.msg{background:var(--card);border:1px solid var(--line);border-right:3px solid var(--acc);border-radius:12px;padding:12px;margin:10px 0}
.msg textarea{width:100%;min-height:120px;margin-top:6px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.grow{flex:1}.muted{color:var(--mut);font-size:13px}
.hide{display:none}.field{display:flex;flex-direction:column;gap:4px;margin:6px 0}.field label{font-size:12px;color:var(--mut)}
h2{font-size:17px;margin:6px 0 10px}.pill{font-size:12px;color:var(--mut)}
</style></head><body>
<header><div class="hbar">
  <div class="logo">⚡ InvoiceChaser</div>
  <span class="pill" id="hint">—</span>
  <div class="grow"></div>
  <select id="client" onchange="refresh()"></select>
  <button class="ghost sm" onclick="newClient()">+ לקוח</button>
  <input type="date" id="today" value="2026-05-31" onchange="refresh()">
  <select id="mode" onchange="refresh()"><option value="approval">approval</option><option value="auto">auto</option></select>
</div></header>
<div class="wrap">
  <div class="tabs" id="tabs"></div>

  <section id="t-overview">
    <div class="kpis" id="kpis"></div>
    <div class="panel"><h2>חשבוניות</h2>
      <table><thead><tr><th>חשבונית</th><th>לקוח</th><th>סכום</th><th>ימים</th><th>סטטוס</th><th>פעולה</th><th></th></tr></thead>
      <tbody id="rows"></tbody></table></div>
  </section>

  <section id="t-outbox" class="hide">
    <div class="row"><h2 class="grow">Outbox <span class="pill" id="src"></span></h2>
      <button class="ghost sm" onclick="sentAll()">סמן הכל כנשלח</button></div>
    <div id="outbox"></div>
  </section>

  <section id="t-billing" class="hide">
    <div class="panel"><h2>חיוב success-fee</h2>
      <div class="row">
        <div class="field"><label>שיעור %</label><input id="rate" type="number" value="12" style="width:80px"></div>
        <div class="field"><label>מתאריך</label><input id="from" type="date"></div>
        <div class="field"><label>עד תאריך</label><input id="to" type="date"></div>
        <button onclick="loadBilling()">חשב</button>
        <button class="ghost" onclick="openDoc('statement')">הורד דוח חיוב</button>
      </div>
      <div id="billbox"></div>
    </div>
  </section>

  <section id="t-settings" class="hide">
    <div class="panel"><h2>הגדרות מותג</h2>
      <div class="field"><label>שם העסק</label><input id="s_name"></div>
      <div class="field"><label>שם החותם</label><input id="s_signer"></div>
      <div class="field"><label>Reply-To (אימייל)</label><input id="s_reply"></div>
      <div class="field"><label>טון</label><select id="s_tone"><option value="friendly">ידידותי</option><option value="formal">רשמי</option><option value="firm">נחרץ</option></select></div>
      <button onclick="saveSettings()">שמור</button>
    </div>
  </section>

  <section id="t-import" class="hide">
    <div class="panel"><h2>ייבוא חשבוניות (CSV)</h2>
      <p class="muted">כותרות: id,customerName,customerEmail,amount,currency,issueDate,dueDate,status,lang</p>
      <textarea id="csv" style="width:100%;min-height:140px" placeholder="הדבק CSV..."></textarea>
      <div class="row" style="margin-top:8px"><button onclick="doImport()">ייבא</button>
        <button class="ghost" onclick="openDoc('report')">הורד ניתוח-גבייה</button></div>
    </div>
  </section>
</div>
<script>
var $=function(s){return document.querySelector(s)};
function q(){return "client="+encodeURIComponent($("#client").value)+"&today="+$("#today").value+"&mode="+$("#mode").value}
function api(p,m,b){return fetch(p,{method:m||"GET",headers:{"content-type":"application/json"},body:b?JSON.stringify(b):undefined}).then(function(r){return r.json()})}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
function badge(s,d){if(s=="paid")return"paid";if(s=="disputed")return"disputed";if(d>14)return"late";if(d>0)return"due";return"ok"}
var TABS=[["overview","סקירה"],["outbox","Outbox"],["billing","חיוב"],["settings","הגדרות"],["import","ייבוא"]];
function drawTabs(active){
  $("#tabs").innerHTML=TABS.map(function(t){return '<div class="tab'+(t[0]==active?' on':'')+'" onclick="go(\''+t[0]+'\')">'+t[1]+'</div>'}).join("");
  TABS.forEach(function(t){$("#t-"+t[0]).className=(t[0]==active?"":"hide")});
}
function go(t){drawTabs(t);if(t=="billing")loadBilling();if(t=="settings")loadSettings()}
function bodyClient(extra){var o=extra||{};o.client=$("#client").value;return o}

async function loadClients(){
  var d=await api("/api/clients");
  var sel=$("#client");var cur=sel.value;
  sel.innerHTML=d.clients.map(function(c){return '<option>'+esc(c)+'</option>'}).join("");
  if(cur&&d.clients.indexOf(cur)>=0)sel.value=cur;
  $("#hint").textContent=d.mode=="multi"?(d.clients.length+" לקוחות"):"לקוח יחיד";
}
async function newClient(){var n=prompt("שם הלקוח/סוכנות:");if(!n)return;var r=await api("/api/clients","POST",{name:n});if(r.error){alert(r.error);return}await loadClients();$("#client").value=n;refresh()}

async function refresh(){
  var st=await api("/api/state?"+q());
  if(st.error){return}
  var m=st.impact;
  $("#kpis").innerHTML=[
    ["נגבה ע\"י המערכת",m.creditable.toLocaleString(),"hl"],["סה\"כ נגבה",m.collected.toLocaleString(),""],
    ["ימים-עד-תשלום",m.avgDaysToPay==null?"—":m.avgDaysToPay,""],["פתוח באיחור",m.openOverdueAmount.toLocaleString()+" ("+m.openOverdueCount+")",""],
    ["בתור היום",st.dueCount,""]
  ].map(function(k){return '<div class="kpi '+k[2]+'"><div class="v">'+k[1]+'</div><div class="l">'+k[0]+'</div></div>'}).join("");
  $("#rows").innerHTML=st.invoices.map(function(i){
    var act=(i.status=="open")?'<button class="ghost sm" onclick="pay(\''+i.id+'\','+i.amount+')">שולם</button> <button class="ghost sm" onclick="disp(\''+i.id+'\')">מחלוקת</button>':'';
    return '<tr><td>'+esc(i.id)+'</td><td>'+esc(i.customerName)+'</td><td class="num">'+esc(i.money)+'</td><td class="num">'+(i.daysOverdue>=0?"+":"")+i.daysOverdue+'</td><td><span class="badge '+badge(i.status,i.daysOverdue)+'">'+i.status+'</span></td><td class="muted">'+i.nextAction+(i.nextStep?" ("+i.nextStep+")":"")+'</td><td>'+act+'</td></tr>';
  }).join("");
  var ob=await api("/api/outbox?"+q());
  $("#src").textContent="["+ob.source+"]";
  $("#outbox").innerHTML=ob.items.length?ob.items.map(function(o,idx){
    return '<div class="msg"><div class="row"><b class="grow">'+esc(o.invoiceId)+' → '+esc(o.customerName)+'</b>'+(o.action=="approve"?'<span class="badge due">דורש אישור</span>':'')+'</div>'+
      '<div class="muted">'+esc(o.customerEmail)+' · '+o.stepKey+' · נושא: '+esc(o.subject)+'</div>'+
      '<textarea id="ob'+idx+'">'+esc(o.body)+'</textarea>'+
      '<div class="row" style="margin-top:6px"><button class="sm" onclick="copyMsg('+idx+')">העתק</button> <button class="ghost sm" onclick="markSent(\''+o.invoiceId+'\',\''+o.stepKey+'\')">סמן כנשלח</button></div></div>';
  }).join(""):'<p class="muted">אין הודעות לשליחה.</p>';
}
function copyMsg(i){var t=$("#ob"+i);t.select();document.execCommand&&document.execCommand("copy");navigator.clipboard&&navigator.clipboard.writeText(t.value)}
async function markSent(id,step){await api("/api/sent","POST",bodyClient({invoiceId:id,stepKey:step,today:$("#today").value}));refresh()}
async function sentAll(){await api("/api/sent-all","POST",bodyClient({today:$("#today").value,mode:$("#mode").value}));refresh()}
async function pay(id,amt){var a=prompt("סכום ששולם:",amt);if(a==null)return;await api("/api/pay","POST",bodyClient({invoiceId:id,amount:a,at:$("#today").value}));refresh()}
async function disp(id){if(!confirm("לסמן במחלוקת? הרדיפה תיעצר."))return;await api("/api/dispute","POST",bodyClient({invoiceId:id}));refresh()}
async function doImport(){var r=await api("/api/import","POST",bodyClient({csv:$("#csv").value}));alert("נוספו "+r.added+" (סה\"כ "+r.total+")");$("#csv").value="";loadClients();refresh()}
async function loadBilling(){
  var r=$("#rate").value||12,f=$("#from").value,t=$("#to").value;
  var s=await api("/api/billing?client="+encodeURIComponent($("#client").value)+"&rate="+r+(f?"&from="+f:"")+(t?"&to="+t:""));
  $("#billbox").innerHTML='<div class="kpis"><div class="kpi"><div class="v">'+s.collectedTotal.toLocaleString()+'</div><div class="l">סך נגבה</div></div>'+
    '<div class="kpi"><div class="v">'+s.creditableTotal.toLocaleString()+'</div><div class="l">מזכה</div></div>'+
    '<div class="kpi hl"><div class="v">'+s.fee.toLocaleString()+' '+s.currency+'</div><div class="l">לחיוב</div></div></div>'+
    '<table><thead><tr><th>חשבונית</th><th>לקוח</th><th>סכום</th><th>תאריך</th><th>מזכה</th><th>עמלה</th></tr></thead><tbody>'+
    s.lineItems.map(function(li){return '<tr><td>'+esc(li.invoiceId)+'</td><td>'+esc(li.customerName)+'</td><td class="num">'+li.amount.toLocaleString()+'</td><td class="num">'+li.paidAt+'</td><td>'+(li.creditable?"✓":"—")+'</td><td class="num">'+li.fee.toLocaleString()+'</td></tr>'}).join("")+'</tbody></table>';
}
function openDoc(kind){
  var base="/api/"+kind+"?client="+encodeURIComponent($("#client").value);
  if(kind=="statement")base+="&rate="+($("#rate").value||12)+($("#from").value?"&from="+$("#from").value:"")+($("#to").value?"&to="+$("#to").value:"");
  if(kind=="report")base+="&today="+$("#today").value;
  window.open(base,"_blank");
}
async function loadSettings(){var b=await api("/api/settings?client="+encodeURIComponent($("#client").value));$("#s_name").value=b.businessName||"";$("#s_signer").value=b.signerName||"";$("#s_reply").value=b.replyTo||"";$("#s_tone").value=b.tone||"friendly"}
async function saveSettings(){await api("/api/settings","POST",bodyClient({businessName:$("#s_name").value,signerName:$("#s_signer").value,replyTo:$("#s_reply").value,tone:$("#s_tone").value}));alert("נשמר");loadClients();refresh()}

drawTabs("overview");
loadClients().then(refresh);
</script></body></html>`;

// Run directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--")) || "ws.json";
  const PORT = Number((args.find((a) => a.startsWith("--port=")) || "--port=3000").split("=")[1]);
  makeServer(target).listen(PORT, () =>
    console.log(`InvoiceChaser dashboard → http://localhost:${PORT}  (${target})`)
  );
}
