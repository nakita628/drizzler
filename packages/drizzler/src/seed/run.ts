import path from "node:path";
import { Faker, allLocales } from "@faker-js/faker";
import { Clock, Config, Effect, Option } from "effect";
import { emitRaw } from "../emit/index.js";
import { TOKEN_ENV, makeConnection, makeDialect } from "../studio/server/domain/sql.js";
import { openDriver } from "../studio/server/services/database.js";
import { readEnv } from "../studio/server/services/env.js";
import type { SeedOverrides } from "./overrides.js";
import {
  pickDatabaseUrl,
  resolveLocales,
  seedFailureMessage,
  startOfUtcDay,
  withOverrides,
} from "./overrides.js";
import { SeedConfigError, SeedDatabaseError } from "./errors.js";
import { generateSeedRows } from "./generate/index.js";
import { loadSeedConfig, resolveConfigPath } from "./load-config.js";
import { resolveSeedConfig } from "./options.js";
import { makeSeedPlan } from "./plan.js";
import { withTypeScriptImports } from "./resolve.js";
import { readSchema } from "./schema.js";
import { makeSeedSql } from "./sql.js";
import { seedWithDriver } from "./write.js";

export type { SeedOverrides } from "./overrides.js";

// faker's locales by name (`ja`, `pt_BR`), for the codes a config gives.
const LOCALES = new Map(Object.entries(allLocales));

/**
 * A faker speaking the configured locales, each falling back to the next, then to English, seeded
 * when the config names a seed and drawing fresh randomness otherwise.
 */
function makeFaker(seed: number | null, locales: readonly string[] | null, now: Date) {
  return Effect.gen(function* () {
    const resolved = resolveLocales(locales ?? [], LOCALES);
    if ("unknown" in resolved) {
      return yield* new SeedConfigError({
        message: `Unknown faker locale: ${resolved.unknown.join(", ")}.\n   Use one of ${Object.keys(allLocales).join(", ")}.`,
      });
    }
    const faker = new Faker({
      locale: [...resolved.definitions, allLocales.en, allLocales.base],
    });
    if (seed !== null) faker.seed(seed);
    // Without a `dates` window, dates fall in the year before the run.
    faker.setDefaultRefDate(startOfUtcDay(now));
    return faker;
  });
}

/** The database to seed, with DATABASE_URL read from the environment; fails when none names one. */
function databaseUrl(
  overrides: SeedOverrides,
  configUrl: string | null,
  configDir: string,
  cwd: string,
) {
  return Effect.gen(function* () {
    const env = yield* Config.option(Config.String("DATABASE_URL"));
    const picked = pickDatabaseUrl({
      overrideUrl: overrides.url,
      configUrl,
      envUrl: Option.getOrNull(env),
      configDir,
      cwd,
    });
    if (picked !== null) return picked;
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
    // The clock is read once, here: the date window and faker's dates both start from it.
    const now = new Date(yield* Clock.currentTimeMillis);
    const config = resolveSeedConfig(withOverrides(loaded, overrides), now);
    const schema = yield* readSchema(config.schema);
    const tables = yield* makeSeedPlan(schema.tables);
    const faker = yield* makeFaker(config.seed, config.locale, now);
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
    const env = yield* readEnv({ names: Object.values(TOKEN_ENV).flat() });
    const written = yield* Effect.acquireUseRelease(
      openDriver({ connection: makeConnection({ url, env }), cwd: base }).pipe(
        Effect.mapError((error) => new SeedDatabaseError({ message: error.reason })),
      ),
      (driver) =>
        seedWithDriver({ driver, entries, reset: config.reset }).pipe(
          Effect.mapError(
            (error) =>
              new SeedDatabaseError({ message: seedFailureMessage(error.message, config.reset) }),
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

export { seedBanner } from "./report.js";
