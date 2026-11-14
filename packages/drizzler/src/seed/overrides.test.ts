import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import type { SeedConfig } from "./config.js";
import type { SeedOverrides } from "./overrides.js";
import {
  pickDatabaseUrl,
  resolveLocales,
  seedFailureMessage,
  seedMessages,
  seedOutputPath,
  startOfUtcDay,
  urlDialectProblem,
  withOverrides,
} from "./overrides.js";

const NONE: SeedOverrides = {
  config: null,
  url: null,
  output: null,
  seed: null,
  count: null,
  locale: null,
  reset: false,
};

describe("withOverrides", () => {
  const config = {
    schema: {},
    models: { user: { count: 3 }, tag: { data: [{ name: "a" }] } },
  } as unknown as SeedConfig;

  it("leaves the config alone without overrides", () => {
    expect(withOverrides(config, NONE)).toStrictEqual(config);
  });

  it("sets every faker model's count, keeps data models, and splits the locales", () => {
    expect(
      withOverrides(config, { ...NONE, count: 9, seed: 1, locale: "ja, en", reset: true }),
    ).toStrictEqual({
      schema: {},
      models: { user: { count: 9 }, tag: { data: [{ name: "a" }] } },
      seed: 1,
      count: 9,
      locale: ["ja", "en"],
      reset: true,
    });
  });
});

describe("resolveLocales", () => {
  const locales = new Map([
    ["ja", "JA"],
    ["pt_BR", "PT"],
  ]);

  it("finds each code, with - or _", () => {
    expect(resolveLocales(["ja", "pt-BR"], locales)).toStrictEqual({ definitions: ["JA", "PT"] });
  });

  it("names the codes it does not know", () => {
    expect(resolveLocales(["ja", "xx", "yy"], locales)).toStrictEqual({ unknown: ["xx", "yy"] });
  });
});

describe("startOfUtcDay", () => {
  it("is midnight UTC of the day", () => {
    expect(startOfUtcDay(new Date("2026-11-14T23:59:59.999Z")).toISOString()).toBe(
      "2026-11-14T00:00:00.000Z",
    );
  });
});

describe("pickDatabaseUrl", () => {
  const dirs = { configDir: "/app/config", cwd: "/app" };

  it("takes --url, then the config's url (read from its directory), then DATABASE_URL", () => {
    expect(
      pickDatabaseUrl({ overrideUrl: "a", configUrl: "b", envUrl: "c", ...dirs }),
    ).toStrictEqual({ url: "a", base: "/app" });
    expect(
      pickDatabaseUrl({ overrideUrl: null, configUrl: "b", envUrl: "c", ...dirs }),
    ).toStrictEqual({ url: "b", base: "/app/config" });
    expect(
      pickDatabaseUrl({ overrideUrl: null, configUrl: null, envUrl: "c", ...dirs }),
    ).toStrictEqual({ url: "c", base: "/app" });
    expect(
      pickDatabaseUrl({ overrideUrl: null, configUrl: null, envUrl: null, ...dirs }),
    ).toBeNull();
  });
});

describe("seedFailureMessage", () => {
  it("says how to start over after a unique-key failure, unless --reset was given", () => {
    expect(seedFailureMessage("UNIQUE constraint failed", false)).toContain("pass --reset");
    expect(seedFailureMessage("UNIQUE constraint failed", true)).toBe("UNIQUE constraint failed");
    expect(seedFailureMessage("no such table", false)).toBe("no such table");
  });
});

describe("seedOutputPath", () => {
  it("reads --sql from the working directory, the config's output from its directory", () => {
    const dirs = { configDir: path.join("/app", "config"), cwd: "/app" };
    expect(seedOutputPath({ output: "seed.sql", fromCommandLine: true, ...dirs })).toBe(
      path.resolve("/app", "seed.sql"),
    );
    expect(seedOutputPath({ output: "seed.sql", fromCommandLine: false, ...dirs })).toBe(
      path.resolve("/app/config", "seed.sql"),
    );
  });
});

describe("urlDialectProblem", () => {
  it("says when the URL speaks another dialect, and nothing for one it does not know", () => {
    expect(urlDialectProblem("postgresql", "mysql")).toBe(
      "The schema is postgresql, but the database URL is mysql.",
    );
    expect(urlDialectProblem("postgresql", "postgresql")).toBeNull();
    expect(urlDialectProblem("postgresql", null)).toBeNull();
  });
});

describe("seedMessages", () => {
  it("says what is missing, word for word as before", () => {
    expect(seedMessages.unknownLocales(["xx"], ["en", "ja"])).toBe(
      "Unknown faker locale: xx.\n   Use one of en, ja.",
    );
    expect(seedMessages.noDatabase).toBe(
      "No database to seed.\n   Pass --url, set `url` in drizzler.config.ts or DATABASE_URL, or pass --sql <file> to write the rows as SQL instead.",
    );
  });
});
