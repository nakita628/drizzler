import type { CommonOptions, SeedConfig } from "./config.js";

// The locales to try in order; null when the config names none.
function localesOf(locale: CommonOptions["locale"]) {
  if (locale === undefined) return null;
  return typeof locale === "string" ? [locale] : locale;
}

/** A date window as written, as dates; a missing edge is a year before the run, or the run itself. */
function window(dates: CommonOptions["dates"], now: Date) {
  if (dates === undefined || (dates.from === undefined && dates.to === undefined)) return null;
  const to = dates.to === undefined ? now : new Date(dates.to);
  const from =
    dates.from === undefined
      ? new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000)
      : new Date(dates.from);
  return { from, to };
}

/**
 * The config as the seeder reads it: what the user wrote, and null for what they did not. No
 * option has a value of its own; each one takes effect the first time it is set. `now` is when the
 * run started, the end of a date window that gives no `to`.
 */
export function resolveSeedConfig(config: SeedConfig, now: Date) {
  return {
    schema: config.schema,
    seed: config.seed ?? null,
    locale: localesOf(config.locale),
    count: config.count ?? null,
    nullRate: config.nullRate ?? null,
    dates: window(config.dates, now),
    output: config.output ?? null,
    url: config.url ?? null,
    reset: config.reset ?? false,
    models: config.models ?? {},
  };
}

export type ResolvedSeedConfig = ReturnType<typeof resolveSeedConfig>;
