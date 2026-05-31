// Email sending adapter. Default is a SAFE dry-run (console) so nothing is sent
// by accident. With a Resend API key it sends for real. Zero-dependency (fetch).
// See docs/04 §4.3 and docs/09 §9.2.

/**
 * Send one email.
 * @param {Object} msg   { to, toName?, from?, fromName?, subject, body }
 * @param {Object} [opts]
 * @param {boolean} [opts.live]        actually send (default false = dry-run)
 * @param {string}  [opts.apiKey]      Resend API key (or env RESEND_API_KEY)
 * @param {string}  [opts.from]        default from address
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{sent:boolean, dryRun:boolean, id?:string, error?:string}>}
 */
export async function sendEmail(msg, opts = {}) {
  const apiKey = opts.apiKey || process.env.RESEND_API_KEY;
  const live = opts.live && Boolean(apiKey);
  const from = msg.from || opts.from || process.env.INVOICECHASER_FROM || "billing@example.com";
  const fromHeader = msg.fromName ? `${msg.fromName} <${from}>` : from;
  const to = msg.toName ? `${msg.toName} <${msg.to}>` : msg.to;

  if (!live) {
    return { sent: false, dryRun: true };
  }

  const doFetch = opts.fetchImpl || globalThis.fetch;
  try {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: fromHeader, to: [to], subject: msg.subject, text: msg.body }),
    });
    if (!res.ok) return { sent: false, dryRun: false, error: `Resend ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { sent: true, dryRun: false, id: data.id };
  } catch (err) {
    return { sent: false, dryRun: false, error: String(err && err.message) };
  }
}
