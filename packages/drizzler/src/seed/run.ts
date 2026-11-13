import path from "node:path";
import { Faker, allLocales } from "@faker-js/faker";
import { Config, Effect, Option } from "effect";
import { emitRaw } from "../emit/index.js";
import { makeDialect, makeSqlitePath } from "../studio/server/domain/sql.js";
import { openDriver } from "../studio/server/services/database.js";
import type { SeedConfig } from "./config.js";
import { SeedConfigError, SeedDatabaseError } from "./errors.js";
import { generateSeedRows } from "./generate/index.js";
import { loadSeedConfig, resolveConfigPath } from "./load-config.js";
import { resolveSeedConfig } from "./options.js";
import { makeSeedPlan } from "./plan.js";
import { withTypeScriptImports } from "./resolve.js";
import { readSchema } from "./schema.js";
import { makeSeedSql } from "./sql.js";
import { seedWithDriver } from "./write.js";

export type SeedOverrides = {
  readonly config: string | null;
  readonly url: string | null;
  readonly output: string | null;
  readonly seed: number | null;
  readonly count: number | null;
  readonly locale: string | null;
  readonly reset: boolean;
};

/**
 * A faker speaking the configured locales, each falling back to the next, then to English, seeded
 * when the config names a seed and drawing fresh randomness otherwise.
 */
function makeFaker(seed: number | null, locales: readonly string[] | null) {
  return Effect.gen(function* () {
    const definitions = (locales ?? []).map((code) => ({
      code,
      definition: Object.entries(allLocales).find(
        ([name]) => name === code.replaceAll("-", "_"),
      )?.[1],
    }));
    const unknown = definitions.filter((entry) => entry.definition === undefined);
    if (unknown.length > 0) {
      return yield* new SeedConfigError({
        message: `Unknown faker locale: ${unknown.map((entry) => entry.code).join(", ")}.\n   Use one of ${Object.keys(allLocales).join(", ")}.`,
      });
    }
    const faker = new Faker({
      locale: [
        ...definitions.flatMap((entry) =>
          entry.definition === undefined ? [] : [entry.definition],
        ),
        allLocales.en,
        allLocales.base,
      ],
    });
    if (seed !== null) faker.seed(seed);
    // Without a `dates` window, dates fall in the year before the run. Anchored on the day, not
    // the millisecond, so two seeded runs on the same day agree.
    const today = new Date();
    faker.setDefaultRefDate(
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
    );
    return faker;
  });
}

/**
 * The config with the command line laid over it. `--count` is the count of every faker model, the
 * per-model counts of the config included; models given as `data` keep their rows.
 */
function withOverrides(config: SeedConfig, overrides: SeedOverrides): SeedConfig {
  const models =
    overrides.count === null
      ? config.models
      : Object.fromEntries(
          Object.entries(config.models ?? {}).map(([name, rule]) => [
            name,
            rule.data === undefined ? { ...rule, count: overrides.count ?? undefined } : rule,
          ]),
        );
  return {
    ...config,
    ...(models === undefined ? {} : { models }),
    ...(overrides.output === null ? {} : { output: overrides.output }),
    ...(overrides.seed === null ? {} : { seed: overrides.seed }),
    ...(overrides.count === null ? {} : { count: overrides.count }),
    ...(overrides.locale === null
      ? {}
      : { locale: overrides.locale.split(",").map((s) => s.trim()) }),
    ...(overrides.reset ? { reset: true } : {}),
  };
}

/** The database URL: `--url`, the config's `url`, then DATABASE_URL; and the directory a relative SQLite file is read from. */
function databaseUrl(
  overrides: SeedOverrides,
  configUrl: string | null,
  configDir: string,
  cwd: string,
) {
  return Effect.gen(function* () {
    if (overrides.url !== null) return { url: overrides.url, base: cwd };
    if (configUrl !== null) return { url: configUrl, base: configDir };
    const env = yield* Config.option(Config.String("DATABASE_URL"));
    if (Option.isSome(env)) return { url: env.value, base: cwd };
    return yield* new SeedDatabaseError({
      message:
        "No database to seed.\n   Pass --url, set `url` in drizzler.config.ts or DATABASE_URL, or pass --sql <file> to write the rows as SQL instead.",
    });
  });
}

function seedProgram(overrides: SeedOverrides, cwd: string) {
  return Effect.gen(function* () {
    const configPath = yield* resolveConfigPath(overrides.config, cwd);
    const configDir = path.dirname(configPath);
    const loaded = yield* loadSeedConfig(configPath);
    const config = resolveSeedConfig(withOverrides(loaded, overrides));
    const schema = yield* readSchema(config.schema);
    const tables = yield* makeSeedPlan(schema.tables);
    const faker = yield* makeFaker(config.seed, config.locale);
    const entries = yield* generateSeedRows({ tables, config, faker });
    const report = {
      seed: config.seed,
      locale: config.locale ?? [],
      configPath,
      dialect: schema.dialect,
      tables: entries.map((entry) => ({
        name: entry.table.name,
        table: entry.table.table,
        rows: entry.rows.length,
      })),
    };
    if (config.output !== null) {
      const output = path.resolve(overrides.output === null ? configDir : cwd, config.output);
      const sql = makeSeedSql({
        dialect: schema.dialect,
        entries,
        reset: config.reset,
        seed: config.seed,
        locale: config.locale ?? [],
      });
      yield* emitRaw(sql, output).pipe(
        Effect.mapError((error) => new SeedConfigError({ message: error.message })),
      );
      return { ...report, target: { kind: "sql" as const, path: output } };
    }
    const { url, base } = yield* databaseUrl(overrides, config.url, configDir, cwd);
    const urlDialect = makeDialect({ url });
    if (urlDialect !== null && urlDialect !== schema.dialect) {
      return yield* new SeedConfigError({
        message: `The schema is ${schema.dialect}, but the database URL is ${urlDialect}.`,
      });
    }
    const written = yield* Effect.acquireUseRelease(
      openDriver({ dialect: urlDialect, url, file: makeSqlitePath({ url }), cwd: base }).pipe(
        Effect.mapError((error) => new SeedDatabaseError({ message: error.reason })),
      ),
      (driver) =>
        seedWithDriver({ driver, entries, reset: config.reset }).pipe(
          Effect.mapError((error) =>
            /unique|duplicate/iu.test(error.message) && !config.reset
              ? new SeedDatabaseError({
                  message: `${error.message}\n   The tables already hold rows; pass --reset to empty the seeded tables first.`,
                })
              : error,
          ),
        ),
      (driver) => driver.close,
    );
    return {
      ...report,
      target: { kind: "database" as const, dialect: schema.dialect, ...written },
    };
  });
}

/**
 * `drizzler seed`: the config and its schema in, rows out — into the database in one transaction,
 * or into a SQL file when `--sql` / `output` names one. Relative imports of the config resolve as
 * a bundler would while it runs.
 */
export function runSeed(overrides: SeedOverrides, cwd: string) {
  return withTypeScriptImports(seedProgram(overrides, cwd));
}

export type SeedReport = Effect.Success<ReturnType<typeof runSeed>>;

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
