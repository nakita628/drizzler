// What \`drizzler seed\` decides from its inputs: the config with the command line laid over it,
// the faker locales, the day dates start from, and the database to seed. Pure: seed/run.ts reads
// the config, the clock and the environment, and hands them in.
import type { SeedConfig } from "./config.js";

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
 * The config with the command line laid over it. `--count` is the count of every faker model, the
 * per-model counts of the config included; models given as `data` keep their rows.
 */
export function withOverrides(config: SeedConfig, overrides: SeedOverrides): SeedConfig {
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

/**
 * The locale definitions for the codes a config gives (\`ja\`, \`pt-BR\` / \`pt_BR\`), or the codes
 * \`locales\` does not have.
 */
export function resolveLocales<T>(
  codes: readonly string[],
  locales: ReadonlyMap<string, T>,
): { readonly definitions: readonly T[] } | { readonly unknown: readonly string[] } {
  const found = codes.map((code) => ({ code, definition: locales.get(code.replaceAll("-", "_")) }));
  const unknown = found.filter((entry) => entry.definition === undefined).map((e) => e.code);
  if (unknown.length > 0) return { unknown };
  return {
    definitions: found.flatMap((entry) =>
      entry.definition === undefined ? [] : [entry.definition],
    ),
  };
}

/**
 * The day dates fall back from when the config has no \`dates\` window: midnight UTC of \`now\`,
 * not the millisecond, so two seeded runs on the same day agree.
 */
export function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The database to seed: \`--url\`, the config's \`url\`, then DATABASE_URL; and the directory a
 * relative SQLite file is read from (the config's for its own url, else the working directory).
 * Null when none names one.
 */
export function pickDatabaseUrl(input: {
  readonly overrideUrl: string | null;
  readonly configUrl: string | null;
  readonly envUrl: string | null;
  readonly configDir: string;
  readonly cwd: string;
}) {
  if (input.overrideUrl !== null) return { url: input.overrideUrl, base: input.cwd };
  if (input.configUrl !== null) return { url: input.configUrl, base: input.configDir };
  if (input.envUrl !== null) return { url: input.envUrl, base: input.cwd };
  return null;
}

/** Why the seed did not write: a unique-key failure on tables that hold rows says how to start over. */
export function seedFailureMessage(message: string, reset: boolean) {
  return /unique|duplicate/iu.test(message) && !reset
    ? `${message}\n   The tables already hold rows; pass --reset to empty the seeded tables first.`
    : message;
}
