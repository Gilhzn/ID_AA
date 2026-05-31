// Domain model + helpers for the InvoiceChaser core.
// Mirrors the data model in invoicechaser/docs/09-architecture.md (Invoice, Customer, Cadence, Reminder).
// Zero dependencies so it runs with `node` directly.

/**
 * @typedef {Object} Invoice
 * @property {string} id            invoice number / id
 * @property {string} customerName
 * @property {string} customerEmail
 * @property {number} amount
 * @property {string} currency      e.g. "ILS", "USD"
 * @property {Date}   issueDate
 * @property {Date}   dueDate
 * @property {"open"|"paid"|"disputed"} status
 * @property {"he"|"en"} [lang]
 */

/**
 * @typedef {Object} BrandProfile
 * @property {string} businessName
 * @property {"he"|"en"} lang
 * @property {"friendly"|"formal"|"firm"} tone   default brand tone
 * @property {string} signerName
 * @property {string} replyTo
 * @property {string} [paymentBaseUrl]           base url for payment links
 */

/** Milliseconds in a day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days an invoice is overdue relative to `today` (negative = not yet due).
 * @param {Invoice} invoice
 * @param {Date} today
 * @returns {number}
 */
export function daysOverdue(invoice, today) {
  return Math.floor((startOfDay(today) - startOfDay(invoice.dueDate)) / DAY_MS);
}

/** Strip time component to compare calendar days deterministically. */
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Format an amount with a minimal currency symbol map (no Intl dependency surprises).
 * @param {number} amount
 * @param {string} currency
 */
export function formatMoney(amount, currency) {
  const symbols = { ILS: "₪", USD: "$", EUR: "€", GBP: "£" };
  const sym = symbols[currency] || "";
  const n = amount.toLocaleString("en-US");
  // For ILS we keep the symbol before the number for readability in mixed text.
  return sym ? `${sym}${n}` : `${n} ${currency}`;
}

/**
 * Build a payment link for an invoice. In the MVP this is a Stripe Payment Link;
 * here we synthesize a deterministic placeholder URL (see docs/09 §9.2).
 * @param {BrandProfile} brand
 * @param {Invoice} invoice
 */
export function paymentLink(brand, invoice) {
  const base = brand.paymentBaseUrl || "https://pay.invoicechaser.app";
  return `${base}/i/${encodeURIComponent(invoice.id)}`;
}
