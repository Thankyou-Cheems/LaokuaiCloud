const legacyZone = /^c-[0-9a-f]{32}\.lan\.voice\.ruikang\.wang\.$/;
const friendlyZone = /^lk(?:-[0-9a-f]{8})?\.internal\.$/;
const legacyLabel = /^d-[0-9a-f]{32}$/;
const friendlyLabel = /^[a-z]{3,12}-[0-9]{2,3}$/;
// Check the whole match too: JavaScript's $ also matches before a final newline.
const matches = (pattern: RegExp, value: string): boolean => pattern.exec(value)?.[0] === value;

/** Only the two server-issued namespace formats may reach DNS policy or UI. */
export const communityDnsZone = (value: unknown): value is string =>
  typeof value === "string" && (matches(legacyZone, value) || matches(friendlyZone, value));

/** Canonical resolver names keep their terminal dot; labels must match their zone family. */
export function communityDnsNameZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(".");
  if (separator < 0) return null;
  const label = value.slice(0, separator), zone = value.slice(separator + 1);
  return (matches(legacyLabel, label) && matches(legacyZone, zone)) ||
    (matches(friendlyLabel, label) && matches(friendlyZone, zone)) ? zone : null;
}

/** Display/copy the full qualified address without the resolver's terminal dot. */
export const communityDnsDisplayName = (value: string): string =>
  communityDnsNameZone(value) ? value.slice(0, -1) : "";
