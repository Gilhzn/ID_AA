// File-backed workspace store (a tiny JSON "DB" for the Concierge phase — no server needed).
// A workspace holds the brand profile, the invoices, and an append-only event log.
// Zero dependencies. In the product this becomes Postgres (docs/09 §9.4).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @typedef {Object} Workspace
 * @property {import("./domain.mjs").BrandProfile} brand
 * @property {import("./domain.mjs").Invoice[]} invoices
 * @property {WorkspaceEvent[]} events   append-only log
 */

/**
 * @typedef {Object} WorkspaceEvent
 * @property {"sent"|"paid"|"disputed"|"imported"} type
 * @property {string} invoiceId
 * @property {string} [stepKey]
 * @property {number} [amount]
 * @property {string} at            ISO datetime
 */

const DEFAULT_BRAND = {
  businessName: "My Agency",
  lang: "he",
  tone: "friendly",
  signerName: "",
  replyTo: "",
  paymentBaseUrl: "https://pay.invoicechaser.app",
};

/** Create an empty workspace with the given brand overrides. */
export function emptyWorkspace(brand = {}) {
  return { brand: { ...DEFAULT_BRAND, ...brand }, invoices: [], events: [] };
}

/** Load a workspace JSON file (or create an empty one if missing). */
export function loadWorkspace(path) {
  if (!existsSync(path)) return emptyWorkspace();
  const raw = JSON.parse(readFileSync(path, "utf8"));
  // Revive dates on invoices.
  raw.invoices = (raw.invoices || []).map((i) => ({
    ...i,
    issueDate: new Date(i.issueDate),
    dueDate: new Date(i.dueDate),
  }));
  raw.events = raw.events || [];
  return raw;
}

/** Persist a workspace to a JSON file (dates serialized as ISO). Creates the parent dir if needed. */
export function saveWorkspace(path, ws) {
  const dir = dirname(path);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const serializable = {
    ...ws,
    invoices: ws.invoices.map((i) => ({
      ...i,
      issueDate: new Date(i.issueDate).toISOString(),
      dueDate: new Date(i.dueDate).toISOString(),
    })),
  };
  writeFileSync(path, JSON.stringify(serializable, null, 2), "utf8");
}
