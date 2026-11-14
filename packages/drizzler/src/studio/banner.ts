import type { Database } from "./server/services/database.js";

/**
 * What the terminal says once the studio listens: the schema it edits, its address, and the
 * database it works on, or why it is not connected.
 */
export function studioBanner(input: {
  readonly file: string;
  readonly host: string;
  readonly port: number;
  readonly status: Database["status"];
}) {
  const { status } = input;
  const db = status.connected ? `\n   Database: ${status.url}` : "";
  const unconnected = status.error === null ? "" : `\n   Database not connected: ${status.error}`;
  return `💧 drizzler studio is editing ${input.file} at http://${input.host}:${input.port}${db || unconnected}`;
}
