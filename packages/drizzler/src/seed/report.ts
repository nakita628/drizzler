import type { SeedRow } from "./config.js";
import type { SeedReport } from "./run.js";
import type { Dialect, SeedTableRows } from "./schema.js";

/** What the seed made, before it is written: its seed, locales, config, dialect and rows by table. */
export function makeSeedReport(input: {
  readonly seed: number | null;
  readonly locale: readonly string[] | null;
  readonly configPath: string;
  readonly dialect: Dialect;
  readonly entries: readonly SeedTableRows<SeedRow>[];
}) {
  return {
    seed: input.seed,
    locale: input.locale ?? [],
    configPath: input.configPath,
    dialect: input.dialect,
    tables: input.entries.map((entry) => ({
      name: entry.table.name,
      table: entry.table.table,
      rows: entry.rows.length,
    })),
  };
}

/** The lines `drizzler seed` prints when it is done. */
export function seedBanner(report: SeedReport) {
  const width = Math.max(...report.tables.map((t) => t.name.length), 1);
  const rows = report.tables.map(
    (t) => `   ${t.name.padEnd(width)}  ${String(t.rows).padStart(6)} rows`,
  );
  const target =
    report.target.kind === "sql"
      ? `   SQL: ${report.target.path}`
      : `   Database: ${report.target.dialect}, ${report.target.statements} statements in one transaction`;
  return [
    `💧 Seeded ${report.tables.reduce((sum, t) => sum + t.rows, 0)} rows (seed ${report.seed ?? "random"}, locale ${report.locale.length === 0 ? "en" : report.locale.join(", ")})`,
    `   Config: ${report.configPath}`,
    target,
    ...rows,
  ].join("\n");
}
