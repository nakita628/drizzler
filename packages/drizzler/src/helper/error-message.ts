// What a caught failure says, as text: the one way the library turns an \`unknown\` it caught into
// a message (lint/custom.js \`use-error-message\` reports a hand-written one).

/** What a caught failure says: an Error's message, or anything else as text. */
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** What went wrong, with the reason under it: a network failure says only "fetch failed". */
export function errorWithCauses(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}: ${errorWithCauses(error.cause)}`
    : error.message;
}

/**
 * What a query threw, with the causes it wraps, each on its own line: Drizzle reports a rejected
 * statement as `Failed query: ...` and keeps the database's own words in `cause`. A cause the
 * message already says is not repeated.
 */
export function causeLines(thrown: unknown): string {
  if (!(thrown instanceof Error)) return String(thrown);
  const cause = thrown.cause === undefined ? null : causeLines(thrown.cause);
  return cause === null || thrown.message.includes(cause)
    ? thrown.message
    : `${thrown.message}\n${cause}`;
}
