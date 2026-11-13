import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { makeSqliteDatabase, SQLITE_SCHEMA } from "./fixtures.ts";
import { drizzler, makeProject, removeProject } from "./helpers.ts";

// The config imports `defineConfig` from "drizzler", the package's own export.
const CONFIG = `import { defineConfig } from "drizzler";

import * as schema from "./schema.ts";

export default defineConfig(schema, {
  url: "file:./dev.db",
  seed: 7,
  models: {
    user: { count: 3, relations: { posts: { min: 1, max: 2 } } },
    post: { count: 5 },
  },
});
`;

let project = "";

beforeEach(() => {
  project = makeProject({ "schema.ts": SQLITE_SCHEMA, "drizzler.config.ts": CONFIG });
});

afterEach(() => {
  removeProject(project);
});

describe("drizzler seed, the packaged command", () => {
  it("writes the rows of drizzler.config.ts as SQL, the same for the same seed", async () => {
    const first = await drizzler(["seed", "--sql", "first.sql"], project);
    const second = await drizzler(["seed", "--sql", "second.sql"], project);
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    const sql = fs.readFileSync(path.join(project, "first.sql"), "utf8");
    expect(sql).toContain('INSERT INTO "users"');
    expect(sql).toContain('INSERT INTO "posts"');
    expect(fs.readFileSync(path.join(project, "second.sql"), "utf8")).toBe(sql);
  });

  it("inserts the rows into the database, every post pointing at a user", async () => {
    const file = makeSqliteDatabase({ dir: project, users: [] });
    const { code, output } = await drizzler(["seed"], project);
    expect(code).toBe(0);
    expect(output).toContain("💧 Seeded");

    const db = new DatabaseSync(file);
    const users = db.prepare("SELECT count(*) AS n FROM users").get();
    const orphans = db
      .prepare("SELECT count(*) AS n FROM posts WHERE author_id NOT IN (SELECT id FROM users)")
      .get();
    const posts = db.prepare("SELECT count(*) AS n FROM posts").get();
    db.close();
    // node:sqlite hands rows back as null-prototype objects, so the counts are compared.
    expect(users?.n).toBe(3);
    expect(orphans?.n).toBe(0);
    expect(posts?.n).toBe(5);
  });

  it("names the config that cannot be found", async () => {
    const { code, output } = await drizzler(["seed", "--config", "missing.config.ts"], project);
    expect(code).toBe(1);
    expect(output).toContain("Config not found");
  });
});
