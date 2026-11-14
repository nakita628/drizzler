import { Effect } from "effect";
import type { Driver } from "../studio/server/services/database.js";
import type { SeedRow } from "./config.js";
import { SeedDatabaseError } from "./errors.js";
import type { SeedTableRows } from "./schema.js";
import { makeSeedStatements } from "./sql.js";

/**
 * Writes every table through the open connection in one transaction (one batch on Turso and D1):
 * the optional reset, the INSERTs with their values bound, and, on PostgreSQL, the sequence
 * fix-ups. A statement the database refuses rolls everything back.
 */
export function seedWithDriver(input: {
  readonly driver: Driver;
  readonly entries: readonly SeedTableRows<SeedRow>[];
  readonly reset: boolean;
}) {
  return Effect.gen(function* () {
    const { driver } = input;
    const statements = makeSeedStatements({
      dialect: driver.dialect,
      entries: input.entries,
      reset: input.reset,
    });
    yield* driver
      .transaction(statements)
      .pipe(Effect.mapError((error) => new SeedDatabaseError({ message: error.cause })));
    return { statements: statements.length };
  });
}
