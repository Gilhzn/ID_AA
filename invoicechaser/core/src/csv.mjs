// Minimal zero-dependency CSV parser + invoice mapper.
// Supports quoted fields and commas inside quotes. For the MVP import flow (docs/04 §4.1).

/**
 * Parse CSV text into an array of row objects keyed by header.
 * @param {string} text
 * @returns {Record<string,string>[]}
 */
export function parseCsv(text) {
  const rows = splitRows(text.trim());
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (cells[i] ?? "").trim()));
    return obj;
  });
}

/** Split CSV text into rows of cells, honoring double-quoted fields. */
function splitRows(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // ignore
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/**
 * Map parsed CSV rows to Invoice objects.
 * Expected headers: id, customerName, customerEmail, amount, currency, issueDate, dueDate, status, lang
 * @param {Record<string,string>[]} rows
 * @returns {import("./domain.mjs").Invoice[]}
 */
export function rowsToInvoices(rows) {
  return rows
    .filter((r) => (r.id || "").trim() !== "") // skip blank/empty lines — no phantom invoices
    .map((r) => ({
    id: r.id,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    amount: Number(r.amount),
    currency: r.currency || "ILS",
    issueDate: new Date(r.issueDate),
    dueDate: new Date(r.dueDate),
    status: /** @type {any} */ (r.status || "open"),
    lang: /** @type {any} */ (r.lang || undefined),
  }));
}
