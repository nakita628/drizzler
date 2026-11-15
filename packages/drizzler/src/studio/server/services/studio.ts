import { Effect } from "effect";
import { NO_DATABASE_MESSAGE } from "../constants/index.js";
import { DatabaseUnavailableError } from "../errors/index.js";
import type { Database } from "./database.js";
import type { Language } from "./typescript.js";

/** What every request works on: the schema file, the directory relative paths start from, and the database. */
export type Studio = {
  readonly schemaPath: string;
  readonly cwd: string;
  readonly database: Database;
};

// The one piece of state the server keeps, set when it starts: a Map, so it is replaced as a
// whole entry rather than by writing into a shared object.
type Current = { readonly studio: Studio; readonly language: Language };
const current = new Map<"current", Current>();

/**
 * Keeps what the studio was started with: the handlers are generated as module-level functions,
 * so they read it from here instead of being handed it. Set once, when the server starts.
 *
 * ```mermaid
 * flowchart LR
 *   start[server start] --> set[setStudio]
 *   set --> state[(studio state)]
 *   state --> reads[getStudio / getLanguage in every request]
 * ```
 *
 * @param input.studio - the schema file, the working directory and the database
 * @param input.language - the editor's TypeScript over that schema
 * @returns nothing; later reads see the new state
 */
export function setStudio(input: { readonly studio: Studio; readonly language: Language }) {
  current.set("current", { studio: input.studio, language: input.language });
}

function configured() {
  const value = current.get("current");
  // Reading before the server starts is a bug in the studio itself, not a failure a request can
  // handle, so it stops the request rather than becoming a typed failure.
  // oxlint-disable-next-line custom/no-throw -- a defect (read before start), not a request failure
  if (value === undefined) throw new Error("drizzler studio is not configured");
  return value;
}

/**
 * Reads the editor's TypeScript the studio was started with.
 *
 * ```mermaid
 * flowchart LR
 *   state[(studio state)] --> language[Language]
 * ```
 *
 * @returns the language service wrapper for the schema
 */
export function getLanguage() {
  return configured().language;
}

/**
 * Reads what the studio was started with: the schema file, the working directory, the database.
 *
 * ```mermaid
 * flowchart LR
 *   state[(studio state)] --> studio[schemaPath + cwd + database]
 * ```
 *
 * @returns the studio's schema path, working directory and database
 */
export function getStudio() {
  return configured().studio;
}

/**
 * The open database connection, or a DatabaseUnavailableError that says why there is none: the
 * reason the connection failed, else that no database was given.
 *
 * ```mermaid
 * flowchart LR
 *   state[(studio state)] --> driver{driver?}
 *   driver -- yes --> ok[the driver]
 *   driver -- no --> err[DatabaseUnavailableError: status.error or NO_DATABASE_MESSAGE]
 * ```
 *
 * @returns the driver; fails with DatabaseUnavailableError without one
 */
export function connectedDriver() {
  return Effect.suspend(() => {
    const { driver, status } = configured().studio.database;
    return driver === null
      ? Effect.fail(new DatabaseUnavailableError({ reason: status.error ?? NO_DATABASE_MESSAGE }))
      : Effect.succeed(driver);
  });
}
