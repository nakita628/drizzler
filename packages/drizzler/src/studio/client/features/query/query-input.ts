// What the Query page decides about what it runs: the code it opens with, whether a query can
// run, and a bound value as the SQL page takes it.

// What earlier studios put in the editor for a start; a browser that kept it opens empty instead.
const FORMER_STARTER = "// `db` is Drizzle over the connected database";

/** The code the editor opens with, from what the browser kept: none for an earlier starter. */
export function startingCode(stored: string | null) {
  const code = stored ?? "";
  return code.startsWith(FORMER_STARTER) ? "" : code;
}

/** A bound value as the SQL page takes it: a scalar as it is, anything else as JSON. */
export function sqlParam(value: unknown) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * Why a query cannot run: no database, or the project's TypeScript did not load (`missing` is the
 * language status when it did not); null when it can.
 */
export function whyUnavailable(
  connected: boolean,
  missing: { readonly reason: string | null } | null,
) {
  if (!connected) return "Start the studio with --url (or set DATABASE_URL) to run queries.";
  if (missing !== null) return `Running a query needs the project's TypeScript: ${missing.reason}`;
  return null;
}
