// InvoiceChaser — static browser app. Runs the SAME engine as the Node version,
// storing data in localStorage (no server). Deployed to GitHub Pages.
// Engine modules are copied to ./engine/ by the deploy workflow.

import { decideNextAction } from "./engine/cadence.mjs";
import { buildOutbox, dueSteps, recordSent, markPaid, markDisputed, computeImpact } from "./engine/operator.mjs";
import { computeBilling, renderStatement } from "./engine/billing.mjs";
import { renderReport } from "./engine/report.mjs";
import { parseCsv, rowsToInvoices } from "./engine/csv.mjs";
import { daysOverdue, formatMoney } from "./engine/domain.mjs";

// ---------- browser store (localStorage) ----------
const DEFAULT_BRAND = { businessName: "הסוכנות שלי", lang: "he", tone: "friendly", signerName: "", replyTo: "", paymentBaseUrl: "https://pay.invoicechaser.app" };
const emptyWs = (brand) => ({ brand: { ...DEFAULT_BRAND, ...brand }, invoices: [], events: [] });
const CKEY = "ic_clients";
const wsKey = (c) => "ic_ws_" + c;

const clientList = () => { try { return JSON.parse(localStorage.getItem(CKEY) || "[]"); } catch { return []; } };
function ensureClient(c) {
  const l = clientList();
  if (!l.includes(c)) { l.push(c); localStorage.setItem(CKEY, JSON.stringify(l)); }
  if (!localStorage.getItem(wsKey(c))) saveWs(c, emptyWs({ businessName: c }));
}
function loadWs(c) {
  const raw = localStorage.getItem(wsKey(c));
  if (!raw) return emptyWs({ businessName: c });
  const ws = JSON.parse(raw);
  ws.invoices = (ws.invoices || []).map((i) => ({ ...i, issueDate: new Date(i.issueDate), dueDate: new Date(i.dueDate) }));
  ws.events = ws.events || [];
  ws.brand = { ...DEFAULT_BRAND, ...ws.brand };
  return ws;
}
function saveWs(c, ws) {
  const s = { ...ws, invoices: ws.invoices.map((i) => ({ ...i, issueDate: new Date(i.issueDate).toISOString(), dueDate: new Date(i.dueDate).toISOString() })) };
  localStorage.setItem(wsKey(c), JSON.stringify(s));
}

// ---------- helpers ----------
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const curClient = () => $("#client").value;
const today = () => new Date($("#today").value);
const mode = () => $("#mode").value;

function statusChip(status, d) {
  if (status === "paid") return { cls: "paid", txt: "שולם" };
  if (status === "disputed") return { cls: "disputed", txt: "במחלוקת" };
  if (d > 14) return { cls: "late", txt: "באיחור" };
  if (d > 0) return { cls: "due", txt: "מתעכב" };
  return { cls: "ok", txt: "תקין" };
}
const ACTION_LABEL = { approve: "ממתין לאישור", send: "מוכן לשליחה", wait: "בהמתנה", stop: "—" };

const SAMPLE = `id,customerName,customerEmail,amount,currency,issueDate,dueDate,status,lang
INV-1042,מאיה לוי,maya@brightside.example,18000,ILS,2026-04-01,2026-05-01,open,he
INV-1043,דניאל כהן,dan@northwind.example,42000,ILS,2026-04-10,2026-05-17,open,he
INV-1044,Sarah Klein,sarah@acme.example,9500,USD,2026-03-15,2026-04-15,open,en
INV-1045,יואב שמש,yoav@sunfactory.example,27000,ILS,2026-05-10,2026-05-28,open,he
INV-1046,רני אבני,rani@deepsea.example,15000,ILS,2026-04-20,2026-05-29,disputed,he
INV-1047,Tom Becker,tom@vertex.example,33000,USD,2026-03-01,2026-04-01,open,en
INV-1048,נועה ברק,noa@loft.example,12000,ILS,2026-04-25,2026-05-25,paid,he`;

// ---------- tabs ----------
const TABS = [["overview", "סקירה", "📊"], ["outbox", "Outbox", "✉️"], ["billing", "חיוב", "💰"], ["settings", "הגדרות", "⚙️"], ["import", "ייבוא", "⬆️"]];
function drawTabs(active) {
  $("#tabs").innerHTML = TABS.map((t) =>
    `<button class="tab${t[0] === active ? " on" : ""}" data-tab="${t[0]}"><span class="ico">${t[2]}</span><span>${t[1]}</span></button>`
  ).join("");
  TABS.forEach((t) => { $("#t-" + t[0]).className = t[0] === active ? "" : "hide"; });
  $("#tabs").querySelectorAll(".tab").forEach((el) => el.addEventListener("click", () => go(el.dataset.tab)));
}
function go(t) { drawTabs(t); if (t === "billing") loadBilling(); if (t === "settings") loadSettings(); window.scrollTo({ top: 0, behavior: "smooth" }); }

// ---------- clients ----------
function refreshClients() {
  let l = clientList();
  if (l.length === 0) { ensureClient("Studio Pixel"); importCsv("Studio Pixel", SAMPLE, { signer: "רותם לוי", reply: "billing@pixel.co.il" }); l = clientList(); }
  const sel = $("#client"), cur = sel.value;
  sel.innerHTML = l.map((c) => `<option>${esc(c)}</option>`).join("");
  if (cur && l.includes(cur)) sel.value = cur;
  $("#hint").textContent = l.length > 1 ? l.length + " לקוחות · נשמר במכשיר" : "נשמר במכשיר";
}
function newClient() {
  const n = prompt("שם הלקוח / סוכנות:");
  if (!n) return;
  ensureClient(n); refreshClients(); $("#client").value = n; render();
}

// ---------- import ----------
function importCsv(client, csv, opts = {}) {
  ensureClient(client);
  const ws = loadWs(client);
  if (opts.name) ws.brand.businessName = opts.name;
  if (opts.signer) ws.brand.signerName = opts.signer;
  if (opts.reply) ws.brand.replyTo = opts.reply;
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
  saveWs(client, ws);
  return added;
}

// ---------- render ----------
async function render() {
  const ws = loadWs(curClient());
  const t = today(), md = mode();
  const m = computeImpact(ws, t);
  $("#kpis").innerHTML = [
    ["נגבה ע\"י המערכת", m.creditable.toLocaleString(), "hl"],
    ["סה\"כ נגבה", m.collected.toLocaleString(), ""],
    ["ימים עד תשלום", m.avgDaysToPay == null ? "—" : m.avgDaysToPay, ""],
    ["פתוח באיחור", m.openOverdueAmount.toLocaleString(), ""],
    ["בתור להיום", dueSteps(ws, t, md).length, ""],
  ].map((k) => `<div class="kpi ${k[2]}"><div class="v">${k[1]}</div><div class="l">${k[0]}</div></div>`).join("");

  if (ws.invoices.length === 0) {
    $("#rows").innerHTML = `<div class="empty panel"><div class="big">🗂️</div><div>אין עדיין חשבוניות ללקוח הזה.</div>
      <div class="btn-row" style="justify-content:center;margin-top:12px"><button class="btn" id="emptyLoad">טען נתוני דמו</button></div></div>`;
    const el = $("#emptyLoad"); if (el) el.addEventListener("click", () => { importCsv(curClient(), SAMPLE); render(); });
  } else {
    $("#rows").innerHTML = ws.invoices.map((i) => {
      const d = daysOverdue(i, t), dec = decideNextAction(i, t, md), ch = statusChip(i.status, d);
      const daysLbl = d >= 0 ? `+${d} ימים` : `בעוד ${-d} ימים`;
      const actions = i.status === "open"
        ? `<div class="inv-actions"><button class="btn-soft" data-pay="${i.id}" data-amt="${i.amount}">סומן כשולם</button><button class="btn-soft" data-disp="${i.id}">מחלוקת</button></div>`
        : "";
      return `<article class="inv"><div class="inv-top"><div><div class="inv-name">${esc(i.customerName)}</div><div class="muted small">${esc(i.id)}</div></div><span class="chip ${ch.cls}">${ch.txt}</span></div>
        <div class="inv-amt">${esc(formatMoney(i.amount, i.currency))}</div>
        <div class="inv-meta">${daysLbl} · ${ACTION_LABEL[dec.action]}</div>${actions}</article>`;
    }).join("");
    $("#rows").querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => pay(b.dataset.pay, Number(b.dataset.amt))));
    $("#rows").querySelectorAll("[data-disp]").forEach((b) => b.addEventListener("click", () => disp(b.dataset.disp)));
  }

  const outbox = await buildOutbox(ws, t, md);
  $("#src").textContent = outbox.length ? "· ניסוח: " + (outbox[0]?.draft?.source || "template") : "";
  $("#outbox").innerHTML = outbox.length ? outbox.map((o, idx) =>
    `<div class="msg"><div class="msg-head"><b>${esc(o.invoice.id)} · ${esc(o.invoice.customerName)}</b>${o.decision.action === "approve" ? '<span class="chip due">דורש אישור</span>' : '<span class="chip ok">מוכן</span>'}</div>
     <div class="sub">${esc(o.invoice.customerEmail)} · ${o.decision.step.key} · ${esc(o.draft.subject)}</div>
     <textarea id="ob${idx}">${esc(o.draft.body)}</textarea>
     <div class="btn-row" style="margin-top:8px"><button class="btn-soft" data-copy="${idx}">העתק</button><button class="btn-soft" data-sent="${o.invoice.id}" data-step="${o.decision.step.key}">סמן כנשלח</button></div></div>`
  ).join("") : `<div class="empty panel"><div class="big">✅</div><div>אין תזכורות לשליחה היום — הכל מעודכן.</div></div>`;
  $("#outbox").querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => { const ta = $("#ob" + b.dataset.copy); ta.select(); navigator.clipboard && navigator.clipboard.writeText(ta.value); b.textContent = "הועתק ✓"; setTimeout(() => (b.textContent = "העתק"), 1200); }));
  $("#outbox").querySelectorAll("[data-sent]").forEach((b) => b.addEventListener("click", () => markSent(b.dataset.sent, b.dataset.step)));
}

// ---------- actions ----------
function withWs(fn) { const ws = loadWs(curClient()); fn(ws); saveWs(curClient(), ws); render(); }
function markSent(id, step) { withWs((ws) => recordSent(ws, id, step, today())); }
function sentAll() { withWs((ws) => { for (const { invoice, decision } of dueSteps(ws, today(), mode())) recordSent(ws, invoice.id, decision.step.key, today()); }); }
function pay(id, amt) { const a = prompt("סכום ששולם:", amt); if (a == null) return; withWs((ws) => markPaid(ws, id, Number(a), today())); }
function disp(id) { if (!confirm("לסמן במחלוקת? הרדיפה תיעצר.")) return; withWs((ws) => markDisputed(ws, id)); }

function loadBilling() {
  const ws = loadWs(curClient());
  const s = computeBilling(ws, { ratePct: Number($("#rate").value || 12), from: $("#from").value || undefined, to: $("#to").value || undefined });
  $("#billbox").innerHTML =
    `<div class="kpis"><div class="kpi"><div class="v">${s.collectedTotal.toLocaleString()}</div><div class="l">סך נגבה</div></div>
     <div class="kpi"><div class="v">${s.creditableTotal.toLocaleString()}</div><div class="l">מזכה</div></div>
     <div class="kpi hl"><div class="v">${s.fee.toLocaleString()} ${s.currency}</div><div class="l">לחיוב</div></div></div>` +
    (s.lineItems.length ? `<div class="cards">` + s.lineItems.map((li) =>
      `<article class="inv"><div class="inv-top"><div><div class="inv-name">${esc(li.customerName)}</div><div class="muted small">${esc(li.invoiceId)} · ${li.paidAt}</div></div><span class="chip ${li.creditable ? "ok" : "paid"}">${li.creditable ? "מזכה" : "ללא עמלה"}</span></div>
        <div class="inv-meta">שולם: ${li.amount.toLocaleString()} · עמלה: <b>${li.fee.toLocaleString()}</b></div></article>`).join("") + `</div>`
      : `<p class="muted small">אין תשלומים בטווח שנבחר.</p>`);
}
function openHtml(content) { const w = window.open("", "_blank"); if (w) { w.document.write(content); w.document.close(); } else { alert("חלון קופץ נחסם — אפשר חלונות קופצים לאתר."); } }
function openStatement() { const ws = loadWs(curClient()); openHtml(renderStatement(computeBilling(ws, { ratePct: Number($("#rate").value || 12), from: $("#from").value || undefined, to: $("#to").value || undefined }))); }
function openReport() { const ws = loadWs(curClient()); openHtml(renderReport(ws.invoices, ws.brand, today())); }

function loadSettings() { const b = loadWs(curClient()).brand; $("#s_name").value = b.businessName || ""; $("#s_signer").value = b.signerName || ""; $("#s_reply").value = b.replyTo || ""; $("#s_tone").value = b.tone || "friendly"; }
function saveSettings() { withWs((ws) => { ws.brand.businessName = $("#s_name").value; ws.brand.signerName = $("#s_signer").value; ws.brand.replyTo = $("#s_reply").value; ws.brand.tone = $("#s_tone").value; }); refreshClients(); flash("ההגדרות נשמרו"); }

function doImport() { const added = importCsv(curClient(), $("#csv").value); flash("נוספו " + added + " חשבוניות"); $("#csv").value = ""; go("overview"); render(); }
function loadSample() { const added = importCsv(curClient(), SAMPLE); flash("נטענו " + added + " חשבוניות דמו"); go("overview"); render(); }

function flash(msg) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.style.cssText = "position:fixed;inset-inline:0;bottom:90px;margin:auto;width:max-content;max-width:90vw;background:var(--ink);color:var(--bg);padding:10px 18px;border-radius:999px;font-weight:600;font-size:13px;z-index:60;box-shadow:0 6px 20px rgba(0,0,0,.2);opacity:0;transition:opacity .2s"; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = "1"; clearTimeout(t._h); t._h = setTimeout(() => (t.style.opacity = "0"), 1600);
}

// ---------- wire up ----------
$("#client").addEventListener("change", render);
$("#today").addEventListener("change", render);
$("#mode").addEventListener("change", render);
$("#btnNewClient").addEventListener("click", newClient);
$("#btnSentAll").addEventListener("click", sentAll);
$("#btnBill").addEventListener("click", loadBilling);
$("#btnStatement").addEventListener("click", openStatement);
$("#btnSaveSettings").addEventListener("click", saveSettings);
$("#btnImport").addEventListener("click", doImport);
$("#btnLoadSample").addEventListener("click", loadSample);
$("#btnReport").addEventListener("click", openReport);

drawTabs("overview");
refreshClients();
render();
