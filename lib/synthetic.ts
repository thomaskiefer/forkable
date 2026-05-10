/**
 * Single source of truth for synthetic-owner attribution across the app.
 *
 * The Forkable demo data does not carry a real "owner" field on every record.
 * Several pages used to derive an owner via local seed lookups, with three
 * different name pools — so the same client/project could show different
 * owners on Dashboard vs Clients vs Projects.
 *
 * Centralizing here:
 *   - Single canonical OWNERS list (matches the Acme Slack personas where it
 *     makes narrative sense for the demo)
 *   - Stable seeded lookup keyed off the canonical client identifier, so the
 *     same client surfaces the same owner on every page that touches it
 */

export const OWNERS = [
  'Maya Patel',    // VP Sales
  'Theo Brooks',   // Senior Sales Engineer
  'Riley Wong',    // Account Executive
  'Jordan Ellis',  // Account Executive
  'Elliot Park',   // Account Executive
  'Nora Singh',    // Account Executive
  'Nia Grant',     // Customer Success Manager
  'Ari Chen',      // Customer Success Manager
] as const;

export type OwnerName = (typeof OWNERS)[number];

export function stableIndex(seed: string, modulo: number) {
  const total = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return total % modulo;
}

/**
 * Look up the synthetic owner for a string seed (used for non-client-rooted
 * surfaces, e.g. dashboard "stale lead" rows where we want a stable name).
 */
export function getOwner(seed: string): OwnerName {
  return OWNERS[stableIndex(seed, OWNERS.length)];
}

/**
 * Look up the synthetic owner for a client-rooted record. Pass any object that
 * carries a client identifier — Client row, Project row, etc. — and we'll
 * resolve to the same owner across views.
 */
export function getClientOwner(record: {
  company_name?: unknown;
  name?: unknown;
  company_account_id?: unknown;
  client_id?: unknown;
  client_code?: unknown;
  id?: unknown;
}): OwnerName {
  // Prefer company-name-based seeds so the same company resolves to the same
  // owner across leads, clients, projects, and dashboard surfaces.
  const seed = String(
    record.company_name ??
      record.name ??
      record.company_account_id ??
      record.client_id ??
      record.client_code ??
      record.id ??
      '',
  );
  return getOwner(seed);
}
