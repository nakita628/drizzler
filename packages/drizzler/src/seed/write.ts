import { Effect } from "effect";
import type { Driver } from "../studio/server/services/database.js";
import type { SeedRow } from "./config.js";
import { SeedDatabaseError } from "./errors.js";
import type { SeedTableRows } from "./schema.js";
import type { SeedStatement } from "./sql.js";
import { insertStatements, resetSql, sequenceSql } from "./sql.js";

function run(driver: Driver, statement: SeedStatement) {
  return driver.query(statement).pipe(
    Effect.mapError(
      (error) =>
        new SeedDatabaseError({
          message: `${error.cause}\n   while running: ${statement.sql.slice(0, 200)}`,
        }),
    ),
  );
}

/**
 * Writes every table through the open connection in one transaction: the optional reset, the
 * INSERTs with their values bound, and, on PostgreSQL, the sequence fix-ups. A statement the
 * database refuses rolls everything back.
 */
export function seedWithDriver(input: {
  readonly driver: Driver;
  readonly entries: readonly SeedTableRows<SeedRow>[];
  readonly reset: boolean;
}) {
  return Effect.gen(function* () {
    const { driver } = input;
    const dialect = driver.dialect;
    const tables = input.entries.map((entry) => entry.table);
    const statements: readonly SeedStatement[] = [
      ...(input.reset ? resetSql(dialect, tables).map((sql) => ({ sql, params: [] })) : []),
      ...input.entries.flatMap((entry) => insertStatements(dialect, entry, false)),
      ...sequenceSql(dialect, tables).map((sql) => ({ sql, params: [] })),
    ];
    yield* run(driver, { sql: dialect === "mysql" ? "START TRANSACTION" : "BEGIN", params: [] });
    yield* Effect.forEach(statements, (statement) => run(driver, statement), {
      discard: true,
    }).pipe(
      Effect.tapError(() =>
        driver
          .query({ sql: "ROLLBACK", params: [] })
          .pipe(Effect.catch((error) => Effect.logWarning("ROLLBACK failed", error))),
      ),
    );
    yield* run(driver, { sql: "COMMIT", params: [] });
    return { statements: statements.length };
  });
}
